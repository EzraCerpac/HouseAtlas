"""Concrete fixed-route HTTPS reads using an already established native owner.

Import/construction installs nothing and opens no connection. No login, renewal,
logout, journal, DNS, proxy, environment configuration or maintenance grant.
Underscored socket/clock/wait/wrap ports are generated-test inputs only.
"""

from contextlib import contextmanager
from dataclasses import dataclass
import errno
import ipaddress
import math
import re
import select
import socket
import ssl
import threading
import time
from types import MappingProxyType
from urllib.parse import urlsplit

from houseatlas_updater.model import UpdateError
from .runtime import SERVED_INDEX_LIMIT


HEADER_LIMIT = 16 * 1024
CHUNK_LIMIT = 64 * 1024
MAX_REQUESTS = 12
MAX_ATTEMPT_BYTES = 72 * 1024 * 1024
MAX_SECONDS = 120
_UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
_SHA = re.compile(r"[0-9a-f]{64}")
_TOKEN = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")


def _need(condition):
    if not condition:
        raise UpdateError("health-failed")


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _uuid(value):
    return type(value) is str and _UUID.fullmatch(value) is not None


def _sha(value):
    return type(value) is str and _SHA.fullmatch(value) is not None


@dataclass(frozen=True)
class FixedRead:
    """Closed route code and identity data; contains no URL/path/header selection."""
    route: str
    publication_id: str | None = None
    sha256: str | None = None
    selection_revision: str | None = None


@dataclass(frozen=True)
class _Route:
    path: str
    mime: str
    limit: int
    length_required: bool = False


def _route(value, scope):
    _need(type(value) is FixedRead and type(value.route) is str)
    workspace, home = scope
    base = f"/api/atlas/models/v1/workspaces/{workspace}/homes/{home}"
    plain = {
        "session": _Route("/api/atlas/auth/session", "application/json", 16384),
        "view": _Route(f"/api/atlas/v1/workspaces/{workspace}/homes/{home}/view", "application/json", 2 * 1024 * 1024),
        "overview": _Route(base + "/overview", "application/json", 128 * 1024),
        "index": _Route("/index.html", "text/html", SERVED_INDEX_LIMIT),
        "saved-index": _Route("/saved/index.html", "text/html", 4_000_000),
    }
    if value.route in plain:
        _need(value.publication_id is None and value.sha256 is None and value.selection_revision is None)
        return plain[value.route]
    _need(_sha(value.sha256))
    if value.route == "scene":
        _need(value.publication_id is None and value.selection_revision is None)
        return _Route(base + "/atlas?expectedManifestSha256=" + value.sha256,
                      "application/json", 12 * 1024 * 1024 + 256 * 1024)
    _need(_uuid(value.publication_id))
    if value.route == "overview-model":
        _need(value.selection_revision is None)
        return _Route(base + f"/overview/{value.publication_id}/original?expectedSha256={value.sha256}",
                      "model/gltf-binary", 32 * 1024 * 1024, True)
    _need(_sha(value.selection_revision))
    if value.route == "scene-model":
        path = base + f"/atlas/{value.publication_id}/artifacts/model?expectedSha256={value.sha256}"
        return _Route(path + "&expectedSelectionRevision=" + value.selection_revision,
                      "model/gltf-binary", 32 * 1024 * 1024, True)
    _need(value.route == "room-links")
    path = base + f"/atlas/{value.publication_id}/room-links?expectedSemanticsSha256={value.sha256}"
    return _Route(path + "&expectedSelectionRevision=" + value.selection_revision,
                  "application/json", 1024 * 1024, True)


