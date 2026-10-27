"""Synthetic guard/receipt checks; no Cargo build or profiler execution."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("runtime_profile", Path(__file__).with_name("run.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def hanging_tree(root):
    """Generated parent/descendant both ignore TERM; only this owned group runs."""
    child = f"""import os,signal,time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
Path({str(root / 'child.pid')!r}).write_text(str(os.getpid()))
while True: time.sleep(1)
"""
    script = root / "hanging-workload"
    script.write_text(f"""#!{sys.executable}
import os,signal,subprocess,sys,time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
Path({str(root / 'parent.pid')!r}).write_text(str(os.getpid()))
subprocess.Popen([sys.executable, '-c', {child!r}])
while True: time.sleep(1)
""")
    script.chmod(0o700)
    return script


def stop_fixture_group(root):
    path = root / "parent.pid"
    if path.exists():
        try:
            os.killpg(int(path.read_text()), signal.SIGKILL)
        except ProcessLookupError:
            pass


def process_terminated(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    path = Path(f"/proc/{pid}/stat")
    if path.exists():
        # An orphan zombie is already terminated; we cannot reap grandchildren.
        return path.read_text().rsplit(")", 1)[1].strip().split()[0] == "Z"
    return False


class RuntimeProfileTests(unittest.TestCase):
    def assert_tree_stopped(self, root):
        for name in ("parent.pid", "child.pid"):
            self.assertTrue((root / name).exists(), "hanging fixture must start both processes")
            pid = int((root / name).read_text())
            end = time.monotonic() + 2
            while not process_terminated(pid) and time.monotonic() < end:
                time.sleep(0.01)
            self.assertTrue(process_terminated(pid), f"synthetic process {pid} survived cleanup")

    def test_profile_is_pending_until_cargo_owner_adds_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "Cargo.toml").write_text("[workspace]\n")
            self.assertFalse(runtime.profile_check(root)["available"])

    def test_require_optimized_full_symbols_without_stripping(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for debug, strip, expected in [(2, '"none"', True), (0, '"none"', False), (2, '"symbols"', False)]:
                (root / "Cargo.toml").write_text(
                    f'[profile.profiling]\ninherits="release"\ndebug={debug}\nstrip={strip}\n'
                )
                self.assertEqual(runtime.profile_check(root)["available"], expected)

    def test_cargo_context_refuses_inherited_config_without_reading_contents(self):
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder)
            root, cache = parent / "checkout", parent / "cache"
            root.mkdir()
            cache.mkdir()
            context = runtime.cargo_context(root, cache)
            self.assertEqual(len(context["sha256"]), 64)
            for path in (root / ".cargo/config.toml", parent / ".cargo/config", cache / "config.toml"):
                path.parent.mkdir(exist_ok=True)
                path.write_text("synthetic unreviewed configuration; never read")
                with patch.object(Path, "read_text", side_effect=AssertionError("config read")), self.assertRaises(runtime.Unavailable):
                    runtime.cargo_context(root, cache)
                path.unlink()

    def test_cargo_context_rejects_broken_config_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cache = root / "cache"
            cache.mkdir()
            (cache / "config").symlink_to(root / "absent")
            with self.assertRaises(runtime.Unavailable):
                runtime.cargo_context(root, cache)

    def test_restricted_linux_perf_stops_without_launching_processes(self):
        with tempfile.TemporaryDirectory() as folder:
            policy = Path(folder) / "perf_event_paranoid"
            policy.write_text("4\n")
            with patch.object(runtime.shutil, "which", return_value="/synthetic/samply"), patch.object(runtime.subprocess, "run") as run:
                result = runtime.sampling_check("Linux", policy)
            self.assertFalse(result["available"])
            self.assertEqual(result["perfEventParanoid"], 4)
            run.assert_not_called()
            self.assertEqual(policy.read_text(), "4\n")

    def test_child_environment_does_not_forward_credentials_or_injection(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(runtime.os.environ, {"SYNTHETIC_TOKEN": "fake", "LD_PRELOAD": "fake", "RUSTFLAGS": "fake", "CARGO_INCREMENTAL": "1"}):
                environment = runtime.child_environment(Path(folder))
            self.assertNotIn("SYNTHETIC_TOKEN", environment)
            self.assertNotIn("LD_PRELOAD", environment)
            self.assertNotIn("RUSTFLAGS", environment)
            self.assertNotIn("CARGO_INCREMENTAL", environment)
            self.assertEqual(environment["TZ"], "UTC")

    def test_output_cannot_enter_checkout_or_reuse_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "checkout"
            root.mkdir()
            with self.assertRaises(ValueError):
                runtime.new_output(root / "profiles", root)
            output = runtime.new_output(Path(folder) / "new", root)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(FileExistsError):
                runtime.new_output(output, root)

    def columnar_profile(self, time_key="timeDeltas"):
        # Samply processed-profile SampleTable columns; not raw Gecko schema/data.
        return {"threads": [{"samples": {"length": 2, "weightType": "samples",
                "stack": [0, None], "weight": [1, 1],
                time_key: [0, 1.25], "threadCPUDelta": [None, 1.0]}}]}

    def test_processed_columnar_profiles_count_samples_including_nested(self):
        profile = self.columnar_profile()
        profile["processes"] = [self.columnar_profile("time")]
        self.assertEqual(runtime.count_samples(profile), 4)
        self.assertEqual(runtime.count_samples({"threads": []}), 0)
        empty = {"threads": [{"samples": {"length": 0, "weightType": "samples",
                 "stack": [], "weight": [], "timeDeltas": [], "threadCPUDelta": []}}]}
        self.assertEqual(runtime.count_samples(empty), 0)

    def test_processed_columnar_mismatches_and_raw_rows_fail_closed(self):
        for column in ("stack", "weight", "timeDeltas", "threadCPUDelta"):
            profile = self.columnar_profile()
            profile["threads"][0]["samples"][column].pop()
            with self.subTest(column=column), self.assertRaises(ValueError):
                runtime.count_samples(profile)
        for profile in ({}, {"threads": [{"samples": {"data": [[0]], "schema": {}}}]}):
            with self.assertRaises(ValueError):
                runtime.count_samples(profile)
        profile = self.columnar_profile()
        profile["threads"][0]["samples"]["length"] = True
        with self.assertRaises(ValueError):
            runtime.count_samples(profile)

    @unittest.skipUnless(hasattr(runtime.os, "wait4") and Path("/usr/bin/true").exists(), "requires POSIX resource accounting")
    def test_rss_accounts_for_three_fresh_synthetic_processes(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            samples = runtime.process_rss(Path("/usr/bin/true"), output, runtime.child_environment(output))
            self.assertEqual(len(samples), 3)
            self.assertTrue(all(sample["exitCode"] == 0 for sample in samples))
            self.assertTrue(all(sample["wallSeconds"] >= 0 and sample["peakRssBytes"] >= 0 for sample in samples))

    def test_prepare_writes_only_plan_without_build_or_profiling(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "plan"
            with patch.object(runtime, "plan", return_value={"synthetic": True}), patch.object(runtime, "build") as build, patch.object(runtime, "observe") as observe:
                self.assertEqual(runtime.run(SimpleNamespace(mode="prepare", output=output)), 0)
            self.assertEqual(json.loads((output / "plan.json").read_text()), {"synthetic": True})
            build.assert_not_called()
            observe.assert_not_called()

    def test_missing_tool_writes_blocked_receipt_without_build(self):
        from types import SimpleNamespace
        source = {"commit": "0" * 40, "tree": "1" * 40, "dirty": False}
        selected = {"source": source, "profile": {"available": True},
                    "tools": {"sampling": {"available": False, "reason": "Samply missing"}}}
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "blocked"
            with patch.object(runtime, "plan", return_value=selected), patch.object(runtime, "identity", return_value=source), patch.object(runtime, "build") as build:
                result = runtime.run(SimpleNamespace(mode="cpu", output=output))
            receipt = json.loads((output / "receipt.json").read_text())
            self.assertEqual(result, 2)
            self.assertEqual(receipt["status"], "blocked")
            self.assertEqual(receipt["reason"], "Samply missing")
            self.assertNotIn("observation", receipt)
            build.assert_not_called()

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "wait4"), "requires POSIX groups")
    def test_rss_deadline_writes_partial_receipt_and_stops_descendant(self):
        from types import SimpleNamespace
        source = {"commit": "0" * 40, "tree": "1" * 40, "dirty": False}
        selected = {"source": source, "profile": {"available": True}, "tools": {"rss": {"available": True}}}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script = hanging_tree(root)
            try:
                with patch.object(runtime, "plan", return_value=selected), patch.object(runtime, "identity", return_value=source), patch.object(runtime, "build", return_value=script), patch.object(runtime, "OBSERVATION_TIMEOUT", 0.5), patch.object(runtime, "TERMINATION_GRACE", 0.05), patch.object(runtime, "REAP_GRACE", 0.5):
                    start = time.monotonic()
                    result = runtime.run(SimpleNamespace(mode="rss", output=root / "output"))
                receipt = json.loads((root / "output/receipt.json").read_text())
                self.assertEqual(result, 124)
                self.assertLess(time.monotonic() - start, 4)
                self.assertEqual(receipt["status"], "timed-out")
                sample = receipt["observation"]["samples"][0]
                self.assertFalse(sample["complete"])
                self.assertEqual(sample["status"], "timed-out")
                self.assertTrue(sample["cleanup"]["directChildReaped"])
                self.assertIn("SIGKILL", sample["cleanup"]["signals"])
                self.assert_tree_stopped(root)
            finally:
                stop_fixture_group(root)

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "wait4"), "requires POSIX groups")
    def test_observation_error_preserves_receipt_and_stops_descendant(self):
        from types import SimpleNamespace
        source = {"commit": "0" * 40, "tree": "1" * 40, "dirty": False}
        selected = {"source": source, "profile": {"available": True}, "tools": {"rss": {"available": True}}}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script = hanging_tree(root)
            original_reap, injected = runtime.reap_owned, []
            def fail_once(process, record):
                if (root / "child.pid").exists() and not injected:
                    injected.append(True)
                    raise RuntimeError("synthetic observation failure")
                original_reap(process, record)
            try:
                with patch.object(runtime, "plan", return_value=selected), patch.object(runtime, "identity", return_value=source), patch.object(runtime, "build", return_value=script), patch.object(runtime, "reap_owned", side_effect=fail_once), patch.object(runtime, "TERMINATION_GRACE", 0.05), patch.object(runtime, "REAP_GRACE", 0.5):
                    result = runtime.run(SimpleNamespace(mode="rss", output=root / "output"))
                receipt = json.loads((root / "output/receipt.json").read_text())
                self.assertEqual(result, 2)
                self.assertEqual(receipt["status"], "error")
                sample = receipt["observation"]["samples"][0]
                self.assertEqual(sample["status"], "error")
                self.assertFalse(sample["complete"])
                self.assertTrue(sample["cleanup"]["directChildReaped"])
                self.assert_tree_stopped(root)
            finally:
                stop_fixture_group(root)

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "wait4"), "requires POSIX groups")
    def test_logged_and_fake_build_deadlines_stop_descendants(self):
        for phase in ("logged", "build"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                script = hanging_tree(root)
                output = root / "output"
                output.mkdir()
                receipt = {"plan": {"rustToolchain": "1.99.0"}}
                try:
                    with patch.object(runtime, "OBSERVATION_TIMEOUT", 0.5), patch.object(runtime, "BUILD_TIMEOUT", 0.5), patch.object(runtime, "TERMINATION_GRACE", 0.05), patch.object(runtime, "REAP_GRACE", 0.5):
                        if phase == "logged":
                            with self.assertRaises(runtime.ProcessDeadline):
                                runtime.logged([script], output, "synthetic-profiler", runtime.child_environment(output), receipt)
                        else:
                            for name, code in {
                                "rustc": 'print("rustc 1.99.0 synthetic")',
                                "cargo": f'import os,sys\nif sys.argv[1:] == ["-V"]: print("cargo synthetic")\nelse: os.execv({str(script)!r}, [{str(script)!r}])',
                                "rustup": f'print({str(root / "rustc")!r})',
                            }.items():
                                file = root / name
                                file.write_text(f"#!{sys.executable}\n{code}\n")
                                file.chmod(0o700)
                            with patch.object(runtime.shutil, "which", return_value=str(root / "rustup")), self.assertRaises(runtime.ProcessDeadline):
                                runtime.build(output, receipt)
                    process = receipt["processes"][0]
                    self.assertEqual(process["status"], "timed-out")
                    self.assertTrue(process["cleanup"]["directChildReaped"])
                    self.assert_tree_stopped(root)
                finally:
                    stop_fixture_group(root)

    @unittest.skipUnless(os.name == "posix" and hasattr(os, "wait4"), "requires POSIX groups")
    def test_sigterm_orchestrator_writes_interrupted_receipt_and_stops_descendant(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            script = hanging_tree(root)
            source = {"commit": "0" * 40, "tree": "1" * 40, "dirty": False}
            code = f"""import importlib.util,sys
