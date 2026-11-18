#!/usr/bin/env python3
"""Opt-in Unix runner controls; generated loopback TLS and fake process owners only."""
from contextlib import contextmanager, redirect_stdout
import http.client
import importlib.util
import io
import os
from pathlib import Path
import shlex
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "network_binary_loopback", Path(__file__).with_name("network-binary-loopback.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Process:
    def __init__(self, on_terminate=lambda: None, stall=False):
        self.returncode = None
        self.terminated = self.killed = self.waited = False
        self.on_terminate, self.stall = on_terminate, stall

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.on_terminate()

    def wait(self, timeout):
        self.waited = True
        if self.stall and not self.killed:
            raise subprocess.TimeoutExpired("generated-process", timeout)
        self.returncode = -9 if self.killed else 0
        return self.returncode

    def kill(self):
        self.killed = True


class RunnerChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="houseatlas-runner-controls-")
        cls.addClassCleanup(cls.directory.cleanup)
        cls.root = Path(cls.directory.name).resolve()
        cls.ca, cert, key = runner.certificates(cls.root)
        cls.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cls.tls.load_cert_chain(cert, key)

    @contextmanager
    def trickle(self, headers):
        stop, sent, errors = threading.Event(), [], []
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            listener.settimeout(1)

            def serve():
                try:
                    plain, _ = listener.accept()
                    plain.settimeout(1)
                    with plain, self.tls.wrap_socket(plain, server_side=True) as stream:
                        request = b""
                        while b"\r\n\r\n" not in request:
                            part = stream.recv(4096)
                            if not part:
                                return
                            request += part
                        body = b" " * 40 + b"{}"
                        head = f"HTTP/1.1 200 OK\r\nContent-Length: {len(body)}\r\n\r\n".encode()
                        if not headers:
                            stream.sendall(head)
                        for byte in (head + body if headers else body):
                            if stop.wait(0.03):
                                break
                            stream.sendall(bytes([byte]))
                            sent.append(byte)
                except (ConnectionError, ssl.SSLError):
                    pass  # Client deadline closes this generated peer.
                except Exception as error:
                    errors.append(error)

            worker = threading.Thread(target=serve, daemon=True)
            worker.start()
            try:
                yield runner.Client(listener.getsockname()[1], self.ca), sent
            finally:
                stop.set()
                worker.join(timeout=2)
                self.assertFalse(worker.is_alive())
                self.assertEqual(errors, [])

    def test_incremental_headers_have_a_whole_exchange_deadline(self):
        with self.trickle(headers=True) as (client, sent):
            started = time.monotonic()
            with self.assertRaises(TimeoutError):
                client.request("GET", "/", deadline=started + 0.2)
            self.assertLess(time.monotonic() - started, 1.3)
            self.assertGreater(len(sent), 1)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))

    def test_incremental_body_has_a_whole_exchange_deadline(self):
        with self.trickle(headers=False) as (client, sent):
            started = time.monotonic()
            with self.assertRaises(TimeoutError):
                client.request("GET", "/", deadline=started + 0.2)
            self.assertLess(time.monotonic() - started, 1.3)
            self.assertGreater(len(sent), 1)

    def test_readiness_passes_its_remaining_budget_into_incremental_reads(self):
        with self.trickle(headers=True) as (client, _sent):
            started = time.monotonic()
            with self.assertRaisesRegex(runner.QualificationFailure, "readiness timed out"):
                runner.wait_for_startup(Process(), client, started + 0.2)
            self.assertLess(time.monotonic() - started, 1.3)

    def test_readiness_rejects_a_late_positive_response(self):
        def late(*_args, **_kwargs):
            time.sleep(0.04)
            return 200, {}, {}

        with self.assertRaisesRegex(runner.QualificationFailure, "readiness timed out"):
            runner.wait_for_startup(Process(), SimpleNamespace(request=late), time.monotonic() + 0.02)

    def test_documented_target_validation_precedes_build_and_exports_the_selection(self):
        repo = Path(__file__).resolve().parents[2]
        guide = (repo / "docs/contributing/verification.md").read_text()
        section = guide.split("## Opt-in Network refresh through the production binary\n", 1)[1]
        block = section.split("```sh\n", 1)[1].split("```", 1)[0]
        target = self.root / "cargo-target"
        target.mkdir()
        for value in [None, "", "relative-target", str(target / "missing"), str(repo), str(target)]:
            with self.subTest(target=value):
                marker = self.root / "build-selection.txt"
                marker.unlink(missing_ok=True)
                # Execute the documented preflight; replace only the build/run owner
                # with a recorder, so these controls cannot invoke Cargo or a backend.
                record = (f"import os; from pathlib import Path; "
                          f"Path({str(marker)!r}).open('a').write(os.environ['CARGO_TARGET_DIR']+'\\n')")
                fake = f"{shlex.quote(sys.executable)} -c {shlex.quote(record)}"
                script = block.replace("mise run nas:build --", fake)
                if value is not None:
                    script = f"CARGO_TARGET_DIR={shlex.quote(value)}\n" + script
                env = os.environ.copy()
                env.pop("CARGO_TARGET_DIR", None)
                result = subprocess.run(["sh", "-c", script], cwd=repo, env=env,
                                        capture_output=True, timeout=15)
                if value == str(target):
                    self.assertEqual(result.returncode, 0, result.stderr.decode())
                    self.assertEqual(marker.read_text().splitlines(), [value, value])
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(marker.exists(), "Invalid selection reached build/run")

    @contextmanager
    def backend(self, process):
        profile = self.root / "profile.json"
        profile.write_text("{}")
        client = Mock()
        client.request.return_value = (200, {}, {})
        with patch.object(runner.subprocess, "Popen", return_value=process):
            with runner.backend(Path("generated-process"), self.root / "config.json",
                                profile, client, self.root / "backend.log"):
                yield

    def test_early_clean_exit_cannot_pass_the_drain_check(self):
        process = Process()
        with self.assertRaisesRegex(runner.QualificationFailure, "exited before SIGTERM"):
            with self.backend(process):
                process.returncode = 0
        self.assertFalse(process.terminated)

    def test_live_child_is_terminated_and_reaped(self):
        process = Process()
        with self.backend(process):
            pass
        self.assertTrue(process.terminated and process.waited)
        self.assertFalse(process.killed)

    def test_failed_drain_kills_and_reaps_the_owned_child(self):
        process = Process(stall=True)
        with self.assertRaisesRegex(runner.QualificationFailure, "did not drain"):
            with self.backend(process):
                pass
        self.assertTrue(process.terminated and process.killed and process.waited)

    def test_failed_drain_preserves_the_primary_error(self):
        process = Process(stall=True)
        with self.assertRaisesRegex(ValueError, "primary HTTP failure") as result:
            with self.backend(process):
                raise ValueError("primary HTTP failure")
        self.assertTrue(process.killed and process.waited)
        self.assertIn("did not drain", result.exception.__notes__[0])

    def test_get_during_sigterm_is_included_in_the_final_audit(self):
        with runner.collector_peer() as (origin, counts):
            def get_inventory():
                get("/api/inventory")

            def get(path):
                connection = http.client.HTTPConnection(origin.removeprefix("http://"), timeout=2)
                try:
                    connection.request("GET", path)
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    response.read()
                finally:
                    connection.close()

            for path in ["/api/inventory"] * 2 + ["/api/health", "/api/measurements", "/api/results"]:
                get(path)
            process = Process(on_terminate=get_inventory)
            with self.backend(process):
                self.assertEqual(counts()["GET", "/api/inventory"], 2)
            self.assertTrue(process.waited)
            with self.assertRaisesRegex(runner.QualificationFailure, "during backend shutdown"):
                runner.audit_collector(counts())

    def test_cleanup_pass_is_after_collector_and_directory_cleanup(self):
        state = {}

        def qualify(_executable, root):
            state["root"] = root
            (root / "owned.txt").write_text("generated")
            with runner.collector_peer():
                state["collector_stopped"] = False
            state["collector_stopped"] = True

        def printed(message, **_kwargs):
            if message.startswith("PASS cleanup"):
                self.assertTrue(state["collector_stopped"])
                self.assertFalse(state["root"].exists())
                state["passed"] = True

        with patch.object(sys, "argv", ["runner", "--executable", sys.executable]), \
                patch.object(runner, "qualify", side_effect=qualify), \
                patch("builtins.print", side_effect=printed):
            runner.main()
        self.assertTrue(state["passed"])

    def test_failed_cleanup_never_prints_pass_and_preserves_primary_error(self):
        for primary in [None, ValueError("primary qualification failure")]:
            with self.subTest(primary=primary):
                directory = tempfile.TemporaryDirectory(prefix="houseatlas-failed-cleanup-")

                def failed_cleanup():
                    directory.cleanup()
                    raise OSError("generated cleanup refusal")

                wrapper = SimpleNamespace(name=directory.name, cleanup=failed_cleanup)
                output = io.StringIO()
                with patch.object(sys, "argv", ["runner", "--executable", sys.executable]), \
                        patch.object(runner.tempfile, "TemporaryDirectory", return_value=wrapper), \
                        patch.object(runner, "qualify", side_effect=primary), redirect_stdout(output):
                    with self.assertRaises(type(primary) if primary else OSError) as result:
                        runner.main()
                self.assertNotIn("PASS cleanup", output.getvalue())
                self.assertFalse(Path(directory.name).exists())
                if primary:
                    self.assertIs(result.exception, primary)
                    self.assertIn("generated cleanup refusal", primary.__notes__[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
