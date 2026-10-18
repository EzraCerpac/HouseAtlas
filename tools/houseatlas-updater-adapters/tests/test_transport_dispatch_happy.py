"""Generated successful exchanges only: no socket, DNS, TLS or runtime access."""

import errno
import json
import socket
import ssl
import unittest

from bounded_http import BoundedHttps, HEADER_LIMIT
from maintenance_dispatch import dispatch
from maintenance_owner import MaintenanceOwner
from houseatlas_updater.validation import request


class GeneratedClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        self.now += 0.00001
        return self.now


class GeneratedSocket:
    def __init__(self, wire):
        self.wire, self.offset = wire, 0
        self.sent = bytearray()
        self.reads = []
        self.closed = False
        self.handshakes = 0
        self.send_pending = self.read_pending = True
        self.wait_modes = []

    def setblocking(self, value):
        assert value is False

    def connect_ex(self, endpoint):
        self.endpoint = endpoint
        return errno.EINPROGRESS

    def getsockopt(self, level, option):
        assert (level, option) == (socket.SOL_SOCKET, socket.SO_ERROR)
        return 0

    def do_handshake(self):
        self.handshakes += 1
        # Ordinary readiness progression; neither is a failed TLS handshake.
        if self.handshakes == 1:
            raise ssl.SSLWantReadError()
        if self.handshakes == 2:
            raise ssl.SSLWantWriteError()

    def selected_alpn_protocol(self):
        return "http/1.1"

    def send(self, data):
        if self.send_pending:
            self.send_pending = False
            raise BlockingIOError(errno.EAGAIN, "generated send readiness")
        count = min(len(data), 17)
        self.sent.extend(data[:count])
        return count

    def recv(self, size):
        if self.read_pending:
            self.read_pending = False
            raise BlockingIOError(errno.EAGAIN, "generated read readiness")
        self.reads.append(size)
        end = min(self.offset + size, self.offset + 3, len(self.wire))
        data = self.wire[self.offset:end]
        self.offset = end
        return data

    def close(self):
        self.closed = True


class GeneratedTls:
    check_hostname = True
    verify_mode = ssl.CERT_REQUIRED

    def __init__(self):
        self.hosts = []

    def wrap_socket(self, stream, *, server_hostname, do_handshake_on_connect, suppress_ragged_eofs):
        assert do_handshake_on_connect is False
        assert suppress_ragged_eofs is False
        self.hosts.append(server_hostname)
        return stream


