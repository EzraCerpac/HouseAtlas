"""Fixed-origin HTTPS, with numeric owner bindings instead of unbounded DNS.

No socket is opened at import/construction. No resolver, proxy, subprocess,
thread, redirect, retry, credential store or content decoder is consulted.
The optional underscored ports exist only for generated in-process fixtures.
"""

import errno
import ipaddress
import math
import re
import select
import socket
import ssl
import time
from collections.abc import Mapping
from contextlib import contextmanager
from types import MappingProxyType
from urllib.parse import urlsplit

from houseatlas_updater.model import UpdateError
from houseatlas_updater.validation import require


ORIGINS = frozenset({"api.github.com", "release-assets.githubusercontent.com"})
HEADER_LIMIT = 16 * 1024
READ_LIMIT = 64 * 1024
_TOKEN = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")
_HEADERS = frozenset({"accept", "accept-encoding", "user-agent", "x-github-api-version"})


class _Budget:
    def __init__(self, deadline, clock, wait):
        require(type(deadline) in (int, float) and math.isfinite(deadline), "acquisition-failed")
        self.deadline, self.clock, self.wait = deadline, clock, wait
        self.remaining()

    def remaining(self):
        left = self.deadline - self.clock()
        require(left > 0, "acquisition-failed")
        return left

    def ready(self, stream, *, write=False):
        left = self.remaining()
        readable, writable, exceptional = self.wait(
            [] if write else [stream], [stream] if write else [], [stream], left)
        self.remaining()
        require(not exceptional and bool(writable if write else readable), "acquisition-failed")

    def call(self, stream, action, *, write=False):
        while True:
            self.remaining()
            try:
                result = action()
            except ssl.SSLWantReadError:
                self.ready(stream)
                continue
            except ssl.SSLWantWriteError:
                self.ready(stream, write=True)
                continue
            except BlockingIOError:
                self.ready(stream, write=write)
                continue
            self.remaining()
            return result


class _Response:
    def __init__(self, stream, budget, header_limit):
        self._stream, self._budget = stream, budget
        self._closed = False
        self._header_left = header_limit
        self._framing_left = header_limit
        status = self._line(header=True)
        require(re.fullmatch(rb"HTTP/1\.[01] [2-5][0-9]{2}(?: [\x20-\x7e]*)?", status)
                is not None, "acquisition-failed")
        self.status = int(status[9:12])
        headers = {}
        while True:
            line = self._line(header=True)
            if not line:
                break
            require(len(headers) < 100 and b":" in line, "acquisition-failed")
            key, value = line.split(b":", 1)
            name = key.decode("ascii").lower()
            require(_TOKEN.fullmatch(name) is not None and name not in headers and
                    all(byte == 9 or 32 <= byte <= 126 for byte in value), "acquisition-failed")
            headers[name] = value.decode("ascii").strip(" \t")
        self.headers = MappingProxyType(headers)
        length = headers.get("content-length")
        transfer = headers.get("transfer-encoding")
        require(transfer in (None, "chunked") and not (length is not None and transfer is not None),
                "acquisition-failed")
        require(headers.get("content-encoding", "identity") == "identity", "acquisition-failed")
        if length is not None:
            require(re.fullmatch(r"[0-9]{1,10}", length) is not None, "acquisition-failed")
        self._left = None if length is None else int(length)
        self._chunked, self._chunk_left, self._done = transfer == "chunked", 0, False
        self._chunk_ending = False

    def _recv(self, size):
        return self._budget.call(self._stream, lambda: self._stream.recv(size))

    def _line(self, *, header=False):
        # One-byte application reads never allocate an over-budget raw header,
        # nor prefetch body data before the caller supplies its body read bound.
        result = bytearray()
        while True:
            left = self._header_left if header else self._framing_left
            require(left > 0, "acquisition-failed")
            part = self._recv(1)
            require(len(part) == 1, "acquisition-failed")
            if header:
                self._header_left -= 1
            else:
                self._framing_left -= 1
            result.extend(part)
            if result.endswith(b"\r\n"):
                return bytes(result[:-2])
            require(part != b"\n", "acquisition-failed")

    def read(self, size, *, deadline):
        require(not self._closed and type(size) is int and 0 < size <= READ_LIMIT and
                type(deadline) in (int, float) and math.isfinite(deadline) and
                deadline <= self._budget.deadline, "acquisition-failed")
        # A caller may shorten but cannot extend the acquisition deadline.
        self._budget.deadline = deadline
        self._budget.remaining()
        if self._done or self._left == 0:
            return b""
        if self._chunked:
            if self._chunk_left == 0:
                if self._chunk_ending:
                    require(self._line() == b"", "acquisition-failed")
                line = self._line()
                require(re.fullmatch(rb"[0-9A-Fa-f]{1,8}", line) is not None, "acquisition-failed")
                self._chunk_left = int(line, 16)
                if self._chunk_left == 0:
                    # This narrow profile accepts no trailers or chunk extensions.
                    require(self._line() == b"", "acquisition-failed")
                    self._done = True
                    return b""
            size = min(size, self._chunk_left)
        elif self._left is not None:
            size = min(size, self._left)
        data = self._recv(size)
        require(type(data) is bytes and len(data) <= size, "acquisition-failed")
        if self._chunked:
            require(bool(data), "acquisition-failed")
            self._chunk_left -= len(data)
            self._chunk_ending = self._chunk_left == 0
        elif self._left is not None:
            require(bool(data), "acquisition-failed")
            self._left -= len(data)
        else:
            self._done = not data
        return data

    def close(self):
        self._closed = True
        self._stream.close()


