"""One generated successful transport attempt; no socket, DNS or TLS query."""

import errno
import socket
import ssl
from types import SimpleNamespace
import unittest
from urllib.parse import urlsplit

from houseatlas_updater_runtime.established_native_http import (
    EstablishedNativeReadTransport, FixedRead, HEADER_LIMIT,
)


class GeneratedClock:
    def __init__(self):
        self.monotonic = 100.0

    def clock(self):
        self.monotonic += 0.00001
        return self.monotonic

    def wall(self):
        return 1_000_000.0 + self.monotonic


class GeneratedSocket:
    def __init__(self, body, mime, *, chunked):
        headers = ("HTTP/1.1 200 OK\r\nContent-Type: " + mime +
                   "\r\nCache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\n")
        if chunked:
            self.wire = (headers + "Transfer-Encoding: chunked\r\n\r\n").encode() + (
                f"{len(body):x}\r\n".encode() + body + b"\r\n0\r\n\r\n")
        else:
            self.wire = (headers + f"Content-Length: {len(body)}\r\n\r\n").encode() + body
        self.offset, self.sent = 0, bytearray()
        self.waits, self.read_sizes = [], []
        self.closed, self.nonblocking = False, False
        self.send_pending, self.read_pending, self.handshakes = True, True, 0

    def setblocking(self, value):
        assert value is False
        self.nonblocking = True

    def connect_ex(self, endpoint):
        self.endpoint = endpoint
        return errno.EINPROGRESS

    def getsockopt(self, level, option):
        assert (level, option) == (socket.SOL_SOCKET, socket.SO_ERROR)
        return 0

    def do_handshake(self):
        self.handshakes += 1
        if self.handshakes == 1:
            raise ssl.SSLWantReadError()
        if self.handshakes == 2:
            raise ssl.SSLWantWriteError()

    def selected_alpn_protocol(self):
        return "http/1.1"

    def send(self, data):
        if self.send_pending:
            self.send_pending = False
            raise BlockingIOError(errno.EAGAIN, "generated ordinary send readiness")
        count = min(len(data), 19)
        self.sent.extend(data[:count])
        return count

    def recv(self, size):
        if self.read_pending:
            self.read_pending = False
            raise BlockingIOError(errno.EAGAIN, "generated ordinary read readiness")
        self.read_sizes.append(size)
        end = min(self.offset + size, self.offset + 3, len(self.wire))
        data, self.offset = self.wire[self.offset:end], end
        return data

    def close(self):
        self.closed = True


