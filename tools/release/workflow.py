"""Fixed-repository Actions helpers. No runtime install, service or credential work."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from bundle import HERE, MAX_ARCHIVE, canonical, check_compatibility, closure, digest, file_digest, need, read_json, validate, verify_bundle

ROOT = HERE.parent.parent
REPOSITORY = "EzraCerpac/HouseAtlas"
WORKFLOW = ".github/workflows/release-bundle.yml"


def command(args, cwd=ROOT):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True, timeout=120).stdout.strip()


def api(path):
    return json.loads(command(["gh", "api", f"repos/{REPOSITORY}/{path}"]))


def source_identity():
    commit = os.environ["GITHUB_SHA"]
    need(re.fullmatch("[0-9a-f]{40}", commit) is not None, "Exact source commit required")
    need(os.environ["GITHUB_REPOSITORY"] == REPOSITORY and os.environ["GITHUB_REF"] == "refs/heads/main" and
         os.environ["GITHUB_EVENT_NAME"] == "workflow_dispatch", "Trusted main dispatch required")
    need(command(["git", "rev-parse", "HEAD"]) == commit, "Source commit differs")
    need(command(["git", "status", "--porcelain=v1", "--untracked-files=all"]) == "", "Source must be clean")
    return {"repository": REPOSITORY, "commit": commit, "tree": command(["git", "rev-parse", "HEAD^{tree}"])}


def native_inputs():
    # Include compiled Rust, SQL, embedded contracts and generated public fixture
    # inputs. Packaging/docs/frontend-only changes do not claim a new native ABI.
    names = command(["git", "ls-files"]).splitlines()
    selected = [name for name in names if name in {"Cargo.toml", "Cargo.lock", "rust-toolchain.toml"} or
                name.startswith(("backend/", ".cargo/", "contracts/", "packages/", "adapters/", "tools/rust-baseline/"))]
    rows = [{"path": name, "mode": "0755" if (ROOT / name).stat().st_mode & 0o111 else "0644",
             "bytes": (ROOT / name).stat().st_size, "sha256": file_digest(ROOT / name)} for name in sorted(selected)]
    return closure(rows)


def profile():
    value = read_json(HERE / "release-profile.json")
    validate(value, {"$ref": "#/$defs/releaseProfile"}, "profile")
    check_compatibility(value["compatibility"])
    return value


def preflight():
    source = source_identity()
    value = profile()
    native = value["native"]
    need(native["status"] == "reviewed", "Native Intel build profile is unqualified; native-build owner must release exact metadata")
    need(all(native[key] is not None for key in ["minimumMacos", "sourceInputsSha256", "runnerImage", "sdkVersion", "xcodeBuild"]),
         "Reviewed native profile must pin all builder and ABI fields")
    need(native["sourceInputsSha256"] == native_inputs(), "Native source inputs differ from reviewed profile")
    need(os.environ["RUNNER_OS"] == "macOS" and os.environ["RUNNER_ARCH"] == "X64" and
         command(["uname", "-m"]) == "x86_64", "Native Intel macOS runner required")
    need(os.environ["ImageVersion"] == native["runnerImage"], "Runner image differs from reviewed profile")
    need(command(["xcrun", "--show-sdk-version"]) == native["sdkVersion"], "SDK differs from reviewed profile")
    xcode = command(["xcodebuild", "-version"])
    need(re.search(r"^Build version ([A-Za-z0-9]+)$", xcode, re.M).group(1) == native["xcodeBuild"], "Xcode differs from reviewed profile")
    return source, value


def verify_run(run, commit=None, run_id=None, attempt=None):
    """Policy shared by build/promotion; metadata in a manifest is never trusted alone."""
    need(run["repository"]["full_name"] == REPOSITORY and run["head_repository"]["full_name"] == REPOSITORY,
         "Build repository differs")
    need(run["path"] == WORKFLOW and run["event"] == "workflow_dispatch" and
         run["head_branch"] == "main" and run["status"] == "completed" and run["conclusion"] == "success",
         "Successful trusted-main build run required")
    if commit is not None:
        need(run["head_sha"] == commit, "Build source commit differs")
    if run_id is not None:
        need(str(run["id"]) == str(run_id), "Build run ID differs")
    if attempt is not None:
        need(run["run_attempt"] == attempt, "Build attempt differs")


def require_prior_ci(source):
    need(api("")["visibility"] == "public", "Only free public-repository runner policy is released")
    runs = api(f"actions/workflows/rust-react-ordinary.yml/runs?head_sha={source['commit']}&event=push&status=success&per_page=20")
    need(any(run["head_sha"] == source["commit"] and run["head_branch"] == "main" and
             run["event"] == "push" and run["conclusion"] == "success" and
             run["repository"]["full_name"] == REPOSITORY for run in runs["workflow_runs"]),
         "Exact source needs successful existing Rust/React main CI before building")


def metadata(binary, version):
    source, value = preflight()
    native = value["native"]
    need(binary.is_file() and not binary.is_symlink(), "Built binary must be a regular file")
    need(command(["lipo", "-archs", str(binary)]) == "x86_64", "Mach-O must contain only Intel x86_64")
    load_commands = command(["otool", "-l", str(binary)])
    minimum = re.findall(r"\bminos ([0-9]+\.[0-9]+(?:\.[0-9]+)?)", load_commands)
    need(len(minimum) == 1 and minimum[0] == native["minimumMacos"], "Mach-O minimum OS differs")
    need(re.search(r"\bplatform 1\b", load_commands) is not None, "Mach-O platform must be macOS")
    libraries = sorted(line.strip().split(" (compatibility version", 1)[0]
                       for line in command(["otool", "-L", str(binary)]).splitlines()[1:])
    need(libraries == sorted(native["allowedDylibs"]), "Mach-O runtime library closure differs from reviewed profile")
    need(command(["rustc", "--version"]).split()[1] == "1.99.0" and
         command(["node", "--version"]) == "v26.10.0" and command(["npm", "--version"]) == "11.19.1", "Exact build tools required")
    return {"version": version, "source": source,
            "build": {"kind": "github-actions", "workflow": WORKFLOW, "workflowCommit": source["commit"],
                      "ref": "refs/heads/main", "runId": os.environ["GITHUB_RUN_ID"],
                      "runAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]), "runner": native["runner"],
                      "runnerImage": native["runnerImage"], "rust": "1.99.0", "node": "26.10.0", "npm": "11.19.1",
                      "nativeProfileSha256": file_digest(HERE / "release-profile.json"), "xcodeBuild": native["xcodeBuild"]},
            "platform": {"os": "macos", "architecture": "x86_64", "target": native["target"],
                         "minimumOs": native["minimumMacos"], "abi": "apple-darwin", "dynamicLibraries": libraries,
                         "sdkVersion": native["sdkVersion"]}, "compatibility": value["compatibility"]}


def stage(binary, destination):
    need(not destination.exists(), "Payload staging is create-only")
    destination.mkdir(mode=0o700)
    (destination / "bin").mkdir()
    shutil.copyfile(binary, destination / "bin/houseatlas")
    shutil.copytree(ROOT / "frontend/dist", destination / "frontend", symlinks=True)
    shutil.copytree(ROOT / "frontend/licenses", destination / "licenses", symlinks=True)


def tag_commit(tag):
    obj = api(f"git/ref/tags/{tag}")["object"]
    for _ in range(4):
        if obj["type"] == "commit":
            return obj["sha"]
        need(obj["type"] == "tag", "Tag must resolve to a commit")
        obj = api(f"git/tags/{obj['sha']}")["object"]
    raise ValueError("Tag nesting bound exceeded")


def promote(run_id, attempt, expected_digest, version):
    source_identity()  # Promotion helper itself must be dispatched on trusted main.
    need(api("")["visibility"] == "public", "Public repository policy required")
    need(re.fullmatch(r"[1-9][0-9]{0,19}", run_id) is not None and 1 <= attempt <= 1000, "Exact build run/attempt required")
    need(re.fullmatch(r"[0-9a-f]{64}", expected_digest) is not None, "Approved manifest SHA256 required")
    run = api(f"actions/runs/{run_id}")
    verify_run(run, run_id=run_id, attempt=attempt)
    artifact_name = f"release-bundle-{run_id}-{attempt}"
    artifacts = api(f"actions/runs/{run_id}/artifacts?per_page=100")
    selected = [item for item in artifacts["artifacts"] if item["name"] == artifact_name and not item["expired"]]
    need(len(selected) == 1 and selected[0]["size_in_bytes"] <= MAX_ARCHIVE + 1_048_576, "Exact bounded build artifact required")
    with tempfile.TemporaryDirectory(prefix="houseatlas-promote-", dir=os.environ["RUNNER_TEMP"]) as scratch:
        directory = Path(scratch) / "bundle"
        command(["gh", "run", "download", run_id, "--repo", REPOSITORY, "--name", artifact_name, "--dir", str(directory)])
        manifest = verify_bundle(directory, expected_digest)
        need(manifest["build"]["kind"] == "github-actions" and manifest["version"] == version, "Release version/producer differs")
        verify_run(run, commit=manifest["source"]["commit"], run_id=manifest["build"]["runId"],
                   attempt=manifest["build"]["runAttempt"])
        # Match the built Git tree using GitHub's commit object, independently
        # of self-declared manifest metadata or a mutable tag/latest pointer.
        commit = api(f"git/commits/{manifest['source']['commit']}")
        need(commit["tree"]["sha"] == manifest["source"]["tree"], "Source tree differs")
        need(manifest["compatibility"]["status"] == "reviewed", "Storage compatibility remains unqualified")
        need(manifest["build"]["nativeProfileSha256"] == file_digest(HERE / "release-profile.json"),
             "Build profile differs from current reviewed promotion profile")
        need(profile()["native"]["status"] == "reviewed", "Native profile remains unqualified")
        tag = "v" + version
        need(tag_commit(tag) == manifest["source"]["commit"], "Pre-existing reviewed tag must target exact built source")
        notes = Path(scratch) / "notes.txt"
        notes.write_text(f"HouseAtlas {version}\n\nSource: {manifest['source']['commit']}\n"
                         f"Manifest SHA256: {expected_digest}\n"
                         f"Build: https://github.com/{REPOSITORY}/actions/runs/{run_id}/attempts/{attempt}\n"
                         "Software only. Target runtime qualification and installation remain separate.\n")
        # No --target or implicit tag creation, no clobber/replace, no settings,
        # attestations, tokens or deployment. Any partial failure leaves a draft
        # for owner reconciliation rather than retrying a publication mutation.
        create = ["gh", "release", "create", tag, "--repo", REPOSITORY, "--verify-tag", "--draft",
                  "--title", f"HouseAtlas {version}", "--notes-file", str(notes)]
        if "-" in version:
            create.append("--prerelease")
        command(create)
        assets = [directory / manifest["archive"]["name"], directory / "manifest.json", directory / "SHA256SUMS"]
        command(["gh", "release", "upload", tag, *map(str, assets), "--repo", REPOSITORY])
        release = api(f"releases/tags/{tag}")
        need(release["draft"] and {a["name"] for a in release["assets"]} == {p.name for p in assets}, "Draft asset closure differs")
        need(all(a["size"] == (directory / a["name"]).stat().st_size and
                 a["digest"] == "sha256:" + file_digest(directory / a["name"]) for a in release["assets"]),
             "Uploaded asset digests differ")
        remote = Path(scratch) / "roundtrip"
        command(["gh", "release", "download", tag, "--repo", REPOSITORY, "--dir", str(remote)])
        verify_bundle(remote, expected_digest)
        need(tag_commit(tag) == manifest["source"]["commit"], "Tag drift before publication")
        command(["gh", "release", "edit", tag, "--repo", REPOSITORY, "--draft=false", "--latest=false"])
        print(f"Published exact existing build: {tag}; manifest {expected_digest}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("native-inputs")
    sub.add_parser("preflight")
    sub.add_parser("prior-ci")
    sub.add_parser("validate-dispatch")
    meta = sub.add_parser("metadata")
    meta.add_argument("--binary", type=Path, required=True)
    meta.add_argument("--version", required=True)
    meta.add_argument("--output", type=Path, required=True)
    staging = sub.add_parser("stage")
    staging.add_argument("--binary", type=Path, required=True)
    staging.add_argument("--output", type=Path, required=True)
    publication = sub.add_parser("promote")
    publication.add_argument("--run-id", required=True)
    publication.add_argument("--attempt", type=int, required=True)
    publication.add_argument("--manifest-sha256", required=True)
    publication.add_argument("--version", required=True)
    args = parser.parse_args()
    if args.action == "validate-dispatch":
        if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
            need(os.environ["GITHUB_REF"] == "refs/heads/main" and os.environ["GITHUB_REPOSITORY"] == REPOSITORY,
                 "Release operations require this repository's main workflow")
            action = os.environ["BUNDLE_OPERATION"]
            need(action in {"validate", "build", "promote"}, "Unknown operation")
            if action != "validate":
                version = os.environ["BUNDLE_VERSION"]
                validate(version, json.loads((HERE / "bundle.schema.json").read_bytes())["properties"]["version"], "version")
            if action == "build":
                need(os.environ["ARTIFACT_STORAGE_CHECKED"] == "true", "Confirm available artifact storage allowance before requesting a build")
    elif args.action == "native-inputs":
        print(native_inputs())
    elif args.action == "preflight":
        _, value = preflight()
        with open(os.environ["GITHUB_ENV"], "a") as stream:
            stream.write(f"MACOSX_DEPLOYMENT_TARGET={value['native']['minimumMacos']}\n")
    elif args.action == "prior-ci":
        require_prior_ci(source_identity())
    elif args.action == "metadata":
        need(not args.output.exists(), "Build metadata is create-only")
        args.output.write_bytes(canonical(metadata(args.binary, args.version)))
    elif args.action == "stage":
        stage(args.binary, args.output)
    else:
        promote(args.run_id, args.attempt, args.manifest_sha256, args.version)


if __name__ == "__main__":
    main()
