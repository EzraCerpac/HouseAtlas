#!/usr/bin/env bash
# Compile only this namespace against the actual accepted application library.
# Run exactly three fresh positive loopback groups; no aggregate/control tests.
set -euo pipefail
transport_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$transport_dir/../../../../.." && pwd)"
: "${CARGO_TARGET_DIR:?Set CARGO_TARGET_DIR outside the checkout}"
transport_harness="$(mktemp -d "${TMPDIR:-/tmp}/houseatlas-write-transport-harness.XXXXXX")"
trap 'rm -rf -- "$transport_harness"' EXIT
python3 - "$repo_root" "$transport_harness" "$CARGO_TARGET_DIR" <<'PY'
import json
from pathlib import Path
import sys
import tomllib

root, harness, target = (Path(p).resolve() for p in sys.argv[1:])
if target.is_relative_to(root):
    raise SystemExit('CARGO_TARGET_DIR must be outside the checkout')
workspace = tomllib.loads((root / 'Cargo.toml').read_text())
deps = workspace['workspace']['dependencies']
lines = ['[package]', 'name = "houseatlas-write-transport-harness"',
         'version = "0.1.0"', 'edition = "2024"', 'publish = false',
         '[dependencies]', 'houseatlas-backend = { path = ' + json.dumps(str(root / 'backend')) + ' }']
for name in ['reqwest', 'serde', 'serde_json', 'sha2', 'tokio', 'tokio-util', 'uuid', 'url', 'fluent-uri']:
    value = deps[name]
    if isinstance(value, str):
        lines.append(name + ' = ' + json.dumps(value))
        continue
    fields = ['version = ' + json.dumps(value['version'])]
    if 'default-features' in value:
        fields.append('default-features = ' + str(value['default-features']).lower())
    features = value.get('features', [])
    if name == 'tokio':
        features = list(dict.fromkeys(features + ['net', 'io-util']))
    if features:
        fields.append('features = ' + json.dumps(features))
    lines.append(name + ' = { ' + ', '.join(fields) + ' }')
(harness / 'src').mkdir()
(harness / 'Cargo.toml').write_text('\n'.join(lines) + '\n')
(harness / 'Cargo.lock').write_bytes((root / 'Cargo.lock').read_bytes())
(harness / 'src/lib.rs').write_text(
    'pub use houseatlas_backend::{contracts, providers};\n#[path = ' +
    json.dumps(str(root / 'backend/src/providers/homebox/write_transport/mod.rs')) +
    ']\npub mod write_transport;\n')
PY
rustfmt --edition 2024 --check "$transport_dir/mod.rs"
# Add only the external harness lock entry offline, preserving application pins.
cargo check --offline --manifest-path "$transport_harness/Cargo.toml" --lib
python3 - "$repo_root/Cargo.lock" "$transport_harness/Cargo.lock" <<'PY'
import sys
import tomllib
def packages(path):
    with open(path, 'rb') as source:
        return {(p['name'], p['version'], p.get('source'), p.get('checksum'))
                for p in tomllib.load(source)['package']}
baseline = packages(sys.argv[1])
compiled = packages(sys.argv[2])
extra = compiled - baseline
if any(p[0] != 'houseatlas-write-transport-harness' for p in extra):
    raise SystemExit('harness dependency identity differs from application lock')
print('PASS application dependency versions/checksums preserved')
PY
cargo clippy --offline --locked --manifest-path "$transport_harness/Cargo.toml" --lib --tests -- -D warnings
for transport_case in \
  healthy_stock_json_methods_and_prepared_bytes \
  healthy_stock_multipart_and_print_dispatch_port \
  healthy_stock_file_fields_and_explicit_header
do
  cargo test --offline --locked --manifest-path "$transport_harness/Cargo.toml" --lib \
    "write_transport::healthy::$transport_case" -- --exact --test-threads=1
done
printf '%s\n' 'PASS scoped compilation and three healthy loopback groups; provider qualification and all held controls remain unrun'