class EstablishedNativeHttpHappyPaths(unittest.TestCase):
    def test_existing_session_fixed_get_partial_io_and_deadline(self):
        clock = GeneratedClock()
        workspace, home, actor, publication = [f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 5)]
        sha, revision = "a" * 64, "b" * 64
        origin = "https://native.example.invalid:8443"
        cookie = "__Host-houseatlas-session=generated_original_token_123456"
        csrf = "generated-original-csrf"

        def unavailable(*args, **kwargs):
            raise AssertionError("No existing owner exchange/login/session/journal call is permitted")

        owner = SimpleNamespace(origin=origin, url=urlsplit(origin), cookie=cookie, csrf=csrf,
                                login=unavailable, logout=unavailable, exchange=unavailable)
        bridge = SimpleNamespace(owner=owner, actor=actor, csrf=csrf, session_expiry=1_001_000.0,
                                 scope={"workspaceId": workspace, "homeId": home},
                                 journal=SimpleNamespace(bind=unavailable), session=unavailable,
                                 prepare_session=unavailable, close_session=unavailable)
        before_owner, before_bridge = vars(owner).copy(), vars(bridge).copy()
        scope_before = bridge.scope.copy()
        base = f"/api/atlas/models/v1/workspaces/{workspace}/homes/{home}"
        routes = [
            (FixedRead("session"), "/api/atlas/auth/session", "application/json", b'{"generated":"session"}', False),
            (FixedRead("view"), f"/api/atlas/v1/workspaces/{workspace}/homes/{home}/view", "application/json", b'{"status":"ready"}', True),
            (FixedRead("overview"), base + "/overview", "application/json", b'{"generated":"overview"}', False),
            (FixedRead("scene", sha256=sha), base + "/atlas?expectedManifestSha256=" + sha,
             "application/json", b'{"generated":"scene"}', False),
            (FixedRead("overview-model", publication, sha), base + f"/overview/{publication}/original?expectedSha256={sha}",
             "model/gltf-binary", b"generated pinned model bytes", False),
            (FixedRead("scene-model", publication, sha, revision),
             base + f"/atlas/{publication}/artifacts/model?expectedSha256={sha}&expectedSelectionRevision={revision}",
             "model/gltf-binary", b"generated pinned model bytes", False),
            (FixedRead("room-links", publication, sha, revision),
             base + f"/atlas/{publication}/room-links?expectedSemanticsSha256={sha}&expectedSelectionRevision={revision}",
             "application/json", b'{"generated":"room-links"}', False),
            (FixedRead("index"), "/index.html", "text/html", b'<html><div id="root"></div></html>', True),
            (FixedRead("saved-index"), "/saved/index.html", "text/html", b"<html>Generated saved shell</html>", False),
        ]
        streams = [GeneratedSocket(body, mime, chunked=chunked) for _, _, mime, body, chunked in routes]
        pending, timeouts, hostnames = iter(streams), [], []

        def socket_factory(family, kind):
            self.assertEqual((family, kind), (socket.AF_INET6, socket.SOCK_STREAM))
            return next(pending)

        def wait(readers, writers, exceptional, timeout):
            self.assertGreater(timeout, 0)
            self.assertLess(timeout, 30)
            timeouts.append(timeout)
            (writers or readers)[0].waits.append("write" if writers else "read")
            clock.monotonic += 0.001
            return readers, writers, []

        def wrap(stream, *, server_hostname, do_handshake_on_connect, suppress_ragged_eofs):
            self.assertTrue(stream.nonblocking)
            self.assertFalse(do_handshake_on_connect)
            self.assertFalse(suppress_ragged_eofs)
            hostnames.append(server_hostname)
            return stream

        # Constructs only a TLS policy object. The wrap fixture never creates a
        # TLS socket, loads trust material or performs a certificate query.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        transport = EstablishedNativeReadTransport(
            bridge, "2001:db8::2", context, _socket_factory=socket_factory,
            _wait=wait, _monotonic=clock.clock, _wall=clock.wall, _wrap_socket=wrap)
        deadline = clock.clock() + 30
        with transport.attempt(deadline=deadline) as attempt:
            for (request, path, mime, body, _), stream in zip(routes, streams):
                with attempt.open(request, max_header_bytes=HEADER_LIMIT) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers["content-type"], mime)
                    received = bytearray()
                    while True:
                        chunk = response.read(5)
                        if not chunk:
                            break
                        self.assertLessEqual(len(chunk), 5)
                        received.extend(chunk)
                    self.assertEqual(bytes(received), body)
                    self.assertEqual(attempt.deadline, deadline)
                expected = (f"GET {path} HTTP/1.1\r\nHost: native.example.invalid:8443\r\nAccept: {mime}\r\n"
                            f"Origin: {origin}\r\nReferer: {origin}/\r\nSec-Fetch-Site: same-origin\r\n"
                            f"Cache-Control: no-store\r\nAccept-Encoding: identity\r\nCookie: {cookie}\r\n\r\n").encode()
                self.assertEqual(bytes(stream.sent), expected)
                self.assertEqual(stream.endpoint, ("2001:db8::2", 8443, 0, 0))
                self.assertEqual(stream.waits, ["write", "read", "write", "write", "read"])
                self.assertTrue(stream.closed)
                self.assertTrue(all(size <= 5 for size in stream.read_sizes))
            self.assertLess(clock.monotonic, deadline)
        self.assertEqual(hostnames, ["native.example.invalid"] * len(routes))
        self.assertEqual(timeouts, sorted(timeouts, reverse=True))
        self.assertEqual(vars(owner), before_owner)
        self.assertEqual(vars(bridge), before_bridge)
        self.assertEqual(bridge.scope, scope_before)


if __name__ == "__main__":
    unittest.main()