class EstablishedNativeReadTransport:
    """Borrow existing Bridge/HTTPSOwner custody; perform concrete bounded I/O.

    numeric_peer_address and qualified_tls_context are trusted existing network
    owner inputs prepared before an attempt, never caller protocol parameters.
    The TLS context must already contain the qualified trust policy. This class
    neither loads credentials/trust files nor changes that context's settings.
    """

    def __init__(self, established_bridge, numeric_peer_address, qualified_tls_context, *,
                 _socket_factory=socket.socket, _wait=select.select,
                 _monotonic=time.monotonic, _wall=time.time, _wrap_socket=None):
        try:
            self._bridge = established_bridge
            self._owner = established_bridge.owner
            self._origin = self._owner.origin
            _need(type(self._origin) is str and len(self._origin) <= 1024 and self._origin.isascii() and
                  not any(ord(c) <= 32 or ord(c) == 127 for c in self._origin) and "\\" not in self._origin)
            self._url = urlsplit(self._origin)
            _need(self._url.scheme == "https" and bool(self._url.hostname) and
                  not self._url.username and not self._url.password and not self._url.path and
                  not self._url.query and not self._url.fragment and
                  self._origin == "https://" + self._url.netloc and self._owner.url == self._url)
            self._port = self._url.port or 443
            _need(0 < self._port <= 65535)
            scope = established_bridge.scope
            _need(type(scope) is dict and set(scope) == {"workspaceId", "homeId"})
            self._scope = (scope["workspaceId"], scope["homeId"])
            self._actor, self._expiry = established_bridge.actor, established_bridge.session_expiry
            self._cookie, self._csrf = self._owner.cookie, self._owner.csrf
            _need(all(_uuid(value) for value in (*self._scope, self._actor)) and _finite(self._expiry))
            _need(type(self._cookie) is str and re.fullmatch(
                r"__Host-houseatlas-session=[A-Za-z0-9_-]{16,1024}", self._cookie) is not None)
            _need(type(self._csrf) is str and 0 < len(self._csrf) <= 8192 and
                  all(32 < ord(c) < 127 for c in self._csrf) and established_bridge.csrf == self._csrf)
            _need(type(numeric_peer_address) is str and "%" not in numeric_peer_address)
            address = ipaddress.ip_address(numeric_peer_address)
            self._family = socket.AF_INET if address.version == 4 else socket.AF_INET6
            self._endpoint = ((str(address), self._port) if address.version == 4 else
                              (str(address), self._port, 0, 0))
            _need(isinstance(qualified_tls_context, ssl.SSLContext) and
                  qualified_tls_context.check_hostname is True and
                  qualified_tls_context.verify_mode == ssl.CERT_REQUIRED and
                  qualified_tls_context.minimum_version >= ssl.TLSVersion.TLSv1_2)
            self._context = qualified_tls_context
            self._tls_policy = (qualified_tls_context.check_hostname, qualified_tls_context.verify_mode,
                                qualified_tls_context.minimum_version, qualified_tls_context.maximum_version,
                                qualified_tls_context.verify_flags, qualified_tls_context.options)
            self._socket, self._wait = _socket_factory, _wait
            self._clock, self._wall = _monotonic, _wall
            self._wrap = qualified_tls_context.wrap_socket if _wrap_socket is None else _wrap_socket
            self._active = None
            self._attempt_lock = threading.Lock()
            self._custody()
        except Exception:
            raise UpdateError("health-failed") from None

    def _custody(self):
        bridge, owner = self._bridge, self._owner
        _need(bridge.owner is owner and owner.origin == self._origin and owner.url == self._url and
              owner.cookie == self._cookie and owner.csrf == self._csrf and bridge.csrf == self._csrf and
              bridge.actor == self._actor and type(bridge.actor) is str and
              bridge.scope == {"workspaceId": self._scope[0], "homeId": self._scope[1]} and
              type(bridge.scope) is dict and _finite(bridge.session_expiry) and
              bridge.session_expiry == self._expiry and self._expiry > self._wall() and
              (self._context.check_hostname, self._context.verify_mode, self._context.minimum_version,
               self._context.maximum_version, self._context.verify_flags, self._context.options) == self._tls_policy)

    @contextmanager
    def attempt(self, *, deadline):
        """One nonparallel <=120-second attempt, <=12 GETs and <=72MiB total body.

        Every open/read uses this same absolute deadline. A later independent
        attempt can reuse the original owner only while its custody is unchanged.
        """
        attempt, held = None, False
        try:
            held = self._attempt_lock.acquire(blocking=False)
            _need(held)
            _need(self._active is None)
            attempt = _Attempt(self, deadline)
            self._active = attempt
            yield attempt
            attempt.guard()
        except Exception:
            raise UpdateError("health-failed") from None
        finally:
            try:
                if attempt is not None:
                    attempt.close()
            finally:
                if held:
                    self._active = None
                    self._attempt_lock.release()


