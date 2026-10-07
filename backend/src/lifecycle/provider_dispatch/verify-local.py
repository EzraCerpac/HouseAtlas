"""Compile the unmounted namespaces and run only the inspected fresh fixture.

The harness manifest, lock and build output live outside the repository. Copy
the accepted lock's package graph verbatim, adding only the harness package.
Run after activating the repository's pinned Rust environment. No downloads,
provider calls, broad test alias, stopped controls or source mutations occur.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib


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
        harness = Path(name)
        (harness / "src").mkdir()
        # Paths are TOML/JSON string values, never interpolated shell code.
        import json

        quoted = json.dumps
        (harness / "Cargo.toml").write_text(
            '[package]\nname="houseatlas-provider-dispatch-check"\n'
            'version="0.1.0"\nedition="2024"\n[dependencies]\n'
            + "houseatlas-backend={path=" + quoted(str(root / "backend")) + "}\n"
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
            "pub use houseatlas_backend::{jobs,storage,domain,providers,http};\n"
            "pub mod config { pub use houseatlas_backend::config::*; #[path="
            + quoted(str(root / "backend/src/config/provider_dispatch/mod.rs"))
            + "] pub mod provider_dispatch; }\n#[path="
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
        subprocess.run(["cargo", "test", *common, "--lib", "--",
                        "--exact", "provider_dispatch::healthy::healthy_fresh_native_dispatch"],
                       check=True, env=env)


if __name__ == "__main__":
    verify()
