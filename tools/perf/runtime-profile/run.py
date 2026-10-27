#!/usr/bin/env python3
"""Opt-in profiling of the retained synthetic native backend example."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
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
BUILD_TIMEOUT = 900
OBSERVATION_TIMEOUT = 300
CAPTURE_TIMEOUT = 30
TERMINATION_GRACE = 1
REAP_GRACE = 2
POLL_INTERVAL = 0.01


class Unavailable(RuntimeError):
    pass


class ProcessDeadline(Unavailable):
    def __init__(self, record):
        self.record = record
        super().__init__(f"Owned command exceeded {record['timeoutSeconds']} seconds")


class RunInterrupted(BaseException):
    def __init__(self, signum):
        self.signum = signum
        super().__init__(f"Interrupted by {signal.Signals(signum).name}")


@contextmanager
def ignore_interruptions():
    previous = {signum: signal.signal(signum, signal.SIG_IGN)
                for signum in (signal.SIGINT, signal.SIGTERM)}
    try:
        yield
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def reap_owned(process, record):
    if process.returncode is not None:
        return
    pid, status, usage = os.wait4(process.pid, os.WNOHANG)
    if pid:
        process.returncode = os.waitstatus_to_exitcode(status)
        record.update(exitCode=process.returncode,
                      userCpuSeconds=usage.ru_utime, systemCpuSeconds=usage.ru_stime,
                      peakRssBytes=int(usage.ru_maxrss) * (1 if platform.system() == "Darwin" else 1024))


def cleanup_owned(process, record):
    cleanup = record["cleanup"] = {"signals": [], "errors": [], "directChildReaped": False}

    def send(signum):
        try:
            os.killpg(process.pid, signum)
            cleanup["signals"].append(signal.Signals(signum).name)
            return True
        except ProcessLookupError:
            return False
        except OSError as error:
            cleanup["errors"].append(str(error))
            return False

    # Own session/group only: no PID discovery, external process or settings change.
    # Always clean remaining group members, even if the leader already exited.
    with ignore_interruptions():
        if send(signal.SIGTERM):
            end = time.monotonic() + TERMINATION_GRACE
            while time.monotonic() < end:
                reap_owned(process, record)
                time.sleep(min(POLL_INTERVAL, max(0, end - time.monotonic())))
            send(signal.SIGKILL)
        end = time.monotonic() + REAP_GRACE
        while process.returncode is None and time.monotonic() < end:
            reap_owned(process, record)
            if process.returncode is None:
                time.sleep(POLL_INTERVAL)
        cleanup["directChildReaped"] = process.returncode is not None
        cleanup["descendantDisposition"] = (
            "Signals apply to the owned process group; escaped groups, zombies and uninterruptible tasks are not certified absent"
        )
        if process.returncode is None:
            cleanup["errors"].append("Direct child not reaped within cleanup deadline; termination outcome uncertain")


def owned_run(command, *, cwd, env, stdout, stderr, timeout, record):
    """Bound one fresh process group and retain partial state before every wait."""
    if not hasattr(os, "wait4") or os.name != "posix":
        raise Unavailable("Owned process-group supervision requires POSIX wait4")
    record.update(command=[str(part) for part in command], timeoutSeconds=timeout,
                  status="starting", exitCode=None, complete=False)
    process = None
    launching = True
    pending_signals = []
    def interrupt(signum, _frame):
        # Defer raising until Popen has returned the owned PID/group.
        if launching:
            pending_signals.append(signum)
        else:
            raise RunInterrupted(signum)
    previous_handlers = {signum: signal.getsignal(signum) for signum in (signal.SIGINT, signal.SIGTERM)}
    for signum, handler in previous_handlers.items():
        if handler != signal.SIG_IGN:
            signal.signal(signum, interrupt)
    start = time.monotonic()
    try:
        process = subprocess.Popen(record["command"], cwd=cwd, env=env,
                                   stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                   start_new_session=True)
        record.update(pid=process.pid, processGroup=process.pid, status="running")
        launching = False
        if pending_signals:
            raise RunInterrupted(pending_signals[0])
        while process.returncode is None:
            reap_owned(process, record)
            if process.returncode is not None:
                break
            remaining = timeout - (time.monotonic() - start)
            if remaining <= 0:
                record["status"] = "timed-out"
                raise ProcessDeadline(record)
            time.sleep(min(POLL_INTERVAL, remaining))
        record.update(status="exited", complete=True)
    except BaseException as error:
        if record["status"] != "timed-out":
            record["status"] = "interrupted" if isinstance(error, (RunInterrupted, KeyboardInterrupt)) else "error"
        record["reason"] = str(error)
        if isinstance(error, (RunInterrupted, KeyboardInterrupt)):
            error.record = record
        raise
    finally:
        # Timing stops before cleanup; polling can add up to POLL_INTERVAL seconds.
        record["wallSeconds"] = time.monotonic() - start
        try:
            if process is not None:
                cleanup_owned(process, record)
                if record["cleanup"]["errors"]:
                    record["complete"] = False
                    if record["status"] == "exited":
                        record["status"] = "cleanup-uncertain"
            record["supervisorSecondsIncludingCleanup"] = time.monotonic() - start
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
    if not record["complete"]:
        raise Unavailable("Owned command cleanup is uncertain; inspect the partial process record")
    return record


def sha(path):
    with Path(path).open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def capture(argv, **kwargs):
    # File-backed output avoids pipe deadlocks and shares owned-group cleanup.
    with tempfile.TemporaryFile(mode="w+") as stdout, tempfile.TemporaryFile(mode="w+") as stderr:
        record = owned_run(argv, cwd=kwargs.get("cwd", ROOT), env=kwargs.get("env"),
                           stdout=stdout, stderr=stderr, timeout=CAPTURE_TIMEOUT, record={})
        stdout.seek(0)
        stderr.seek(0)
        output, errors = stdout.read(), stderr.read()
    if record["exitCode"]:
        raise subprocess.CalledProcessError(record["exitCode"], argv, output, errors)
    return output.strip()


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
        "deadlinesSeconds": {"build": BUILD_TIMEOUT, "eachObservation": OBSERVATION_TIMEOUT,
                             "toolOrIdentityQuery": CAPTURE_TIMEOUT,
                             "terminationGrace": TERMINATION_GRACE, "reapGrace": REAP_GRACE},
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
        # build() admits this existing cache only after rejecting inherited config.
        environment["CARGO_HOME"] = str(Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo"))).resolve())
        environment["RUSTC"] = str(compiler_dir / "rustc")
        environment["RUSTDOC"] = str(compiler_dir / "rustdoc")
        if platform.system() == "Darwin":
            environment["MACOSX_DEPLOYMENT_TARGET"] = "15.0"
    return environment


def cargo_context(root=ROOT, cargo_home=None):
    """Inspect config presence only; never read config or credential contents."""
    root = root.resolve()
    cache = Path(cargo_home or os.environ.get("CARGO_HOME", str(Path.home() / ".cargo"))).resolve()
    directories = [directory / ".cargo" for directory in (root, *root.parents)] + [cache]
    paths = sorted({str(directory / name) for directory in directories for name in ("config", "config.toml")})
    for name in paths:
        try:
            Path(name).lstat()
        except FileNotFoundError:
            continue
        raise Unavailable("Inherited Cargo configuration is present; refuse without reading it or changing caller configuration")
    context = {"policy": "no-inherited-cargo-config/1", "cargoHome": str(cache),
               "configPathsConfirmedAbsent": paths,
               "limits": "Pre/post presence checks only; cache/config directories are not locked or snapshotted; concurrent mutation is outside this receipt"}
    context["sha256"] = hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest()
    return context


def build(output, receipt):
    admitted = cargo_context()
    receipt["cargoConfigBefore"] = admitted
    pin = receipt["plan"]["rustToolchain"]
    rustup = shutil.which("rustup")
    if not rustup:
        raise Unavailable("rustup is unavailable; install nothing and stop")
    # 'which' resolves an already installed toolchain; it does not install one.
    rustc = Path(capture([rustup, "which", "--toolchain", pin, "rustc"]))
    cargo = rustc.with_name("cargo")
    environment = child_environment(output, rustc.parent, build=True)
    if environment["CARGO_HOME"] != admitted["cargoHome"]:
        raise Unavailable("Cargo cache home changed after context admission")
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
        "inheritedCargoConfiguration": "refused if any config/config.toml exists in Cargo home or checkout ancestors",
    }
    context = {"cargoConfig": admitted, "environment": environment,
               "toolchain": receipt["toolchain"],
               "manifests": {name: sha(ROOT / name) for name in ("Cargo.toml", "backend/Cargo.toml", "Cargo.lock", "rust-toolchain.toml")}}
    receipt["buildContext"] = {"sha256": hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest(), **context}
    with (output / "build.jsonl").open("x") as stdout, (output / "build.stderr").open("x") as stderr:
        process = {"phase": "build"}
        receipt.setdefault("processes", []).append(process)
        try:
            owned_run(command, cwd=ROOT, env=environment, stdout=stdout, stderr=stderr,
                      timeout=BUILD_TIMEOUT, record=process)
        finally:
            try:
                receipt["cargoConfigAfter"] = cargo_context()
                receipt["cargoConfigStable"] = receipt["cargoConfigAfter"] == admitted
            except Exception as error:
                receipt.update(cargoConfigStable=False, cargoConfigAfterError=str(error))
    if not receipt["cargoConfigStable"]:
        raise Unavailable("Cargo configuration context changed; build is not admitted for collection")
    receipt["buildExitCode"] = process["exitCode"]
    if process["exitCode"]:
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


def logged(command, output, name, environment, receipt):
    process = {"phase": name}
    receipt.setdefault("processes", []).append(process)
    with (output / (name + ".stdout")).open("x") as stdout, (output / (name + ".stderr")).open("x") as stderr:
        owned_run(command, cwd=output, env=environment, stdout=stdout, stderr=stderr,
                  timeout=OBSERVATION_TIMEOUT, record=process)
    return process["exitCode"]


def process_rss(binary, output, environment, samples=None):
    if not hasattr(os, "wait4"):
        raise Unavailable("wait4 process resource accounting is unavailable")
    samples = [] if samples is None else samples
    for index in range(3):
        process = {"phase": f"rss-{index}"}
        samples.append(process)
        with (output / f"rss-{index}.stdout").open("x") as stdout, (output / f"rss-{index}.stderr").open("x") as stderr:
            owned_run([str(binary)], cwd=output, env=environment, stdout=stdout, stderr=stderr,
                      timeout=OBSERVATION_TIMEOUT, record=process)
        if process["exitCode"]:
            break
    return samples


def count_samples(profile):
    """Validate Samply's processed columnar sample tables, then count rows."""
    if not isinstance(profile, dict) or not isinstance(profile.get("threads"), list):
        raise ValueError("Expected a processed Samply profile with a threads array")
    total = 0
    for thread in profile["threads"]:
        table = thread.get("samples") if isinstance(thread, dict) else None
        if not isinstance(table, dict) or "data" in table or "schema" in table:
            raise ValueError("Expected processed columnar samples, not raw Gecko rows")
        length = table.get("length")
        if type(length) is not int or length < 0 or table.get("weightType") != "samples":
            raise ValueError("Invalid CPU sample length or weightType")
        times = [key for key in ("time", "timeDeltas") if key in table]
        if len(times) != 1:
            raise ValueError("Expected exactly one sample time/timeDeltas column")
        columns = ["stack", "weight", times[0]]
        if "threadCPUDelta" in table:
            columns.append("threadCPUDelta")
        for key in columns:
            if not isinstance(table.get(key), list) or len(table[key]) != length:
                raise ValueError(f"Sample column {key} disagrees with declared length")
        if any(value is not None and (type(value) is not int or value < 0) for value in table["stack"]):
            raise ValueError("Invalid sample stack index")
        if any(type(value) is not int for value in table["weight"]):
            raise ValueError("Invalid sample weight")
        for key in [times[0]] + (["threadCPUDelta"] if "threadCPUDelta" in table else []):
            for value in table[key]:
                if value is None and key == "threadCPUDelta":
                    continue
                if type(value) not in (int, float) or not math.isfinite(value):
                    raise ValueError(f"Invalid numeric sample column {key}")
        total += length
    children = profile.get("processes", [])
    if not isinstance(children, list):
        raise ValueError("Invalid nested process profiles")
    return total + sum(count_samples(child) for child in children)


