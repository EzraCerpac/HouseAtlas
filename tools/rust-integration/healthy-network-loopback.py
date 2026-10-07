#!/usr/bin/env python3
"""One fixture TLS GET and six real root TLS requests. No stopped controls."""
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Expected compiled healthy-network-root-router example")
    executable = Path(sys.argv[1]).resolve(strict=True)
    root = Path(__file__).resolve().parents[2]
    payload = (root / "backend/src/providers/network/host_runtime/examples/fixtures/inventory-with-observation.wire.json").read_bytes()
    supplied = json.loads(payload)
    original = json.loads((root / "adapters/network/fixtures/inventory.wire.json").read_bytes())
    original["observations"] = supplied["observations"]
    assert supplied == original  # Preserve every original inventory/revision value.
    with tempfile.TemporaryDirectory(prefix="houseatlas-network-tls-") as directory:
        cert = Path(directory) / "certificate.pem"
        authority_cert = Path(directory) / "authority.pem"
        authority_key = Path(directory) / "authority-key.pem"
        request = Path(directory) / "server.csr"
        extensions = Path(directory) / "server.ext"
        extensions.write_text("subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
        key = Path(directory) / "key.pem"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
            "-days", "1", "-subj", "/CN=Disposable Network test CA",
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-keyout", str(authority_key), "-out", str(authority_cert),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
            "-subj", "/CN=127.0.0.1", "-keyout", str(key), "-out", str(request)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["openssl", "x509", "-req", "-in", str(request), "-CA", str(authority_cert),
            "-CAkey", str(authority_key), "-CAcreateserial", "-days", "1", "-sha256", "-extfile", str(extensions), "-out", str(cert)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.chmod(key, 0o600)
        os.chmod(authority_key, 0o600)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        errors = []
        requests = []
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            listener.settimeout(45)
            port = listener.getsockname()[1]

            def serve():
                try:
                    plain, _ = listener.accept()
                    plain.settimeout(10)
                    with plain, context.wrap_socket(plain, server_side=True) as stream:
                        headers = bytearray()
                        while not headers.endswith(b"\r\n\r\n"):
                            byte = stream.recv(1)
                            if not byte or len(headers) >= 4096:
                                raise RuntimeError("Incomplete bounded request")
                            headers.extend(byte)
                        line = headers.split(b"\r\n", 1)[0]
                        assert line == b"GET /api/inventory HTTP/1.1"
                        requests.append(line)
                        stream.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
                        for offset in range(0, len(payload), 700):
                            chunk = payload[offset:offset + 700]
                            stream.sendall(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                        stream.sendall(b"0\r\n\r\n")
                except Exception as error:
                    errors.append(error)

            worker = threading.Thread(target=serve, daemon=True)
            worker.start()
            run = subprocess.run([str(executable), f"https://127.0.0.1:{port}", str(authority_cert), str(cert), str(key)], timeout=60, check=False)
            worker.join(timeout=1)
            if run.returncode:
                raise SystemExit(run.returncode)
            if worker.is_alive() or errors or len(requests) != 1:
                raise RuntimeError("Healthy single GET fixture did not complete")
            print("PASS fixture request: exactly passive GET /api/inventory; disposable certificate and key removed")


if __name__ == "__main__":
    main()
