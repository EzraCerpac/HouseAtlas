"""Compile exact peer composition and run only two inspected fresh fixtures.

The harness manifest, lock and build output live outside the repository. Retain
the accepted lock graph, adding the harness and Media63's exact PNG dependency.
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
# Published original-owner API candidate; final integration acceptance is pending.
# Overlay only stock writer bytes, never the successor's root/main tree.
WRITER_INPUT = "5281eb1857a90c2279fb2998b3c7d0e2e41ec9b6"
PEER_INPUTS = [
    (WRITER_INPUT, ["backend/src/providers/homebox/write/stock"]),
    ("48e856068f8351b9256ef7912fc93619c259e79f", ["backend/src/storage", "backend/migrations"]),
    ("c25c1a0316ef5e12b61560f00371d839085aefb5", ["backend/src/domain"]),
    ("8a568fb6ccef5b0fa575b18d6181dcc524d4db99", ["backend/src/jobs"]),
    ("ea8ef14e05795334b3d79ae9c95c0a456f8b0308", ["backend/src/media"]),
    ("5e87c6c9152228ac4ae72814c6e6fc8f0ea8d7a2", ["backend/src/access"]),
    ("e5da350500daaa83333a9dbe4b16c7b018ca3888", ["backend/src/providers/homebox/write_transport"]),
    ("b326e78251b838d2e8cc0197b772276f2e6db548", ["backend/src/providers/homebox/recovery"]),
]
PNG_PACKAGES = [
    {"name":"fdeflate","version":"0.3.7",
     "source":"registry+https://github.com/rust-lang/crates.io-index",
     "checksum":"1e6853b52649d4ac5c0bd02320cddc5ba956bdb407c4b75a2c6b75bf51500f8c",
     "dependencies":["simd-adler32"]},
    {"name":"png","version":"0.18.1",
     "source":"registry+https://github.com/rust-lang/crates.io-index",
     "checksum":"60769b8b31b2a9f263dae2776c37b1b28ae246943cf719eb6946a1db05128a61",
     "dependencies":["bitflags","crc32fast","fdeflate","flate2","miniz_oxide"]},
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
        # The accepted Access recovery adapter imports this separately published
        # Domain leaf. Mount only its exact bytes/declaration in scratch.
        extract(root, source, "fd72542686112e594d9a6f63b4782a62b5d9e6ef", ["backend/src/domain/queue_recovery"])
        with (source / "backend/src/domain/mod.rs").open("a") as module:
            module.write("\npub mod queue_recovery;\n")
        # Exact codec-owner bridge is mounted inside the original stock module
        # solely in scratch, exposing its accepted private reducer functions.
        with (source / "backend/src/providers/homebox/write/stock/mod.rs").open("a") as module:
            module.write('\n#[path="../../recovery/stock_bridge.rs"] pub mod retained_bridge;\n')
        # The codec-owner byte bridge uses only exact private data codecs. Its
        # declarations/reexport are scratch-only; no producer factory is added.
        with (source / "backend/src/storage/stock_activity/mod.rs").open("a") as module:
            module.write('\n#[path="../../providers/homebox/recovery/activity_storage_bridge.rs"] pub(crate) mod retained_native_codec_bridge;\n')
        with (source / "backend/src/storage/mod.rs").open("a") as module:
            module.write('\npub(crate) use stock_activity::retained_native_codec_bridge;\n')
        if (source / "Cargo.toml").read_text() != manifest or (
            source / "Cargo.lock"
        ).read_text() != lock_text:
            raise RuntimeError("Checkout manifests differ from exact remapped base")
        # Media63 requires png=0.18.1. This external-only dependency adaptation
        # preserves repository manifests and every original locked package.
        backend_manifest=source / "backend/Cargo.toml"
        backend_manifest.write_text(backend_manifest.read_text().replace(
            "[dev-dependencies]", 'png = "=0.18.1"\n\n[dev-dependencies]', 1))
        # Disposable root declarations only. Peer cfg(test) runners, app/router
        # and recovery workflows are neither mounted nor executed. Original
        # manifests/dependency lock and peer runtime source remain exact.
        (source / "backend/src/lib.rs").write_text(
            "pub mod access; pub mod contracts; pub mod domain; pub mod jobs;\n"
            "pub mod media; pub mod storage; pub mod providers {\n"
            "pub mod network; pub mod homebox {pub mod read; pub mod write;"
            "pub mod write_transport;pub mod recovery;}}\n"
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
        added=[p for p in normalized["package"] if p["name"] in {"png","fdeflate"}]
        if added != PNG_PACKAGES:
            raise RuntimeError("External PNG source graph differs from exact pinned packages")
        retained = [p for p in normalized["package"]
                    if p["name"] not in {"houseatlas-provider-dispatch-check","png","fdeflate"}]
        # The backend is now a dependency: its dev-only tower edge is omitted.
        # Tower itself remains the exact locked package via the harness. All
        # other package facts, dependencies, versions and checksums must match.
        expected = [dict(p) for p in lock["package"]]
        expected_backend = next(p for p in expected if p["name"] == "houseatlas-backend")
        expected_backend["dependencies"] = sorted([d for d in backend["dependencies"] if d != "tower"]+["png"])
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
