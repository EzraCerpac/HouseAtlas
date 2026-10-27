"""Synthetic guard/receipt checks; no Cargo build or profiler execution."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("runtime_profile", Path(__file__).with_name("run.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeProfileTests(unittest.TestCase):
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
            with patch.dict(runtime.os.environ, {"SYNTHETIC_TOKEN": "fake", "LD_PRELOAD": "fake", "RUSTFLAGS": "fake"}):
                environment = runtime.child_environment(Path(folder))
            self.assertNotIn("SYNTHETIC_TOKEN", environment)
            self.assertNotIn("LD_PRELOAD", environment)
            self.assertNotIn("RUSTFLAGS", environment)
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

    def test_nested_profiles_count_samples_and_empty_is_zero(self):
        self.assertEqual(runtime.count_samples({"threads": [{"samples": {"data": [[0], [1]]}}], "processes": [{"threads": [{"samples": {"data": [[2]]}}]}]}), 3)
        self.assertEqual(runtime.count_samples({}), 0)

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


if __name__ == "__main__":
    unittest.main()
