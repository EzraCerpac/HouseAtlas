"""One proposed generated positive; integration must register its named command.

Only disposable synthetic owners and existing finite transports are used. No
native executable, socket, session establishment, provider or host action runs.
"""

from dataclasses import fields, replace
from datetime import datetime, timezone
import json
from pathlib import Path
import socket
import ssl
import tempfile
import time
from types import SimpleNamespace
import unittest
from urllib.parse import urlsplit

from houseatlas_updater.journal import Journal
from houseatlas_updater.validation import canonical, sha256
from houseatlas_updater_runtime import ApplicationExpectations, PlatformOperations
from houseatlas_updater_runtime.application_readiness import PinnedApplicationDocuments
from houseatlas_updater_runtime.established_native_http import EstablishedNativeReadTransport
from maintenance_composition import TrustedMaintenanceBindings, compose_maintenance
from test_maintenance_happy import ROOT, bridge, generated, runtime_fixture, source_module


read_fixture = source_module(
    "composition_generated_read_transport",
    ROOT / "tools/houseatlas-updater-runtime/tests/test_application_readiness_happy.py")


class MaintenanceCompositionHappyPath(unittest.TestCase):
    def test_trusted_established_check_apply_status(self):
        with tempfile.TemporaryDirectory(prefix="houseatlas-composition-generated-") as name:
            runtime = runtime_fixture.GeneratedOwner(Path(name))
            world, old_process = runtime.world, runtime.running
            before = world.installed
            artifact = generated.artifact("0.2.0", 2)
            runtime.catalog[artifact.selection.manifest_sha256] = artifact
            selected = world.add(artifact)
            native_before = generated.native_cut(world.root / "native")
            config_before = json.loads(runtime.effective.read_bytes())
            prior_code = (before.binary.read_bytes(), (before.frontend / "index.html").read_bytes())

            workspace, home, actor = [f"00000000-0000-4000-8000-{n:012d}" for n in (101, 102, 103)]
            scope = dict(workspaceId=workspace, homeId=home)
            origin, expiry = "https://native.example.invalid:8443", 4102444800.0
            cookie, csrf = "__Host-houseatlas-session=generated_original_token_123456", "generated-original-csrf"
            # These fields represent completed native initialization. There are
            # deliberately no login/refresh/exchange/journal methods to borrow.
            native_owner = SimpleNamespace(origin=origin, url=urlsplit(origin), cookie=cookie, csrf=csrf)
            established = SimpleNamespace(owner=native_owner, scope=scope.copy(), actor=actor,
                                          csrf=csrf, session_expiry=expiry)
            owner_before, bridge_before = vars(native_owner).copy(), vars(established).copy()
            scope_before = established.scope.copy()
            # Explicitly unconfigured geometry is this positive's native-owner
            # selection. Existing runtime fixtures remain pinned and unchanged;
            # their tiny validator is synthetic, never a compiled native peer.
            application = ApplicationExpectations((workspace, home), False, False, False,
                                                  None, None, None, None, None, None, None, None)
            documents = PinnedApplicationDocuments(None, None, None)
            view = dict(status="ready", scope=scope, homeLabel="Generated home", now="2026-01-02T00:00:00Z",
                        canEdit=False, homes=[dict(scope, label="Generated home")], entries=[], caches=[],
                        sourceDocumentsService=dict(profile="houseatlas.geodata-document-read.v2", available=False),
                        modelOverviewService=dict(profile="houseatlas.model-overview-read.v1", available=False,
                                                  publicationId=None, manifestSha256=None))
            session = dict(schemaVersion=1, actorId=actor, csrfToken=csrf,
                           expiresAt=datetime.fromtimestamp(expiry, timezone.utc).isoformat().replace("+00:00", "Z"))
            view_path = f"/api/atlas/v1/workspaces/{workspace}/homes/{home}/view"
            paths = ["/index.html", "/api/atlas/auth/session", view_path, view_path, "/api/atlas/auth/session"]
            replies = iter([None, session, view, view, session])
            streams, events, waits, peers = [], [], [], []

            def record(label, callback):
                def call(*args):
                    events.append((label, runtime.running, runtime.native, runtime.fence, args[-1]))
                    return callback(*args)
                return call

            platform = replace(runtime.platform, **{
                field.name: record(field.name, getattr(runtime.platform, field.name))
                for field in fields(PlatformOperations) if field.name != "readiness"})

            def qualify_peer(process, deadline):
                events.append(("qualify-peer", runtime.running, runtime.native, runtime.fence, deadline))
                peers.append((process, deadline))
                # Generated owner attestation only; no real endpoint lookup.
                return process is runtime.running and process.birth != old_process.birth

            def socket_factory(family, kind):
                self.assertEqual((family, kind), (socket.AF_INET, socket.SOCK_STREAM))
                self.assertEqual(Journal.read(world.policy.journal_directory)["operations"][
                    json.loads(apply_raw)["operationId"]]["status"]["phase"], "verifying")
                value = next(replies)
                body = ((world.installed.frontend / "index.html").read_bytes().replace(
                    b'id="root"', runtime_fixture._served_root) if value is None else canonical(value))
                stream = read_fixture.GeneratedStream(body, "text/html" if value is None else "application/json", {})
                streams.append(stream)
                return stream

            def wait(readers, writers, exceptional, timeout):
                self.assertGreater(timeout, 0)
                waits.append(timeout)
                return readers, writers, []

            def wrap(stream, *, server_hostname, do_handshake_on_connect, suppress_ragged_eofs):
                self.assertEqual(server_hostname, "native.example.invalid")
                self.assertFalse(do_handshake_on_connect)
                self.assertFalse(suppress_ragged_eofs)
                return stream

            # Existing transport is constructed only after the generated owner
            # has established all session fields. No real TLS/trust query runs.
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            transport = EstablishedNativeReadTransport(
                established, "192.0.2.2", context, _socket_factory=socket_factory,
                _wait=wait, _wrap_socket=wrap)
            bindings = TrustedMaintenanceBindings(
                policy=world.policy, acquisition=world, manifest_verifier=world.fixture_manifest,
                parse_manifest=runtime.parse_manifest, native_policy=runtime.inspector.policy,
                validate_native=runtime.validate_generated, platform=platform,
                read_installed=record("installed", runtime.read_installed),
                compare_and_swap=record("cas", runtime.activate), service_identity=runtime.service,
                application=application, documents=documents, established_bridge=established,
                transport=transport, qualify_read_peer=qualify_peer, operation_timeout_seconds=30, claim_seconds=5)
            # Whitespace is intentional: authorization must see original bytes,
            # even though the existing journal binds canonical request identity.
            check_raw = b" \n" + json.dumps(json.loads(generated.packet("check", selected, before, 1)), indent=2).encode() + b"\n"
            apply_raw = b"\n" + json.dumps(json.loads(generated.packet("apply", selected, before, 2)), indent=1).encode() + b" \n"
            status_raw = json.dumps(dict(format="houseatlas.updater.status-request.v1",
                                         operationId=json.loads(apply_raw)["operationId"]), indent=2).encode() + b"\n"
            requests = [("check", check_raw), ("apply", apply_raw), ("status", status_raw)]
            approved, remaining = [], iter(requests)

            def authorize(command, raw):
                approved.append((command, raw))
                return (command, raw) == next(remaining)  # Disposable exact synthetic approval only.

            maintenance = compose_maintenance(bindings, authorize=authorize)
            self.assertEqual((events, streams, runtime.calls, approved), ([], [], [], []))
            self.assertFalse((world.policy.journal_directory / "journal.json").exists())
            self.assertEqual(bridge.Stdio(established).maintenance_tools, [])
            stdio = bridge.Stdio(established, maintenance=maintenance)
            stdio.handle(dict(jsonrpc="2.0", id=1, method="initialize",
                              params=dict(protocolVersion=bridge.PROTOCOLS[0])))
            stdio.handle(dict(jsonrpc="2.0", method="notifications/initialized", params={}))
            listed = stdio.handle(dict(jsonrpc="2.0", id=2, method="tools/list", params={}))
            self.assertEqual(listed["tools"], [*bridge.TOOLS, *maintenance.catalog()])
            self.assertEqual((events, streams, runtime.calls, approved), ([], [], [], []))
            results = []
            for number, (command, raw) in enumerate(requests, 3):
                reply = stdio.handle(dict(jsonrpc="2.0", id=number, method="tools/call", params=dict(
                    name="houseatlas_update_" + command, arguments=dict(requestJson=raw.decode()))))
                self.assertFalse(reply["isError"])
                results.append(json.loads(reply["content"][0]["text"]))
                if command == "check":
                    self.assertEqual((streams, runtime.calls), ([], []))
                    self.assertEqual(world.installed, before)

            self.assertEqual(approved, requests)
            self.assertTrue(all(result["ok"] for result in results))
            self.assertEqual([result["status"]["phase"] for result in results], ["checked", "succeeded", "succeeded"])
            self.assertEqual(results[1]["status"], results[2]["status"])
            self.assertTrue(results[1]["status"]["healthVerified"])
            self.assertFalse(results[1]["status"]["recoveryNeeded"])
            self.assertEqual(runtime.calls, ["fence", "stop-full-birth", "prove-exit", "lease", "exact-cas",
                                             "release-lease", "start-existing"])
            actions = {"fence", "stop_existing", "wait_exited", "acquire_native", "cas",
                       "release_native", "start_existing", "qualify-peer"}
            ordered = [event for event in events if event[0] in actions]
            self.assertEqual([event[0] for event in ordered], ["fence", "stop_existing", "wait_exited",
                             "acquire_native", "cas", "release_native", "start_existing", "qualify-peer", "qualify-peer"])
            self.assertIs(ordered[1][1], old_process)
            self.assertTrue(all(event[1] is None for event in ordered[2:7]))
            self.assertIsNotNone(ordered[4][2])  # CAS runs under the existing lease and fence.
            self.assertIsNotNone(ordered[4][3])
            observations = [event[1] for event in events if event[0] == "process"]
            self.assertIs(observations[0], old_process)
            self.assertIn(None, observations)
            self.assertIs(observations[-1], runtime.running)
            self.assertNotEqual(runtime.running.birth, old_process.birth)
            self.assertEqual(peers, [(runtime.running, peers[0][1])] * 2)
            self.assertLess(time.monotonic(), peers[0][1])
            self.assertEqual(len(streams), 5)
            for path, stream in zip(paths, streams):
                self.assertTrue(bytes(stream.sent).startswith(f"GET {path} HTTP/1.1\r\n".encode()))
                self.assertIn(f"Cookie: {cookie}\r\n".encode(), stream.sent)
                self.assertEqual(stream.endpoint, ("192.0.2.2", 8443))
                self.assertEqual(stream.offset, len(stream.wire))
                self.assertTrue(stream.closed)
            self.assertEqual(waits, sorted(waits, reverse=True))
            self.assertEqual(world.calls, ["acquire", "acquire"])
            journal = Journal.read(world.policy.journal_directory)
            self.assertEqual(len(journal["operations"]), 2)
            for _, raw in requests[:2]:
                packet = json.loads(raw)
                self.assertEqual(journal["operations"][packet["operationId"]]["requestSha256"], sha256(canonical(packet)))
            self.assertEqual(journal["operations"][journal["current"]]["status"], results[2]["status"])
            self.assertEqual(generated.native_cut(world.root / "native"), native_before)
            effective = json.loads(runtime.effective.read_bytes())
            self.assertEqual(effective.pop("frontendDirectory"), str(world.installed.frontend))
            config_before.pop("frontendDirectory")
            self.assertEqual(effective, config_before)
            self.assertEqual((before.binary.read_bytes(), (before.frontend / "index.html").read_bytes()), prior_code)
            self.assertEqual((world.installed.frontend / "assets/legacy-deadbeef.js").read_bytes(),
                             (before.frontend / "assets/legacy-deadbeef.js").read_bytes())
            self.assertEqual(vars(native_owner), owner_before)
            self.assertEqual(vars(established), bridge_before)
            self.assertEqual(established.scope, scope_before)
            public = json.dumps(results).encode()
            self.assertTrue(all(value not in public for value in (cookie.encode(), csrf.encode(), str(world.root).encode())))


if __name__ == "__main__":
    unittest.main()