class _Attempt:
    def __init__(self, transport, deadline):
        _need(_finite(deadline))
        self._transport, self._deadline = transport, deadline
        self._closed, self._response = False, None
        self._open_lock = threading.Lock()
        self._requests, self._bytes = 0, 0
        _need(0 < deadline - transport._clock() <= MAX_SECONDS)
        self.guard()

    @property
    def deadline(self):
        return self._deadline

    def guard(self):
        _need(not self._closed)
        self._transport._custody()
        left = self.deadline - self._transport._clock()
        _need(left > 0 and self._transport._expiry - self._transport._wall() > left)
        return left

    def ready(self, stream, *, write=False):
        readable, writable, exceptional = self._transport._wait(
            [] if write else [stream], [stream] if write else [], [stream], self.guard())
        self.guard()
        _need(not exceptional and bool(writable if write else readable))

    def call(self, stream, action, *, write=False):
        while True:
            self.guard()
            try:
                value = action()
            except ssl.SSLWantReadError:
                self.ready(stream)
                continue
            except ssl.SSLWantWriteError:
                self.ready(stream, write=True)
                continue
            except BlockingIOError:
                self.ready(stream, write=write)
                continue
            self.guard()
            return value

    @contextmanager
    def open(self, request: FixedRead, *, max_header_bytes=HEADER_LIMIT):
        stream = response = None
        held = False
        try:
            held = self._open_lock.acquire(blocking=False)
            _need(held)
            self.guard()
            _need(self._response is None and self._requests < MAX_REQUESTS and
                  type(max_header_bytes) is int and 0 < max_header_bytes <= HEADER_LIMIT)
            route = _route(request, self._transport._scope)
            self._requests += 1
            transport = self._transport
            # The credential is borrowed only for this fixed origin. CSRF and
            # gateway identity are never sent by these GET-only requests.
            wire = (f"GET {route.path} HTTP/1.1\r\nHost: {transport._url.netloc}\r\n"
                    f"Accept: {route.mime}\r\nOrigin: {transport._origin}\r\n"
                    f"Referer: {transport._origin}/\r\nSec-Fetch-Site: same-origin\r\n"
                    "Cache-Control: no-store\r\nAccept-Encoding: identity\r\n"
                    f"Cookie: {transport._cookie}\r\n\r\n").encode("ascii")
            stream = transport._socket(transport._family, socket.SOCK_STREAM)
            stream.setblocking(False)
            self.guard()
            code = stream.connect_ex(transport._endpoint)
            self.guard()
            _need(code in (0, errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY))
            if code:
                self.ready(stream, write=True)
                _need(stream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR) == 0)
            self.guard()
            stream = transport._wrap(stream, server_hostname=transport._url.hostname,
                                     do_handshake_on_connect=False, suppress_ragged_eofs=False)
            self.call(stream, stream.do_handshake)
            _need(stream.selected_alpn_protocol() in (None, "http/1.1"))
            offset, view = 0, memoryview(wire)
            while offset < len(view):
                sent = self.call(stream, lambda: stream.send(view[offset:]), write=True)
                _need(type(sent) is int and 0 < sent <= len(view) - offset)
                offset += sent
            response = _Response(self, stream, route, max_header_bytes)
            self._response = response
            yield response
            self.guard()
        except Exception:
            raise UpdateError("health-failed") from None
        finally:
            try:
                if response is not None:
                    response.close()
                elif stream is not None:
                    stream.close()
            except Exception:
                raise UpdateError("health-failed") from None
            finally:
                if self._response is response:
                    self._response = None
                if held:
                    self._open_lock.release()

    def close(self):
        self._closed = True
        if self._response is not None:
            try:
                self._response.close()
            except Exception:
                raise UpdateError("health-failed") from None
            finally:
                self._response = None


