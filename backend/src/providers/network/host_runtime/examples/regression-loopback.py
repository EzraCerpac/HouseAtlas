#!/usr/bin/env python3
"""Explicit policy-108 synthetic lane. Four cases only; no discovery or CI hook."""
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading

CASES = {
    "shared-source-flight": [(200, True)],
    "cancel-before-prepare": [],
    "cancel-inflight": [(200, True), (200, False)],
    "captured-failure-time": [(200, False), (503, False)],
}


def certificate(directory):
    directory = Path(directory)
    cert, key = directory / "server.pem", directory / "server-key.pem"
    ca, ca_key = directory / "ca.pem", directory / "ca-key.pem"
    request, extensions = directory / "server.csr", directory / "server.ext"
    extensions.write_text("subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
    commands = [
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
         "-days", "1", "-subj", "/CN=Disposable synthetic regression CA",
         "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", str(ca_key), "-out", str(ca)],
        ["openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
         "-subj", "/CN=127.0.0.1", "-keyout", str(key), "-out", str(request)],
        ["openssl", "x509", "-req", "-in", str(request), "-CA", str(ca), "-CAkey", str(ca_key),
         "-CAcreateserial", "-days", "1", "-sha256", "-extfile", str(extensions), "-out", str(cert)],
    ]
    for command in commands:
        subprocess.run(command, check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.chmod(key, 0o600)
    os.chmod(ca_key, 0o600)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    return ca, context


def main():
    if len(sys.argv) != 3 or sys.argv[2] not in CASES:
        raise SystemExit("Expected exact compiled network-host-regression and one allowed case")
    executable = Path(sys.argv[1]).resolve(strict=True)
    case = sys.argv[2]
    plan = CASES[case]
    root = Path(__file__).resolve().parents[6]
    payload = (Path(__file__).parent / "fixtures/inventory-with-observation.wire.json").read_bytes()
    original = json.loads((root / "adapters/network/fixtures/inventory.wire.json").read_bytes())
    supplied = json.loads(payload)
    original["observations"] = supplied["observations"]
    assert supplied == original  # Preserve all original source/revision inputs.
    assert len(payload) < 64 * 1024
    directory_path = None
    with tempfile.TemporaryDirectory(prefix="houseatlas-network-regression-tls-") as directory:
        directory_path = Path(directory)
        ca, context = certificate(directory)
        errors, requests, output = [], [], []
        release = threading.Event()
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(2)
            listener.settimeout(15)
            origin = f"https://127.0.0.1:{listener.getsockname()[1]}"
            process = subprocess.Popen([str(executable), case, origin, str(ca)],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

            def read_output():
                for line in process.stdout:
                    output.append(line.decode("utf-8", errors="strict").rstrip())
                    if line == b"RELEASE\n":
                        release.set()

            def serve():
                try:
                    for index, (status, blocked) in enumerate(plan):
                        plain, peer = listener.accept()
                        assert peer[0] == "127.0.0.1"
                        plain.settimeout(10)
                        with plain, context.wrap_socket(plain, server_side=True) as stream:
                            headers = bytearray()
                            while not headers.endswith(b"\r\n\r\n"):
                                byte = stream.recv(1)
                                if not byte or len(headers) >= 4096:
                                    raise RuntimeError("Incomplete bounded inventory request")
                                headers.extend(byte)
                            line = headers.split(b"\r\n", 1)[0]
                            assert line == b"GET /api/inventory HTTP/1.1"
                            requests.append(line)
                            if blocked:
                                process.stdin.write(b"inventory-received\n")
                                process.stdin.flush()
                                if not release.wait(timeout=10):
                                    raise RuntimeError("Missing bounded client release")
                            body = payload if status == 200 else b""
                            reason = b"OK" if status == 200 else b"Service Unavailable"
                            response = (b"HTTP/1.1 " + str(status).encode() + b" " + reason +
                                        b"\r\nContent-Type: application/json\r\nContent-Length: " +
                                        str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
                            try:
                                stream.sendall(response)
                            except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                                if case != "cancel-inflight" or index != 0:
                                    raise
                except Exception as error:
                    errors.append(error)

            reader = threading.Thread(target=read_output, daemon=True)
            worker = threading.Thread(target=serve, daemon=True)
            reader.start()
            worker.start()
            try:
                result = process.wait(timeout=60)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                release.set()
                process.stdin.close()
            worker.join(timeout=2)
            reader.join(timeout=2)
            process.stdout.close()
            for line in output:
                if line != "RELEASE":
                    print(line)
            passed = any(line.startswith(f"PASS {case}: genuine same-Core/AT11/Store/native;") for line in output)
            if result or not passed or worker.is_alive() or reader.is_alive() or errors or len(requests) != len(plan):
                raise RuntimeError(f"Case failed: exit={result}, requests={len(requests)}, expected={len(plan)}, errors={errors}")
            # Assert there is no extra request queued, including cancellation's retry.
            listener.settimeout(0.1)
            try:
                unexpected, _ = listener.accept()
            except socket.timeout:
                pass
            else:
                unexpected.close()
                raise RuntimeError("Unexpected additional inventory request")
            print(f"PASS transport {case}: exactly {len(plan)} passive inventory GET(s); verified loopback TLS")
    assert not directory_path.exists()
    print("PASS cleanup: temporary CA/key and synthetic database roots removed")


if __name__ == "__main__":
    main()
