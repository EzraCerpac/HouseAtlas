"""Compile scoped source plus exactly its healthy example; never cargo test.

The external manifest imports the real backend and this source file. No root
manifest, module declaration, lock, router, schema or publication list is edited.
"""
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import tomllib


def main():
    root = Path(__file__).resolve().parents[4]
    inputs = json.loads((Path(__file__).parent / "accepted-inputs.json").read_text())
    for entry in inputs["files"]:
        if hashlib.sha256((root / entry["path"]).read_bytes()).hexdigest() != entry["sha256"]:
            raise RuntimeError("Accepted input preimage changed: " + entry["path"])
    target = Path(os.environ["CARGO_TARGET_DIR"]).resolve()
    if target == root or root in target.parents:
        raise RuntimeError("CARGO_TARGET_DIR must be outside the source checkout")
    manifest = tomllib.loads((root / "Cargo.toml").read_text())
    dependencies = manifest["workspace"]["dependencies"]
    lines = [
        "[package]", 'name = "houseatlas-presence-check"', 'version = "0.0.0"',
        'edition = "2024"', "publish = false", "[workspace]", "[dependencies]",
        "houseatlas-backend = { path = " + json.dumps(str(root / "backend")) + " }",
    ]
    for name in ("serde", "serde_json", "tempfile", "tokio"):
        value = dependencies[name]
        if isinstance(value, str):
            lines.append(name + " = " + json.dumps(value))
        else:
            fields = [key + " = " + json.dumps(item) for key, item in value.items()]
            lines.append(name + " = { " + ", ".join(fields) + " }")
    lines += [
        "[[bin]]", 'name = "healthy-presence"',
        "path = " + json.dumps(str(Path(__file__).parent / "examples" / "healthy.rs")),
    ]
    # Retain every registry version/checksum from the accepted lock. The only
    # carrier adaptation is a new external package and the unused backend dev
    # dependency edge (Cargo omits dependency-package dev dependencies).
    lock = (root / "Cargo.lock").read_text()
    backend_entry = re.search(r'\[\[package\]\]\nname = "houseatlas-backend"\n.*?(?=\n\[\[package\]\])', lock, re.S)
    if backend_entry is None:
        raise RuntimeError("Exact backend lock entry is required")
    lock = lock[:backend_entry.start()] + backend_entry.group().replace(' "tower",\n', '') + lock[backend_entry.end():]
    lock += '\n[[package]]\nname = "houseatlas-presence-check"\nversion = "0.0.0"\ndependencies = [\n "houseatlas-backend",\n "serde",\n "serde_json",\n "tempfile",\n "tokio",\n]\n'
    with tempfile.TemporaryDirectory(prefix="houseatlas-presence-healthy-") as directory:
        harness = Path(directory)
        (harness / "Cargo.toml").write_text("\n".join(lines) + "\n")
        (harness / "Cargo.lock").write_text(lock)
        common = ["--locked", "--offline", "--manifest-path", str(harness / "Cargo.toml")]
        subprocess.run(["rustfmt", "--edition", "2024", "--check",
                        str(Path(__file__).parent / "component.rs"),
                        str(Path(__file__).parent / "examples" / "healthy.rs")], check=True)
        subprocess.run(["cargo", "check", *common], check=True)
        subprocess.run(["cargo", "clippy", *common, "--", "-D", "warnings"], check=True)
        subprocess.run(["cargo", "run", *common, "--bin", "healthy-presence"], check=True)


if __name__ == "__main__":
    main()