class _Response:
    def __init__(self, attempt, stream, route, header_limit):
        self._attempt, self._stream, self._route = attempt, stream, route
        self._closed, self._body_bytes = False, 0
        self._header_left, self._framing_left = header_limit, HEADER_LIMIT
        status = self._line(header=True)
        _need(re.fullmatch(rb"HTTP/1\.[01] 200(?: [\x20-\x7e]*)?", status) is not None)
        self.status = 200
        headers = {}
        while True:
            line = self._line(header=True)
            if not line:
                break
            _need(len(headers) < 100 and b":" in line)
            key, value = line.split(b":", 1)
            name = key.decode("ascii").lower()
            _need(_TOKEN.fullmatch(name) is not None and name not in headers and
                  all(byte == 9 or 32 <= byte <= 126 for byte in value))
            headers[name] = value.decode("ascii").strip(" \t")
        _need("location" not in headers and "set-cookie" not in headers and
              headers.get("content-encoding", "identity") == "identity" and
              headers.get("content-type", "").split(";", 1)[0].strip() == route.mime and
              headers.get("cache-control") == "private, no-store" and
              headers.get("x-content-type-options") == "nosniff")
        length, transfer = headers.get("content-length"), headers.get("transfer-encoding")
        _need(transfer in (None, "chunked") and not (length is not None and transfer is not None))
        _need(not route.length_required or length is not None)
        if length is not None:
            _need(re.fullmatch(r"[0-9]{1,10}", length) is not None and int(length) <= route.limit)
        self.headers = MappingProxyType(headers)
        self._left = None if length is None else int(length)
        self._chunked, self._chunk_left = transfer == "chunked", 0
        self._chunk_ending, self._done = False, False

    def _recv(self, size):
        value = self._attempt.call(self._stream, lambda: self._stream.recv(size))
        _need(type(value) is bytes and len(value) <= size)
        return value

    def _line(self, *, header=False):
        data = bytearray()
        while True:
            _need((self._header_left if header else self._framing_left) > 0)
            part = self._recv(1)
            _need(len(part) == 1)
            if header:
                self._header_left -= 1
            else:
                self._framing_left -= 1
            data.extend(part)
            if data.endswith(b"\r\n"):
                return bytes(data[:-2])
            _need(part != b"\n")

    def read(self, size: int) -> bytes:
        try:
            _need(not self._closed and type(size) is int and 0 < size <= CHUNK_LIMIT)
            self._attempt.guard()
            if self._done or self._left == 0:
                return b""
            if self._chunked:
                if self._chunk_left == 0:
                    if self._chunk_ending:
                        _need(self._line() == b"")
                    line = self._line()
                    _need(re.fullmatch(rb"[0-9A-Fa-f]{1,8}", line) is not None)
                    self._chunk_left = int(line, 16)
                    if self._chunk_left == 0:
                        _need(self._line() == b"")  # No trailers or extensions.
                        self._done = True
                        return b""
                size = min(size, self._chunk_left)
            elif self._left is not None:
                size = min(size, self._left)
            size = min(size, self._route.limit - self._body_bytes + 1,
                       MAX_ATTEMPT_BYTES - self._attempt._bytes + 1)
            data = self._recv(size)
            _need(self._body_bytes + len(data) <= self._route.limit and
                  self._attempt._bytes + len(data) <= MAX_ATTEMPT_BYTES)
            self._body_bytes += len(data)
            self._attempt._bytes += len(data)
            if self._chunked:
                _need(bool(data))
                self._chunk_left -= len(data)
                self._chunk_ending = self._chunk_left == 0
            elif self._left is not None:
                _need(bool(data))
                self._left -= len(data)
            else:
                self._done = not data
            return data
        except Exception:
            raise UpdateError("health-failed") from None

    def close(self):
        if not self._closed:
            self._closed = True
            try:
                self._stream.close()
            except Exception:
                raise UpdateError("health-failed") from None