def observe(mode, binary, output, receipt):
    environment = child_environment(output)
    if mode == "rss":
        samples = []
        receipt["observation"] = {"kind": "whole-process-resource-accounting", "samples": samples,
                                  "rssScope": "OS process high-water resident set, not heap/live allocation bytes"}
        process_rss(binary, output, environment, samples)
        if len(samples) != 3 or any(sample["exitCode"] for sample in samples):
            raise Unavailable("Synthetic workload failed during RSS observation")
        return
    # Direct exit status is independent of a profiler's own success reporting.
    receipt["workloadCheckExitCode"] = logged([str(binary)], output, "workload-check", environment, receipt)
    if receipt["workloadCheckExitCode"]:
        raise Unavailable("Uninstrumented synthetic workload check failed before profiling")
    if mode == "cpu":
        tool = receipt["plan"]["tools"]["sampling"]["tool"]
        receipt["profiler"] = {"version": capture([tool, "--version"], env=environment), "sha256": sha(tool)}
        command = [tool, "record", "--save-only", "--rate", "1000", "--iteration-count", "3",
                   "-o", str(output / "cpu.json"), "--", str(binary)]
        receipt["observation"] = {"kind": "sampled-cpu-stacks", "command": command}
        code = logged(command, output, "samply", environment, receipt)
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
    code = logged(command, output, "heaptrack", environment, receipt)
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
    def interrupt(signum, _frame):
        raise RunInterrupted(signum)
    previous_handlers = {signum: signal.signal(signum, interrupt)
                         for signum in (signal.SIGINT, signal.SIGTERM)}
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
    except ProcessDeadline as error:
        receipt.update(status="timed-out", reason=str(error), terminalProcess=error.record)
        result = 124
    except (RunInterrupted, KeyboardInterrupt) as error:
        signum = error.signum if isinstance(error, RunInterrupted) else signal.SIGINT
        receipt.update(status="interrupted", reason=str(error), signal=signal.Signals(signum).name)
        if hasattr(error, "record"):
            receipt["terminalProcess"] = error.record
        result = 128 + signum
    except Unavailable as error:
        receipt["reason"] = str(error)
    except Exception as error:
        receipt.update(status="error", reason=f"{type(error).__name__}: {error}")
    finally:
        # Finish the receipt after owned children are stopped; a second ordinary
        # interruption must not erase the first interruption/timeout evidence.
        try:
            with ignore_interruptions():
                try:
                    receipt["sourceAfter"] = identity()
                    if receipt["sourceAfter"] != selected["source"]:
                        receipt["sourceValidity"] = "changed"
                        if receipt["status"] == "collected":
                            receipt.update(status="invalid-source-changed", reason="Source identity changed during observation")
                            result = 2
                except Exception as error:
                    receipt["sourceAfterError"] = str(error)
                    receipt["sourceValidity"] = "unknown"
                    if receipt["status"] == "collected":
                        receipt.update(status="invalid-source-unknown", reason="Unable to recheck source identity")
                        result = 2
                receipt["artifacts"] = []
                for path in sorted(output.iterdir()):
                    try:
                        if path.is_file():
                            receipt["artifacts"].append({"name": path.name, "bytes": path.stat().st_size, "sha256": sha(path)})
                    except OSError as error:
                        receipt.setdefault("artifactErrors", []).append({"name": path.name, "reason": str(error)})
                write_json(output / "receipt.json", receipt)
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
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
