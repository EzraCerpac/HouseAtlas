#!/usr/bin/env python3
"""Opt-in production-binary HTTP qualification; all state and peers are disposable."""
import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import uuid


class QualificationFailure(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise QualificationFailure(message)


@contextmanager
def cleanup_on_exit(action):
    """Always clean up; retain a primary failure if cleanup also fails."""
    try:
        yield
    except BaseException as primary:
        try:
            action()
        except BaseException as secondary:
            primary.add_note(f"Cleanup also failed: {type(secondary).__name__}: {secondary}")
        raise
    else:
        action()


@contextmanager
def elapsed_deadline(deadline):
    """Unix main-thread alarm bounds the entire exchange, including trickle reads."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("HTTP exchange elapsed deadline exceeded")
    require(threading.current_thread() is threading.main_thread(), "HTTP deadline requires the main thread")
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), "HTTP deadline requires an unused real timer")

    def expired(_signum, _frame):
        raise TimeoutError("HTTP exchange elapsed deadline exceeded")

    previous = signal.signal(signal.SIGALRM, expired)

    def restore():
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)

    with cleanup_on_exit(restore):
        signal.setitimer(signal.ITIMER_REAL, remaining)
        yield
        if time.monotonic() >= deadline:
            raise TimeoutError("HTTP exchange elapsed deadline exceeded")


def document(path, value):
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n")
    path.chmod(0o600)


def certificates(root):
    """Same disposable CA/server certificate approach as healthy-network-loopback."""
    ca, ca_key = root / "ca.pem", root / "ca-key.pem"
    cert, key = root / "server.pem", root / "server-key.pem"
    csr, extensions = root / "server.csr", root / "server.ext"
    extensions.write_text(
        "subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\n"
        "keyUsage=critical,digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\n"
        "authorityKeyIdentifier=keyid,issuer\n"
    )
    commands = [
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
         "-days", "1", "-subj", "/CN=Disposable HouseAtlas qualification CA",
         "-addext", "basicConstraints=critical,CA:TRUE",
         "-addext", "keyUsage=critical,keyCertSign,cRLSign",
         "-addext", "subjectKeyIdentifier=hash", "-keyout", str(ca_key),
         "-out", str(ca)],
        ["openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
         "-subj", "/CN=127.0.0.1", "-keyout", str(key), "-out", str(csr)],
        ["openssl", "x509", "-req", "-in", str(csr), "-CA", str(ca),
         "-CAkey", str(ca_key), "-CAcreateserial", "-days", "1", "-sha256",
         "-extfile", str(extensions), "-out", str(cert)],
    ]
    for command in commands:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30)
    key.chmod(0o600)
    ca_key.chmod(0o600)
    return ca, cert, key


def collector_documents():
    at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    collector = {"lastCycleAt": at, "guardOutcome": "home", "schemaVersion": 1}
    device = {"id": "device-a", "name": "Invented qualification endpoint",
              "kind": "router", "mobility": "fixed"}
    fact = {"state": "reachable", "latencyMs": 2.5, "loss": 0,
            "measuredAt": at, "recordedAt": at, "reason": None}
    return {
        "/api/inventory": {"revision": 42, "inventory": {
            "rooms": [], "devices": [device], "interfaces": [],
            "segments": [], "links": [], "positions": {}}},
        "/api/health": {"version": 1, "ok": True, "collector": collector},
        "/api/measurements": {"version": 1, "inventoryRevision": 42,
            "generatedAt": at, "collector": collector, "devices": {"device-a": {
                "latest": fact, "series24h": [], "series24hTruncated": False,
                "hourly7d": [], "hourly90d": []}}},
        "/api/results": {"version": 1, "speed": {"latest": None, "recent": []},
            "wifi": {"latest": {"state": "unavailable", "recordedAt": at,
                "networks": None, "reason": "no-dependable-unprivileged-scanner"}},
            # Stored invented history, not a request to run ping.
            "actions": [{"kind": "ping", "recordedAt": at, "deviceId": "device-a",
                         "inventoryRevision": 42, "result": fact}]},
    }


@contextmanager
def collector_peer():
    bodies = {path: json.dumps(value).encode() for path, value in collector_documents().items()}
    requests, lock = [], threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def parse_request(self):
            parsed = super().parse_request()
            if parsed:
                with lock:
                    requests.append((self.command, self.path))
            return parsed

        def serve(self):
            body = bodies.get(self.path) if self.command == "GET" else None
            self.send_response(200 if body is not None else 405)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body or b"")))
            self.send_header("Connection", "close")
            self.end_headers()
            if body is not None:
                self.wfile.write(body)

        do_GET = serve
        do_POST = serve
        do_PUT = serve
        do_DELETE = serve
        do_PATCH = serve
        do_HEAD = serve
        do_OPTIONS = serve

    def counts():
        with lock:
            return Counter(requests)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    with cleanup_on_exit(server.server_close):
        server.daemon_threads = True
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()

        def stop():
            server.shutdown()
            worker.join(timeout=5)
            require(not worker.is_alive(), "Disposable collector did not stop")

        with cleanup_on_exit(stop):
            yield f"http://127.0.0.1:{server.server_port}", counts


def audit_collector(calls):
    require(calls["GET", "/api/inventory"] == 2,
            "Inventory GET count changed during backend shutdown")
    require(all(method == "GET" and path in (
        "/api/inventory", "/api/health", "/api/measurements", "/api/results")
                for method, path in calls), "Collector received demand or an unexpected route")
    require(all(calls["GET", path] > 0 for path in (
        "/api/health", "/api/measurements", "/api/results")),
        "Generated observation/result routes were not read")


class Client:
    def __init__(self, port, ca):
        self.port = port
        self.origin = f"https://127.0.0.1:{port}"
        self.context = ssl.create_default_context(cafile=str(ca))

    def request(self, method, path, session=None, body=None, csrf=True, deadline=None, *,
                mcp_protocol=None, mcp_session=None):
        deadline = min(time.monotonic() + 10, deadline) if deadline is not None else time.monotonic() + 10
        # Direct literal loopback; no proxy/environment or redirect handling.
        headers = {"Origin": self.origin, "Sec-Fetch-Site": "same-origin"}
        if session:
            headers["Cookie"] = session["cookie"]
            if method == "POST" and csrf:
                headers["X-Atlas-CSRF"] = session["csrfToken"]
        if body is not None:
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if mcp_protocol is not None:
            headers["Accept"] = "application/json, text/event-stream"
            headers["MCP-Protocol-Version"] = mcp_protocol
            if mcp_session is not None:
                headers["MCP-Session-Id"] = mcp_session
        connection = http.client.HTTPSConnection(
            "127.0.0.1", self.port, context=self.context, timeout=10)
        with cleanup_on_exit(connection.close), elapsed_deadline(deadline):
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read(1024 * 1024 + 1)
            require(len(payload) <= 1024 * 1024, "Backend response exceeded fixture bound")
            return (response.status, {key.lower(): value for key, value in response.getheaders()},
                    json.loads(payload) if payload else None)

    def login(self, user):
        status, headers, value = self.request("POST", "/api/atlas/auth/login", body={
            "username": user["username"], "password": user["password"]})
        require(status == 200, f"Generated {user['memberships'][0]['role']} login: HTTP {status}")
        require(value["actorId"] == user["actorId"], "Login returned a different actor")
        value["cookie"] = headers["set-cookie"].split(";", 1)[0]
        return value

    def ok(self, method, path, session, deadline=None):
        status, _headers, value = self.request(method, path, session, deadline=deadline)
        require(status == 200, f"{method} {path}: HTTP {status}")
        return value


def wait_for_startup(process, client, deadline):
    while True:
        require(time.monotonic() < deadline, "Production serve readiness timed out")
        require(process.poll() is None, "Production serve exited before readiness")
        try:
            status, _headers, _value = client.request("GET", "/api/atlas/auth/mode", deadline=deadline)
        except (ConnectionRefusedError, TimeoutError):
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))
            continue
        require(time.monotonic() < deadline, "Production serve readiness timed out")
        require(status == 200, f"Production readiness: HTTP {status}")
        return


def stop_backend(process):
    require(process.poll() is None, "Production serve exited before SIGTERM")
    try:
        process.terminate()
    finally:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            finally:
                process.wait(timeout=5)
            raise QualificationFailure("Production serve did not drain on SIGTERM")
    require(process.returncode == 0, f"Production serve exited {process.returncode}")


@contextmanager
def backend(executable, config, profile, client, log):
    command = [str(executable), "serve", "--server-config", str(config)]
    if profile is not None:
        digest = hashlib.sha256(profile.read_bytes()).hexdigest()
        command.extend(["--provider-reads-profile", str(profile), "--provider-reads-sha256", digest])
    output = log.open("wb")
    with cleanup_on_exit(output.close):
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                   stdout=output, stderr=subprocess.STDOUT)
        with cleanup_on_exit(lambda: stop_backend(process)):
            wait_for_startup(process, client, time.monotonic() + 45)
            yield
            require(process.poll() is None, "Production serve exited before SIGTERM")


def initialize_host(executable, root, mcp_commands):
    ca, cert, key = certificates(root)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    client = Client(port, ca)
    workspace, home = (str(uuid.uuid4()) for _ in range(2))
    scope = {"workspaceId": workspace, "homeId": home}
    frontend, data = root / "frontend", root / "data"
    frontend.mkdir(mode=0o700)
    # Satisfies production asset loading only; no renderer/UI is exercised.
    (frontend / "index.html").write_text('<!doctype html><div id="root"></div>\n')
    config, provisioning = root / "server.json", root / "provisioning.json"
    document(config, {"schemaVersion": 1, "deploymentId": str(uuid.uuid4()),
        "dataDirectory": str(data), "logDirectory": str(data / "logs"),
        "frontendDirectory": str(frontend), "tlsCertificate": str(cert),
        "tlsPrivateKey": str(key), "listen": f"127.0.0.1:{port}", "origin": client.origin,
        "homes": [{**scope, "label": "Invented qualification home"}],
        "mcpCommands": mcp_commands})
    users = [{"userId": str(uuid.uuid4()), "actorId": str(uuid.uuid4()),
        "username": f"qualification-{role}", "password": secrets.token_urlsafe(32),
        "memberships": [{**scope, "role": role}]}
        for role in ("editor", "viewer")]
    document(provisioning, {"schemaVersion": 1, "users": users})
    subprocess.run([str(executable), "initialize", "--server-config", str(config),
                    "--provisioning-file", str(provisioning)],
                   check=True, timeout=120, stdout=subprocess.DEVNULL)
    provisioning.unlink()
    return config, client, scope, users


def qualify(executable, root):
    config, client, home_scope, users = initialize_host(executable, root, "read-only")
    workspace, home = home_scope["workspaceId"], home_scope["homeId"]
    source = str(uuid.uuid4())
    data, profile = root / "data", root / "providers.json"
    receipt = (data / "server-state.json").read_bytes()
    # Owner-issued metadata, never SQL or a reimplementation of state_digest.
    state_digest = json.loads(receipt)["configurationDigest"]
    cache = data / "provider-cache"
    cache.mkdir(mode=0o700)
    require(not list(cache.iterdir()), "Fixture cache must start empty")
    scope = {"workspaceId": workspace, "homeId": home, "sourceInstanceId": source,
             "collectionId": "inventory"}
    prefix = f"/api/atlas/providers/network/workspaces/{workspace}/homes/{home}/sources/{source}"
    cached = prefix + "/cached?collection=inventory"
    results = prefix + "/results?collection=inventory"
    refresh = prefix + "/refresh?collection=inventory"
    with collector_peer() as (origin, counts):
        document(profile, {"schemaVersion": 2, "serverConfigurationDigest": state_digest,
            "homeboxCached": [], "networkCached": [{
                "registration": {**scope, "owner": "network", "partitionMode": "exclusive-home",
                                 "allowedExternalIds": []},
                "origin": origin, "review": {"revision": 42, "links": {}},
                "limits": {"maxResponseBytes": 10485760, "maxRecords": 10000, "requestTimeoutMs": 10000},
                "connectTimeoutMs": 2000, "idleTimeoutMs": 2000, "staleAfterMs": 300000,
                "privateDirectory": str(cache), "collectorMeasurements": True,
                "refreshEditors": [{"userId": users[0]["userId"], "actorId": users[0]["actorId"]}],
                "entities": [{"workspaceId": workspace, "homeId": home, "key": {
                    "sourceInstanceId": source, "collectionId": "inventory",
                    "sourceKind": "network-device", "externalId": "device-a"}}]}]})
        log = root / "backend.log"
        try:
            with backend(executable, config, profile, client, log):
                editor, viewer = (client.login(user) for user in users)
                require(counts()["GET", "/api/inventory"] == 0, "Startup/login fetched inventory")
                require(list(cache.iterdir()), "Native mount did not initialize cache custody")
                status, _headers, _value = client.request("GET", cached, viewer)
                require(status == 404, f"Unregistered source read: HTTP {status}")
                status, _headers, _value = client.request("POST", refresh, viewer)
                require(status == 403, f"Viewer refresh before registration: HTTP {status}")
                status, _headers, _value = client.request("POST", refresh, editor, csrf=False)
                require(status == 403, f"Editor refresh without CSRF: HTTP {status}")
                require(counts()["GET", "/api/inventory"] == 0, "Refused POST fetched inventory")
                published = client.ok("POST", refresh, editor)
                require(published["status"] == "refreshed" and published["inventoryRevision"] == 42,
                        "Reviewed Editor POST did not publish revision 42")
                require(published["cache"]["status"] == "fresh", "Publication cache is not fresh")
                require(counts()["GET", "/api/inventory"] == 2,
                        "Editor refresh must perform preflight and reviewed final inventory GET")
                facet = client.ok("GET", cached, viewer)
                require(facet["status"] == "fresh" and facet["sourceRevision"] == 42,
                        "Ordinary Viewer read did not serve refreshed revision 42")
                require(facet["cache"]["generationId"] is not None
                        and all(facet[key] == value for key, value in scope.items()),
                        "Refreshed generation lacks the configured native scope/identity")
                require(facet["readOnly"] and not any(facet["capabilities"].values()),
                        "Cached browse unexpectedly advertises write/demand capability")
                require(len(facet["devices"]) == 1 and facet["devices"][0]["externalId"] == "device-a"
                        and facet["devices"][0]["value"]["name"] == "Invented qualification endpoint",
                        "Ordinary read did not reflect generated inventory")
                # Poll public read metadata only while the initial passive poll completes.
                deadline = time.monotonic() + 15
                while True:
                    facts = client.ok("GET", results, viewer, deadline=deadline)
                    require(time.monotonic() < deadline, "Stored collector results timed out")
                    if facts["status"] == "available":
                        break
                    require(facts["status"] == "unknown" and time.monotonic() < deadline,
                            "Stored collector results did not become available")
                    time.sleep(min(0.1, max(0, deadline - time.monotonic())))
                require(facts["mayRefresh"] is False and facts["needsReview"] is False,
                        "Viewer unexpectedly has refresh capability or review changed")
                require(facts["servedInventoryRevision"] == facts["inventoryRevision"]
                        == facts["reviewedInventoryRevision"] == 42
                        and facts["measurementReason"] is None,
                        "Served/reviewed/collector revisions did not qualify measurements")
                require(facts["results"]["actions"][0]["deviceId"] == "device-a"
                        and facts["results"]["actions"][0]["result"]["latencyMs"] == 2.5,
                        "Revision-qualified invented collector result is missing")
                require(client.ok("GET", results, editor)["mayRefresh"] is True,
                        "Reviewed Editor lacks mounted refresh capability")
                status, _headers, _value = client.request("POST", refresh, viewer)
                require(status == 403, f"Viewer refresh after publication: HTTP {status}")
                after = client.ok("GET", cached, viewer)
                require(after["cache"] == facet["cache"] and after["devices"] == facet["devices"]
                        and after["sourceRevision"] == facet["sourceRevision"],
                        "Viewer refusal or browsing changed the published cache")
                require(counts()["GET", "/api/inventory"] == 2,
                        "Ordinary reads or Viewer refusal fetched inventory")
            require((data / "server-state.json").read_bytes() == receipt,
                    "Qualification changed the initialization receipt")
            audit_collector(counts())
            print("PASS production initialize/serve: generated Editor and Viewer; native empty-cache setup")
            print("PASS Editor CSRF POST: revision 42 published; exactly preflight + reviewed final inventory GET")
            print("PASS ordinary Viewer read: generated device/revision; stored results attached; mayRefresh=false")
            print("PASS Viewer POST: HTTP 403 before/after publication; reads/refusals never fetch inventory")
            print("PASS collector: stored JSON GETs only through backend shutdown; owned backend drained")
            print("HTTP qualification only; browser UI, installed configuration and real devices remain untested")
        except BaseException as primary:
            # Only this harness's generated settings/data can appear here.
            try:
                if log.exists():
                    print(log.read_text()[-8000:])
            except Exception as secondary:
                primary.add_note(f"Reading backend diagnostics also failed: {secondary}")
            raise


def run(qualification, description, prefix):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--executable", type=Path, required=True,
                        help="Existing houseatlas backend binary; executed only with generated temporary settings")
    args = parser.parse_args()
    executable = args.executable.resolve(strict=True)
    require(executable.is_file() and os.access(executable, os.X_OK), "Expected an executable backend binary")

    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)

    previous = signal.signal(signal.SIGTERM, interrupted)
    os.umask(0o077)
    print(f"Backend executable: {executable}", flush=True)
    with cleanup_on_exit(lambda: signal.signal(signal.SIGTERM, previous)):
        directory = tempfile.TemporaryDirectory(prefix=prefix)
        with cleanup_on_exit(directory.cleanup):
            qualification(executable, Path(directory.name).resolve(strict=True))
    print("PASS cleanup: disposable state removed")


def main():
    run(qualify, __doc__, "houseatlas-network-binary-")


if __name__ == "__main__":
    main()