from pathlib import Path
from types import SimpleNamespace
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('runtime', {str(Path(runtime.__file__))!r})
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
r.plan=lambda: {{'source':{source!r},'profile':{{'available':True}},'tools':{{'rss':{{'available':True}}}}}}
r.identity=lambda: {source!r}
r.build=lambda output,receipt: Path({str(script)!r})
r.OBSERVATION_TIMEOUT=30;r.TERMINATION_GRACE=0.05;r.REAP_GRACE=0.5
sys.exit(r.run(SimpleNamespace(mode='rss',output=Path({str(root / 'output')!r}))))
"""
            with (root / "driver.stdout").open("w") as stdout, (root / "driver.stderr").open("w") as stderr:
                driver = subprocess.Popen([sys.executable, "-c", code], stdout=stdout, stderr=stderr, start_new_session=True)
                try:
                    end = time.monotonic() + 4
                    while not (root / "child.pid").exists() and driver.poll() is None and time.monotonic() < end:
                        time.sleep(0.01)
                    self.assertTrue((root / "child.pid").exists())
                    driver.send_signal(signal.SIGTERM)
                    self.assertEqual(driver.wait(timeout=4), 143)
                    receipt = json.loads((root / "output/receipt.json").read_text())
                    self.assertEqual(receipt["status"], "interrupted")
                    self.assertEqual(receipt["signal"], "SIGTERM")
                    self.assertEqual(receipt["observation"]["samples"][0]["status"], "interrupted")
                    self.assert_tree_stopped(root)
                finally:
                    if driver.poll() is None:
                        os.killpg(driver.pid, signal.SIGKILL)
                        driver.wait(timeout=4)
                    stop_fixture_group(root)


if __name__ == "__main__":
    unittest.main()
