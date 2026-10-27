#!/usr/bin/env python3
"""Opt-in profiling of the retained synthetic native backend example."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
import tomllib

ROOT = Path(__file__).resolve().parents[3]
WORKLOAD = {
    "id": "synthetic-native-home-read-pack/1",
    "example": "healthy-home-read-pack",
    "args": [],
    "source": "backend/examples/healthy-home-read-pack.rs",
    "scope": "Fresh synthetic native storage and actual in-process backend requests; includes setup, assertions and teardown; no socket HTTP",
}
PROFILE = "profiling"


class Unavailable(RuntimeError):
    pass


def sha(path):
    with Path(path).open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def capture(argv, **kwargs):
    return subprocess.check_output(
        [str(a) for a in argv], text=True, timeout=30, **kwargs
    ).strip()


def identity(root=ROOT):
    def git(*args):
        return capture(["git", "-C", root, *args])
    return {
        "commit": git("rev-parse", "HEAD"),
        "tree": git("rev-parse", "HEAD^{tree}"),
        "dirty": bool(git("status", "--porcelain=v1", "--untracked-files=normal")),
    }


def profile_check(root=ROOT):
    manifest = tomllib.loads((root / "Cargo.toml").read_text())
    selected = manifest.get("profile", {}).get(PROFILE)
    if selected is None:
        return {"available": False, "reason": "Cargo profile 'profiling' is pending its Cargo-mode owner"}
    valid = (
        selected.get("inherits") == "release"
        and selected.get("debug") == 2
        and selected.get("strip", "none") in ("none", False)
        and selected.get("opt-level", 3) == 3
    )
    return {
        "available": valid,
        "settings": selected,
        "reason": None if valid else "Require release-derived profiling, opt-level=3, debug=2 and strip=none",
    }


def sampling_check(system=None, paranoid_path=Path("/proc/sys/kernel/perf_event_paranoid")):
    system = system or platform.system()
    if system not in ("Linux", "Darwin"):
        return {"available": False, "reason": "Sampling supports Linux and macOS only"}
    sampler = shutil.which("samply")
    if not sampler:
        return {"available": False, "reason": "Samply is not installed; no install is attempted"}
    result = {"available": True, "tool": sampler, "perfEventParanoid": None}
    if system == "Linux":
        try:
            result["perfEventParanoid"] = int(paranoid_path.read_text().strip())
        except (OSError, ValueError):
            pass
        if result["perfEventParanoid"] is not None and result["perfEventParanoid"] > 2:
            result.update(available=False, reason="Conservative stop: Linux perf policy restricts unprivileged sampling; no settings or grants are changed")
    return result


def plan(root=ROOT):
    pin = tomllib.loads((root / "rust-toolchain.toml").read_text())["toolchain"]["channel"]
    return {
        "format": "houseatlas.runtime-profile-plan/1",
        "source": identity(root),
        "workload": WORKLOAD,
        "profile": profile_check(root),
        "rustToolchain": pin,
        "tools": {
            "python": platform.python_version(),
            "rustup": shutil.which("rustup"),
            "sampling": sampling_check(),
            "allocations": {
                "available": platform.system() == "Linux" and shutil.which("heaptrack") is not None,
                "tool": shutil.which("heaptrack"),
                "reason": "Optional existing Linux Heaptrack; never installed automatically",
            },
            "rss": {"available": platform.system() in ("Linux", "Darwin") and hasattr(os, "wait4"),
                    "units": "bytes after OS-specific normalization"},
        },
        "build": ["cargo", "build", "--offline", "--locked", "--profile", PROFILE,
                  "-p", "houseatlas-backend", "--example", WORKLOAD["example"],
                  "--target-dir", "<new-output>/target", "--message-format=json-render-diagnostics"],
        "sampling": ["samply", "record", "--save-only", "--rate", "1000",
                     "--iteration-count", "3", "-o", "<new-output>/cpu.json", "--", "<built-example>"],
        "allocationTrace": ["heaptrack", "-o", "<new-output>/allocations", "<built-example>"],
        "rss": {"freshProcesses": 3, "cachePolicy": "OS caches unmanaged; no cold/warm cache claim"},
    }


def new_output(path, root=ROOT):
    path = Path(path)
    if not path.is_absolute() or not path.parent.is_dir():
        raise ValueError("Output must be a fresh absolute directory with an existing parent")
    path = path.parent.resolve() / path.name
    if path == root or root in path.parents:
        raise ValueError("Keep generated receipts, logs, symbols and profiles outside Git")
    path.mkdir(mode=0o700)
    return path


def write_json(path, value):
    with path.open("x") as file:
        os.chmod(path, 0o600)
        json.dump(value, file, indent=2)
        file.write("\n")


def child_environment(scratch, compiler_dir=None, build=False):
    # No caller credentials, service paths, loader injection or Cargo profile overrides.
    environment = {
        "PATH": str(compiler_dir) + os.pathsep + "/usr/bin:/bin" if compiler_dir else "/usr/bin:/bin",
        "HOME": str(scratch / "home"),
        "TMPDIR": str(scratch / "tmp"),
        "LANG": "C.UTF-8",
        "TZ": "UTC",
    }
    for name in ("home", "tmp"):
        (scratch / name).mkdir(exist_ok=True, mode=0o700)
    if build:
        # Offline dependency cache only. Never copy credentials/config into receipts.
        environment["CARGO_HOME"] = os.environ.get("CARGO_HOME", str(Path.home() / ".cargo"))
        environment["RUSTC"] = str(compiler_dir / "rustc")
        environment["RUSTDOC"] = str(compiler_dir / "rustdoc")
        if platform.system() == "Darwin":
            environment["MACOSX_DEPLOYMENT_TARGET"] = "15.0"
    return environment


def build(output, receipt):
    pin = receipt["plan"]["rustToolchain"]
    rustup = shutil.which("rustup")
    if not rustup:
        raise Unavailable("rustup is unavailable; install nothing and stop")
    # 'which' resolves an already installed toolchain; it does not install one.
    rustc = Path(capture([rustup, "which", "--toolchain", pin, "rustc"]))
    cargo = rustc.with_name("cargo")
    environment = child_environment(output, rustc.parent, build=True)
    receipt["toolchain"] = {
        "rustc": capture([rustc, "-Vv"], env=environment),
        "cargo": capture([cargo, "-V"], env=environment),
        "rustcSha256": sha(rustc),
        "cargoSha256": sha(cargo),
    }
    if not receipt["toolchain"]["rustc"].startswith("rustc " + pin + " "):
        raise Unavailable("Resolved compiler does not match the repository pin")
    command = [str(cargo), "build", "--offline", "--locked", "--profile", PROFILE,
               "-p", "houseatlas-backend", "--example", WORKLOAD["example"],
               "--target-dir", str(output / "target"), "--message-format=json-render-diagnostics"]
    receipt["buildCommand"] = command
    receipt["buildEnvironment"] = {
        "cargoMode": "offline locked", "targetDirectory": str(output / "target"),
        "macosDeploymentTarget": environment.get("MACOSX_DEPLOYMENT_TARGET"),
        "callerRustflagsAndProfileOverrides": "not forwarded",
    }
    with (output / "build.jsonl").open("x") as stdout, (output / "build.stderr").open("x") as stderr:
        completed = subprocess.run(command, cwd=ROOT, env=environment, stdout=stdout, stderr=stderr, timeout=900)
    receipt["buildExitCode"] = completed.returncode
    if completed.returncode:
        raise Unavailable("Offline optimized build failed; see local build logs")
    artifacts = []
    for line in (output / "build.jsonl").read_text().splitlines():
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if message.get("reason") == "compiler-artifact" and message.get("target", {}).get("name") == WORKLOAD["example"]:
            artifacts.append(message)
    if len(artifacts) != 1 or not artifacts[0].get("executable"):
        raise Unavailable("Cargo did not report exactly one workload executable")
    artifact = artifacts[0]
    actual = artifact["profile"]
    # Cargo reports effective settings, catching environment/configuration drift.
    if str(actual.get("opt_level")) != "3" or actual.get("debuginfo") != 2:
        raise Unavailable("Cargo effective artifact profile is not opt-level=3/debug=2")
    binary = Path(artifact["executable"]).resolve()
    if (output / "target").resolve() not in binary.parents:
        raise Unavailable("Cargo executable escaped this run's owned target")
    receipt["binary"] = {"sha256": sha(binary), "path": str(binary), "cargoProfile": actual}
    receipt["observerBuildScope"] = "Cargo and compiler work excluded from every runtime observation"
    return binary


def logged(command, output, name, environment):
    with (output / (name + ".stdout")).open("x") as stdout, (output / (name + ".stderr")).open("x") as stderr:
        return subprocess.run(command, cwd=output, env=environment, stdout=stdout, stderr=stderr, timeout=300).returncode


def process_rss(binary, output, environment):
    if not hasattr(os, "wait4"):
        raise Unavailable("wait4 process resource accounting is unavailable")
    samples = []
    for index in range(3):
        with (output / f"rss-{index}.stdout").open("x") as stdout, (output / f"rss-{index}.stderr").open("x") as stderr:
            start = time.monotonic()
            process = subprocess.Popen([str(binary)], cwd=output, env=environment, stdout=stdout, stderr=stderr)
            _, status, usage = os.wait4(process.pid, 0)
            process.returncode = os.waitstatus_to_exitcode(status)
        samples.append({
            "exitCode": process.returncode,
            "wallSeconds": time.monotonic() - start,
            "userCpuSeconds": usage.ru_utime,
            "systemCpuSeconds": usage.ru_stime,
            "peakRssBytes": int(usage.ru_maxrss) * (1 if platform.system() == "Darwin" else 1024),
        })
        if process.returncode:
            break
    return samples


def count_samples(profile):
    return sum(len(thread.get("samples", {}).get("data", [])) for thread in profile.get("threads", [])) + sum(
        count_samples(child) for child in profile.get("processes", [])
    )


def observe(mode, binary, output, receipt):
    environment = child_environment(output)
    if mode == "rss":
        samples = process_rss(binary, output, environment)
        receipt["observation"] = {"kind": "whole-process-resource-accounting", "samples": samples,
                                  "rssScope": "OS process high-water resident set, not heap/live allocation bytes"}
        if len(samples) != 3 or any(sample["exitCode"] for sample in samples):
            raise Unavailable("Synthetic workload failed during RSS observation")
        return
    # Direct exit status is independent of a profiler's own success reporting.
    receipt["workloadCheckExitCode"] = logged([str(binary)], output, "workload-check", environment)
    if receipt["workloadCheckExitCode"]:
        raise Unavailable("Uninstrumented synthetic workload check failed before profiling")
    if mode == "cpu":
        tool = receipt["plan"]["tools"]["sampling"]["tool"]
        receipt["profiler"] = {"version": capture([tool, "--version"], env=environment), "sha256": sha(tool)}
        command = [tool, "record", "--save-only", "--rate", "1000", "--iteration-count", "3",
                   "-o", str(output / "cpu.json"), "--", str(binary)]
        receipt["observation"] = {"kind": "sampled-cpu-stacks", "command": command}
        code = logged(command, output, "samply", environment)
        receipt["observation"]["exitCode"] = code
        if code:
            raise Unavailable("Samply failed or perf access was denied; stop this sampling step without changing settings/grants")
        samples = count_samples(json.loads((output / "cpu.json").read_text()))
        receipt["observation"]["sampleCount"] = samples
        if samples == 0:
            raise Unavailable("No CPU samples captured; no hotspot conclusion is supported")
        return
    tool = receipt["plan"]["tools"]["allocations"]["tool"]
    receipt["profiler"] = {"version": capture([tool, "--version"], env=environment), "sha256": sha(tool)}
    command = [tool, "-o", str(output / "allocations"), str(binary)]
    receipt["observation"] = {"kind": "heaptrack-allocation-trace", "command": command,
                              "scope": "Whole-process allocator instrumentation including setup; not RSS or comparable CPU timing"}
    code = logged(command, output, "heaptrack", environment)
    receipt["observation"]["exitCode"] = code
    if code or not any(path.is_file() and path.stat().st_size for path in output.glob("allocations*")):
        raise Unavailable("Heaptrack did not produce a successful trace; no allocation conclusion is supported")


def run(args):
    selected = plan()
    if args.mode == "check":
        print(json.dumps(selected, indent=2))
        return 0
    output = new_output(args.output)
    if args.mode == "prepare":
        write_json(output / "plan.json", selected)
        print("Prepared plan only; no Cargo build or workload/profiler execution")
        return 0
    receipt = {
        "format": "houseatlas.runtime-profile/1", "synthetic": True,
        "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": args.mode, "plan": selected, "status": "blocked",
        "host": {"system": platform.system(), "release": platform.release(), "machine": platform.machine(),
                 "logicalCpus": os.cpu_count()},
        "inputs": {name: sha(ROOT / name) for name in ("Cargo.toml", "backend/Cargo.toml", "Cargo.lock",
                   "rust-toolchain.toml", WORKLOAD["source"], "tools/perf/runtime-profile/run.py")},
        "limits": [
            "Synthetic in-process backend workload; not socket/client/TLS/production or end-to-end HTTP evidence",
            "Includes startup, fixture setup, assertions and teardown; not steady-state request latency",
            "Fresh target and processes; OS caches and concurrent runner load unmanaged",
            "CPU sampling, allocation instrumentation and process RSS are separate runs and metrics",
            "Profiles/logs may contain local paths; keep outside Git and inspect before sharing",
        ],
    }
    result = 2
    try:
        if selected["source"]["dirty"]:
            raise Unavailable("Use a clean isolated checkout for exact source identity")
        if not selected["profile"]["available"]:
            raise Unavailable(selected["profile"]["reason"])
        requirement = selected["tools"][{"cpu": "sampling", "rss": "rss", "allocations": "allocations"}[args.mode]]
        if not requirement["available"]:
            raise Unavailable(requirement.get("reason", "Selected observation is unavailable"))
        binary = build(output, receipt)
        observe(args.mode, binary, output, receipt)
        receipt["status"] = "collected"
        result = 0
    except (Unavailable, OSError, ValueError, subprocess.SubprocessError) as error:
        receipt["reason"] = str(error)
    finally:
        receipt["sourceAfter"] = identity()
        if receipt["sourceAfter"] != selected["source"]:
            receipt.update(status="invalid-source-changed", reason="Source identity changed during observation")
            result = 2
        receipt["artifacts"] = [
            {"name": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}
            for path in sorted(output.iterdir()) if path.is_file()
        ]
        write_json(output / "receipt.json", receipt)
    print(f"{receipt['status']}: {output / 'receipt.json'}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["check", "prepare", "cpu", "allocations", "rss"])
    parser.add_argument("--output", type=Path, help="Fresh absolute output directory outside the checkout")
    args = parser.parse_args()
    if args.mode != "check" and args.output is None:
        parser.error("--output is required except for read-only check")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
