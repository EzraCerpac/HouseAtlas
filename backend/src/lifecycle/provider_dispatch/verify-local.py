"""Compile exact peer composition and run only two inspected fresh fixtures.

The harness manifest, lock and build output live outside the repository. Copy
the accepted lock's package graph verbatim, adding only the harness package.
Run after activating the repository's pinned Rust environment. No downloads,
provider calls, broad test alias, stopped controls or source mutations occur.
"""
import os
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import tomllib

BASE_INPUT = "19310b10dcfc34424233496854c014000f44acbf"
PEER_INPUTS = [
    ("29a37d8de35d5930a396fce3b06bdb901ba5421a", ["backend/src/storage", "backend/migrations"]),
    ("8a568fb6ccef5b0fa575b18d6181dcc524d4db99", ["backend/src/domain", "backend/src/jobs"]),
    ("f0d6b10f00bb93fc1c1dd4eb3ae66ee1fbe3f873", ["backend/src/media"]),
    ("4a0cd4da563a32d26677755a608180c960765353", ["backend/src/access"]),
    ("72349292ec6c51a0e6a5d36985e094d05166bd53", ["backend/src/providers/homebox/write_transport"]),
]


def extract(root, target, revision, paths=()):
    """Copy exact regular Git tree bytes; never merge ancestry into checkout."""
    archive = subprocess.run(
        ["git", "archive", "--format=tar", revision, *paths],
        cwd=root, check=True, stdout=subprocess.PIPE,
    ).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tree:
        for entry in tree:
            relative = Path(entry.name)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unexpected archive path")
            destination = target / relative
            if entry.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            elif entry.isfile():
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tree.extractfile(entry) as data:
                    destination.write_bytes(data.read())
            else:
                raise RuntimeError("Peer archive contains nonregular input")


def verify():
    root = Path(__file__).resolve().parents[4]
    manifest = (root / "Cargo.toml").read_text()
    lock_text = (root / "Cargo.lock").read_text()
    lock = tomllib.loads(lock_text)
    backend = next(p for p in lock["package"] if p["name"] == "houseatlas-backend")
    dependencies = manifest.split("[workspace.dependencies]\n", 1)[1].split(
        "\n[workspace.lints.rust]", 1
    )[0]
    with tempfile.TemporaryDirectory(prefix="houseatlas-dispatch-check-") as name:
        harness = Path(name) / "check"
        (harness / "src").mkdir(parents=True)
        # Paths are TOML/JSON string values, never interpolated shell code.
        quoted = json.dumps
        source = Path(name) / "source"
        extract(root, source, BASE_INPUT)
        for revision, paths in PEER_INPUTS:
            for path in paths:
                # Delete only disposable overlay directories, so removed peer
                # files cannot silently survive from a different source input.
                if (source / path).exists():
                    shutil.rmtree(source / path)
            extract(root, source, revision, paths)
        for namespace in ["config", "lifecycle"]:
            path = Path("backend/src") / namespace / "provider_dispatch"
            shutil.copytree(root / path, source / path, dirs_exist_ok=True)
        if (source / "Cargo.toml").read_text() != manifest or (
            source / "Cargo.lock"
        ).read_text() != lock_text:
            raise RuntimeError("Checkout manifests differ from exact remapped base")
        # Disposable root declarations only. Peer cfg(test) runners, app/router
        # and recovery workflows are neither mounted nor executed. Original
        # manifests/dependency lock and peer runtime source remain exact.
        (source / "backend/src/lib.rs").write_text(
            "pub mod access; pub mod contracts; pub mod domain; pub mod jobs;\n"
            "pub mod media; pub mod storage; pub mod providers {\n"
            "pub mod network; pub mod homebox {pub mod read; pub mod write;"
            "pub mod write_transport;}}\n"
            "pub mod config {pub mod provider_dispatch;}\n"
            "pub mod lifecycle {pub mod provider_dispatch;}\n"
        )
        (harness / "Cargo.toml").write_text(
            '[package]\nname="houseatlas-provider-dispatch-check"\n'
            'version="0.1.0"\nedition="2024"\n[dependencies]\n'
            + "houseatlas-backend={path=" + quoted(str(source / "backend")) + "}\n"
            + dependencies + "\n[workspace]\n"
        )
        (harness / "Cargo.lock").write_text(
            lock_text + '\n[[package]]\nname="houseatlas-provider-dispatch-check"\n'
            'version="0.1.0"\ndependencies = [\n'
            + "\n".join(" " + quoted(d) + "," for d in
                        backend["dependencies"] + ["houseatlas-backend"])
            + "\n]\n"
        )
        (harness / "src/lib.rs").write_text(
            "pub use houseatlas_backend::{access,jobs,storage,domain,contracts,media,providers,config};\n"
            "#[path="
            + quoted(str(root / "backend/src/lifecycle/provider_dispatch/mod.rs"))
            + "] pub mod provider_dispatch;\n"
        )
        env = os.environ.copy()
        env.setdefault("CARGO_TARGET_DIR", "/tmp/houseatlas-provider-dispatch-target")
        common = ["--offline", "--locked", "--manifest-path", str(harness / "Cargo.toml")]
        # Cargo normalizes the external path-package entry. Check that this
        # changed only the harness before permitting any compile or execution.
        subprocess.run(["cargo", "tree", "--offline", "--depth", "0", "--manifest-path",
                        str(harness / "Cargo.toml")], check=True, env=env,
                       stdout=subprocess.DEVNULL)
        normalized = tomllib.loads((harness / "Cargo.lock").read_text())
        retained = [p for p in normalized["package"]
                    if p["name"] != "houseatlas-provider-dispatch-check"]
        # The backend is now a dependency: its dev-only tower edge is omitted.
        # Tower itself remains the exact locked package via the harness. All
        # other package facts, dependencies, versions and checksums must match.
        expected = [dict(p) for p in lock["package"]]
        expected_backend = next(p for p in expected if p["name"] == "houseatlas-backend")
        expected_backend["dependencies"] = [d for d in backend["dependencies"] if d != "tower"]
        if retained != expected:
            raise RuntimeError("External harness changed accepted dependency graph")
        subprocess.run(["rustfmt", "--edition", "2024", "--check",
                        str(root / "backend/src/config/provider_dispatch/mod.rs"),
                        str(root / "backend/src/lifecycle/provider_dispatch/mod.rs")],
                       check=True, env=env)
        subprocess.run(["cargo", "clippy", *common, "--lib", "--tests", "--",
                        "-D", "warnings"], check=True, env=env)
        for fixture in ["provider_dispatch::healthy::healthy_fresh_native_dispatch",
                        "provider_dispatch::durable_stock::healthy_activity::healthy_fresh_stock_activity"]:
            subprocess.run(["cargo", "test", *common, "--lib", "--",
                            "--exact", fixture], check=True, env=env)


if __name__ == "__main__":
    verify()