class BoundedHttps:
    """Owner-only numeric bindings; hostname verification still uses the origin.

    address_bindings maps either fixed hostname to one numeric IPv4/IPv6 address.
    An omitted hostname fails closed. It is never resolved or retried. Construct
    the trust context before the acquisition budget starts; no ambient SSL
    certificate environment variables are used. No caller protocol configures it.
    """

    def __init__(self, address_bindings: Mapping[str, str], *,
                 _clock=time.monotonic, _wait=select.select,
                 _socket_factory=socket.socket, _tls_context=None):
        require(isinstance(address_bindings, Mapping) and set(address_bindings) <= ORIGINS,
                "acquisition-failed")
        self._bindings = {}
        for host, value in address_bindings.items():
            require(type(value) is str and "%" not in value, "acquisition-failed")
            address = ipaddress.ip_address(value)
            self._bindings[host] = (socket.AF_INET if address.version == 4 else socket.AF_INET6,
                                    str(address))
        self._clock, self._wait, self._socket = _clock, _wait, _socket_factory
        if _tls_context is None:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            # Explicit default paths bypass SSL_CERT_FILE/SSL_CERT_DIR overrides.
            paths = ssl.get_default_verify_paths()
            require(bool(paths.openssl_cafile), "acquisition-failed")
            context.load_verify_locations(cafile=paths.openssl_cafile)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.set_alpn_protocols(["http/1.1"])
            self._tls = context
        else:
            self._tls = _tls_context
        require(self._tls.check_hostname is True and self._tls.verify_mode == ssl.CERT_REQUIRED,
                "acquisition-failed")

    @contextmanager
    def open(self, url, *, headers, deadline, max_header_bytes):
        stream = response = None
        try:
            budget = _Budget(deadline, self._clock, self._wait)
            require(type(url) is str and 0 < len(url) <= 8192 and url.isascii() and
                    not any(ord(c) <= 32 or ord(c) == 127 for c in url) and "\\" not in url,
                    "acquisition-failed")
            parsed = urlsplit(url)
            require(parsed.scheme == "https" and parsed.netloc in ORIGINS and not parsed.fragment and
                    parsed.path.startswith("/") and parsed.netloc in self._bindings,
                    "acquisition-failed")
            host = parsed.netloc
            require(isinstance(headers, Mapping) and 0 < len(headers) <= len(_HEADERS) and
                    all(type(key) is str and key in _HEADERS for key in headers), "acquisition-failed")
            require(headers.get("accept-encoding") == "identity" and
                    (host == "api.github.com" or "x-github-api-version" not in headers),
                    "acquisition-failed")
            require(all(type(value) is str and 0 < len(value) <= 1024 and
                        all(32 <= ord(c) <= 126 for c in value) for value in headers.values()),
                    "acquisition-failed")
            require(type(max_header_bytes) is int and 0 < max_header_bytes <= HEADER_LIMIT,
                    "acquisition-failed")
            target = parsed.path + ("?" + parsed.query if parsed.query else "")
            # Host is mandatory HTTP routing, derived from the fixed TLS origin.
            # All other fields are exactly supplied; no auth/cookie/proxy fields.
            request = (f"GET {target} HTTP/1.1\r\nHost: {host}\r\n" +
                       "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n").encode("ascii")
            family, address = self._bindings[host]
            stream = self._socket(family, socket.SOCK_STREAM)
            stream.setblocking(False)
            endpoint = (address, 443) if family == socket.AF_INET else (address, 443, 0, 0)
            budget.remaining()
            code = stream.connect_ex(endpoint)
            budget.remaining()
            require(code in (0, errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY), "acquisition-failed")
            if code:
                budget.ready(stream, write=True)
                require(stream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR) == 0, "acquisition-failed")
            stream = self._tls.wrap_socket(stream, server_hostname=host,
                                           do_handshake_on_connect=False, suppress_ragged_eofs=False)
            budget.call(stream, stream.do_handshake)
            require(stream.selected_alpn_protocol() in (None, "http/1.1"), "acquisition-failed")
            offset = 0
            view = memoryview(request)
            while offset < len(view):
                count = budget.call(stream, lambda: stream.send(view[offset:]), write=True)
                require(type(count) is int and 0 < count <= len(view) - offset, "acquisition-failed")
                offset += count
            response = _Response(stream, budget, max_header_bytes)
            yield response
        except UpdateError:
            raise
        except Exception:
            raise UpdateError("acquisition-failed") from None
        finally:
            try:
                if response is not None:
                    response.close()
                elif stream is not None:
                    stream.close()
            except Exception:
                raise UpdateError("acquisition-failed") from None