class TransportDispatchHappyPaths(unittest.TestCase):
    def transport(self, wires):
        streams = [GeneratedSocket(wire) for wire in wires]
        pending = iter(streams)
        clock, tls, waits = GeneratedClock(), GeneratedTls(), []

        def factory(family, kind):
            self.assertIn(family, (socket.AF_INET, socket.AF_INET6))
            self.assertEqual(kind, socket.SOCK_STREAM)
            return next(pending)

        def ready(readers, writers, exceptional, timeout):
            self.assertGreater(timeout, 0)
            self.assertLess(timeout, 60)
            waits.append(timeout)
            (writers or readers)[0].wait_modes.append("write" if writers else "read")
            clock.now += 0.001
            return readers, writers, []

        transport = BoundedHttps({"api.github.com": "192.0.2.1",
                                  "release-assets.githubusercontent.com": "2001:db8::1"},
                                 _clock=clock, _wait=ready,
                                 _socket_factory=factory, _tls_context=tls)
        return transport, streams, clock, tls, waits

    def test_https_partial_reads_shared_deadline_and_closure(self):
        body = b'{"generated":"release"}'
        wire = (b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " +
                str(len(body)).encode() + b"\r\n\r\n" + body)
        transport, streams, clock, tls, waits = self.transport([wire])
        deadline = clock() + 60
        headers = {"accept": "application/vnd.github+json", "accept-encoding": "identity",
                   "user-agent": "HouseAtlas-source-acquisition/1", "x-github-api-version": "2022-11-28"}
        with transport.open("https://api.github.com/repos/EzraCerpac/HouseAtlas", headers=headers,
                            deadline=deadline, max_header_bytes=HEADER_LIMIT) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["content-length"], str(len(body)))
            received = bytearray()
            while True:
                data = response.read(5, deadline=deadline)
                if not data:
                    break
                received.extend(data)
            self.assertEqual(bytes(received), body)
        stream = streams[0]
        expected = ("GET /repos/EzraCerpac/HouseAtlas HTTP/1.1\r\nHost: api.github.com\r\n" +
                    "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n").encode()
        self.assertEqual(bytes(stream.sent), expected)
        self.assertEqual(stream.endpoint, ("192.0.2.1", 443))
        self.assertEqual(tls.hosts, ["api.github.com"])
        self.assertTrue(stream.closed)
        self.assertEqual(stream.wait_modes, ["write", "read", "write", "write", "read"])
        self.assertTrue(all(size <= 5 for size in stream.reads))
        self.assertEqual(waits, sorted(waits, reverse=True))
        self.assertLess(clock.now, deadline)

    def test_explicit_asset_redirect_then_chunked_body(self):
        location = "https://release-assets.githubusercontent.com/generated?signature=synthetic"
        redirect = f"HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\n\r\n".encode()
        asset = (b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n"
                 b"Transfer-Encoding: chunked\r\n\r\n4\r\ncode\r\n3\r\n123\r\n0\r\n\r\n")
        transport, streams, clock, tls, waits = self.transport([redirect, asset])
        deadline = clock() + 60
        headers = {"accept": "application/octet-stream", "accept-encoding": "identity",
                   "user-agent": "HouseAtlas-source-acquisition/1"}
        with transport.open("https://api.github.com/repos/EzraCerpac/HouseAtlas/releases/assets/20",
                            headers=headers, deadline=deadline, max_header_bytes=HEADER_LIMIT) as response:
            self.assertEqual(response.status, 302)
            self.assertEqual(response.headers["location"], location)
        self.assertEqual(streams[1].handshakes, 0)  # Redirect is exposed to caller.
        with transport.open(location, headers=headers, deadline=deadline,
                            max_header_bytes=HEADER_LIMIT) as response:
            received = bytearray()
            while True:
                data = response.read(2, deadline=deadline)
                if not data:
                    break
                self.assertLessEqual(len(data), 2)
                received.extend(data)
            self.assertEqual(bytes(received), b"code123")
        self.assertEqual(streams[1].endpoint, ("2001:db8::1", 443, 0, 0))
        self.assertEqual(tls.hosts, ["api.github.com", "release-assets.githubusercontent.com"])
        self.assertTrue(all(stream.closed for stream in streams))
        self.assertTrue(all(stream.wait_modes == ["write", "read", "write", "write", "read"]
                            for stream in streams))
        self.assertEqual(waits, sorted(waits, reverse=True))

    def test_fixed_dispatch_uses_existing_cli_once_per_request(self):
        class ControllerPort:
            def __init__(self):
                self.calls = []

            def execute(self, raw):
                packet, selected = request(raw)
                self.calls.append((packet["format"], raw))
                return None

            def status(self, operation_id):
                self.calls.append(("status", operation_id))
                return None

        controller = ControllerPort()
        release = {"version": "1.2.3", "commit": "1" * 40, "tree": "2" * 40,
                   "releaseId": 10, "assetId": 20,
                   "assetName": "houseatlas-1.2.3-x86_64-apple-darwin.tar.gz",
                   "archiveSha256": "3" * 64, "manifestSha256": "4" * 64}
        for index, command in enumerate(("check", "apply"), start=1):
            packet = {"format": f"houseatlas.updater.{command}.v1",
                      "operationId": f"00000000-0000-4000-8000-{index:012d}",
                      "expectedInstalledRevision": "5" * 64, "release": release}
            raw = json.dumps(packet).encode()
            result = dispatch(controller, command, raw)
            self.assertEqual(result, {"format": "houseatlas.updater.result.v1", "ok": True,
                                      "code": "none", "status": None})
            self.assertEqual(controller.calls[-1], (packet["format"], raw))
            self.assertEqual(len(controller.calls), index)
        for identifier in (None, "00000000-0000-4000-8000-000000000001"):
            raw = json.dumps({"format": "houseatlas.updater.status-request.v1",
                              "operationId": identifier}).encode()
            self.assertTrue(dispatch(controller, "status", raw)["ok"])
            self.assertEqual(controller.calls[-1], ("status", identifier))
        self.assertEqual(len(controller.calls), 4)

    def test_authorized_maintenance_catalog_and_exact_requests(self):
        events = []

        class ControllerPort:
            def execute(self, raw):
                packet, selected = request(raw)
                command = packet["format"].split(".")[-2]
                events.append(("execute", command, raw))
                return {"phase": "checked" if command == "check" else "succeeded",
                        "code": "none", "healthVerified": command == "apply", "recoveryNeeded": False}

            def status(self, identifier):
                events.append(("status", identifier))
                return None

        def authorize(command, raw):
            events.append(("authorize", command, raw))
            return True  # Generated exact authorization; never a runtime grant.

        owner = MaintenanceOwner(ControllerPort(), authorize=authorize)
        catalog = owner.catalog()
        self.assertEqual([entry["name"] for entry in catalog],
                         ["houseatlas_update_check", "houseatlas_update_apply", "houseatlas_update_status"])
        self.assertTrue(all(entry["inputSchema"]["additionalProperties"] is False for entry in catalog))
        self.assertTrue(all(entry["inputSchema"]["required"] == ["requestJson"] for entry in catalog))
        self.assertEqual([entry["annotations"]["readOnlyHint"] for entry in catalog], [False, False, True])
        self.assertIsNot(owner.catalog()[0], catalog[0])
        release = {"version": "1.2.3", "commit": "1" * 40, "tree": "2" * 40,
                   "releaseId": 10, "assetId": 20,
                   "assetName": "houseatlas-1.2.3-x86_64-apple-darwin.tar.gz",
                   "archiveSha256": "3" * 64, "manifestSha256": "4" * 64}
        for index, command in enumerate(("check", "apply"), start=1):
            packet = {"format": f"houseatlas.updater.{command}.v1",
                      "operationId": f"00000000-0000-4000-8000-{index:012d}",
                      "expectedInstalledRevision": "5" * 64, "release": release}
            text = json.dumps(packet, indent=1)  # Authorization binds exact whitespace too.
            result = owner.call("houseatlas_update_" + command, {"requestJson": text})
            self.assertTrue(result["ok"])
            self.assertEqual(result["status"]["phase"], "checked" if command == "check" else "succeeded")
            self.assertEqual(result["status"]["healthVerified"], command == "apply")
            self.assertEqual(events[-2:], [("authorize", command, text.encode()),
                                          ("execute", command, text.encode())])
        text = json.dumps({"format": "houseatlas.updater.status-request.v1", "operationId": None})
        self.assertEqual(owner.call("houseatlas_update_status", {"requestJson": text}),
                         {"format": "houseatlas.updater.result.v1", "ok": True,
                          "code": "none", "status": None})
        self.assertEqual(events[-2:], [("authorize", "status", text.encode()), ("status", None)])
        self.assertEqual(len(events), 6)
