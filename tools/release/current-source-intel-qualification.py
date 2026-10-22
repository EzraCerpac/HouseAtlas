#!/usr/bin/env python3
"""Separate requested public artifact build; not an ordinary test entrypoint."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import struct
import subprocess
import tarfile

SOURCE = 'd36a48546a92b58cb3c515d8034272dfa1d92e5a'
TREE = '9567e8f9da5c81a8b9b9e4d088b09b269a5bdd8a'
LOCK = '9e7275031042b5010f12a69746ec10ef41c48e351605f4cd9ef8009bb260b1c8'
NATIVE_INPUTS = '2061368ea3e6d6620451d8542dc111226721ea6fd599ea8b3f841f2e9457586b'
NATIVE_INPUT_COUNT = 898
TARGET = 'x86_64-apple-darwin'
WORKFLOW = '.github/workflows/current-source-intel-qualification.yml'
SUPPORT = 'tools/release/current-source-intel-qualification.py'


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def source_pin(source):
    need(command(['git', 'rev-parse', 'HEAD'], source) == SOURCE, 'Wrong source commit')
    need(command(['git', 'rev-parse', 'HEAD^{tree}'], source) == TREE, 'Wrong source tree')
    need(digest(source / 'Cargo.lock') == LOCK, 'Wrong dependency lock')
    need(command(['git', 'status', '--porcelain=v1', '--untracked-files=all'], source) == '',
         'Product checkout has modifications or untracked files')
    need(command(['git', 'diff', '--exit-code', SOURCE, '--'], source) == '',
         'Product source differs from exact merge')


def native_input_receipt(source):
    # Same native-input selection/encoding as tools/release/workflow.py, kept
    # independent of that producer and its unqualified release profile.
    names = command(['git', 'ls-files'], source).splitlines()
    selected = sorted(name for name in names if name in
                      {'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'} or
                      name.startswith(('backend/', '.cargo/', 'contracts/', 'packages/',
                                       'adapters/', 'tools/rust-baseline/')))
    rows = []
    for name in selected:
        path = source / name
        need(path.is_file() and not path.is_symlink(), 'Native input must be a regular file: ' + name)
        rows.append({'path': name, 'mode': '0755' if path.stat().st_mode & 0o111 else '0644',
                     'bytes': path.stat().st_size, 'sha256': digest(path)})
    encoded = ''.join(f"{row['path']}\t{row['mode']}\t{row['bytes']}\t{row['sha256']}\n"
                      for row in rows).encode('utf-8')
    actual = hashlib.sha256(encoded).hexdigest()
    need(len(rows) == NATIVE_INPUT_COUNT and actual == NATIVE_INPUTS,
         'Native source inputs differ from reviewed qualification input')
    return {'format': 'houseatlas-native-source-inputs/1', 'sourceCommit': SOURCE,
            'sourceTree': TREE, 'count': len(rows), 'sha256': actual, 'files': rows}


def runner_profile():
    # Observe only nonsecret runner metadata. These values are recorded in the
    # artifact, not forwarded into dependency/compiler child environments.
    fields = {key: os.environ.get(key, '') for key in
              ('ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH')}
    need(fields['RUNNER_OS'] == 'macOS' and fields['RUNNER_ARCH'] == 'X64',
         'Require GitHub Intel macOS runner metadata')
    need(all(value and len(value) <= 128 and
             all(c.isascii() and (c.isalnum() or c in '._-') for c in value)
             for value in fields.values()), 'Missing or malformed runner image metadata')
    return {'label': 'macos-15-intel', **fields}


def version_tuple(encoded):
    return [encoded >> 16, (encoded >> 8) & 255, encoded & 255]


def inspect_macho(path):
    data = path.read_bytes()
    need(len(data) >= 32 and data[:4] == b'\xcf\xfa\xed\xfe', 'Require thin little-endian Mach-O64')
    magic, cpu, subtype, kind, count, size, flags, reserved = struct.unpack_from('<8I', data)
    need(cpu == 0x01000007 and subtype & 0x00ffffff == 3 and kind == 2,
         'Require generic x86_64 Mach-O executable')
    need(count <= 4096 and 32 + size <= len(data), 'Invalid load-command bounds')
    offset = 32
    minimums, libraries, platforms = [], [], []
    for _ in range(count):
        need(offset + 8 <= 32 + size, 'Truncated load command')
        code, length = struct.unpack_from('<II', data, offset)
        need(length >= 8 and length % 8 == 0 and offset + length <= 32 + size,
             'Invalid load command size')
        base = code & 0x7fffffff
        if base == 0x32:  # LC_BUILD_VERSION
            need(length >= 24, 'Truncated build-version command')
            target_platform, minimum = struct.unpack_from('<II', data, offset + 8)
            platforms.append(target_platform)
            need(target_platform == 1, 'Mach-O platform is not macOS')
            minimums.append(version_tuple(minimum))
        elif base == 0x24:  # LC_VERSION_MIN_MACOSX
            need(length >= 16, 'Truncated minimum-version command')
            minimums.append(version_tuple(struct.unpack_from('<I', data, offset + 8)[0]))
        elif base in (0xc, 0x18, 0x1f, 0x20, 0x23):
            need(length >= 24, 'Truncated dylib command')
            name_offset = struct.unpack_from('<I', data, offset + 8)[0]
            need(24 <= name_offset < length, 'Invalid dylib name offset')
            raw = data[offset + name_offset:offset + length]
            need(b'\0' in raw, 'Unterminated dylib path')
            name = raw.split(b'\0', 1)[0].decode('utf-8', 'strict')
            need(name.startswith(('/usr/lib/', '/System/Library/')) and '..' not in Path(name).parts,
                 'Non-system dynamic dependency: ' + name)
            libraries.append(name)
        offset += length
    need(offset == 32 + size and minimums, 'Missing macOS deployment version')
    need(all(tuple(v) == (15, 0, 0) for v in minimums), 'Require exact minimum macOS 15.0.0')
    return {'format': 'thin Mach-O64', 'architecture': 'x86_64',
            'minimumMacOSVersions': minimums, 'platformIds': platforms,
            'linkedLibraries': libraries, 'loadCommands': count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--workflow-source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source, recipe, output = args.source.resolve(), args.recipe.resolve(), args.output.resolve()
    workflow_source = args.workflow_source.resolve()
    need(platform.system() == 'Darwin' and platform.machine() == 'x86_64', 'Require Intel macOS host')
    need(os.environ.get('MACOSX_DEPLOYMENT_TARGET') == '15.0', 'Require deployment target 15.0')
    temp = Path(os.environ['RUNNER_TEMP']).resolve()
    target = Path(os.environ['CARGO_TARGET_DIR']).resolve()
    cargo_home = Path(os.environ['CARGO_HOME']).resolve()
    need(target.is_relative_to(temp) and cargo_home.is_relative_to(temp), 'Build caches must be in runner.temp')
    need(output.is_relative_to(temp) and not output.exists(), 'Require fresh runner.temp artifact directory')
    need(not target.is_relative_to(source) and not cargo_home.is_relative_to(source), 'Cache inside product checkout')
    source_pin(source)
    native_before = native_input_receipt(source)
    runner = runner_profile()
    recipe_hashes = {name: digest(recipe / name) for name in (WORKFLOW, SUPPORT)}
    workflow_commit = os.environ['HOUSEATLAS_EXECUTED_WORKFLOW_SHA']
    need(len(workflow_commit) == 40 and all(c in '0123456789abcdef' for c in workflow_commit),
         'Require exact executed workflow commit')

    def workflow_pin():
        need(command(['git', 'rev-parse', 'HEAD'], workflow_source) == workflow_commit,
             'Wrong executed workflow checkout')
        need(command(['git', 'status', '--porcelain=v1', '--untracked-files=all'], workflow_source) == '',
             'Executed workflow checkout changed')
        need(digest(workflow_source / WORKFLOW) == recipe_hashes[WORKFLOW],
             'Executed workflow differs from reviewed recipe workflow')

    workflow_pin()
    output.mkdir(mode=0o700)
    evidence = output / 'evidence'
    evidence.mkdir(mode=0o700)
    (evidence / 'native-source-inputs.json').write_text(
        json.dumps(native_before, indent=2, sort_keys=True) + '\n')
    (evidence / 'runner-profile.json').write_text(
        json.dumps(runner, indent=2, sort_keys=True) + '\n')
    # macOS /var can alias /private/var. Native SQLite NOFOLLOW guards
    # require canonical paths even for generated default-temp fixture data.
    # Use a fresh private runner-owned child, outside source/cache/artifacts.
    canonical_tmp = temp / 'current-source-intel-canonical-tmp'
    for other in (source, recipe, workflow_source, output, cargo_home, target):
        need(not canonical_tmp.is_relative_to(other) and not other.is_relative_to(canonical_tmp),
             'Fixture TMPDIR overlaps checkout/cache/artifacts')
    need(not canonical_tmp.exists(), 'Canonical fixture TMPDIR already exists')
    canonical_tmp.mkdir(mode=0o700)
    need(canonical_tmp.resolve() == canonical_tmp
         and canonical_tmp.stat().st_mode & 0o777 == 0o700,
         'Fixture TMPDIR must be canonical and private')
    commands = []
    # Preserve only the runner's actual tool/home/locale locations. Never pass
    # ambient compiler flags, Cargo overrides, GitHub tokens or service credentials
    # to dependency build scripts. HOME is preserved, not reassigned.
    child_env = {key: os.environ[key] for key in
                 ('PATH', 'HOME', 'RUSTUP_HOME', 'LANG', 'LC_ALL', 'LC_CTYPE')
                 if key in os.environ}
    child_env.update({
        'TMPDIR': str(canonical_tmp),
        'RUSTUP_TOOLCHAIN': '1.99.0',
        'CARGO_HOME': str(cargo_home), 'CARGO_TARGET_DIR': str(target),
        'CARGO_BUILD_JOBS': '2', 'MACOSX_DEPLOYMENT_TARGET': '15.0',
        'RUSTFLAGS': '-C target-cpu=x86-64',
        'CFLAGS_x86_64_apple_darwin': '-arch x86_64 -mmacosx-version-min=15.0 -march=x86-64 -mtune=generic',
        'CXXFLAGS_x86_64_apple_darwin': '-arch x86_64 -mmacosx-version-min=15.0 -march=x86-64 -mtune=generic',
    })

    def record(name, argv, required=True, cwd=None):
        result = subprocess.run(argv, cwd=cwd, env=child_env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        (evidence / (name + '.txt')).write_text(result.stdout)
        commands.append({'name': name, 'argv': argv, 'exitCode': result.returncode})
        if required:
            need(result.returncode == 0, f'Command failed: {name}; see raw evidence')
        return result.stdout.strip()

    rust = record('rustc', ['rustc', '-vV'])
    cargo = record('cargo', ['cargo', '--version'])
    need(rust.startswith('rustc 1.99.0 ') and '\nhost: x86_64-apple-darwin\n' in rust + '\n', 'Wrong Rust compiler')
    need(cargo.startswith('cargo 1.99.0 '), 'Wrong Cargo version')
    host = record('host', ['sw_vers'])
    kernel = record('kernel', ['uname', '-a'])
    sdk = record('sdk-version', ['xcrun', '--sdk', 'macosx', '--show-sdk-version'])
    sdk_path = record('sdk-path', ['xcrun', '--sdk', 'macosx', '--show-sdk-path'])
    need(Path(sdk_path).is_dir(), 'Selected Apple SDK is unavailable')
    child_env['SDKROOT'] = sdk_path
    clang = record('clang', ['xcrun', 'clang', '--version'])
    xcode = record('xcode', ['xcodebuild', '-version'])
    fetch_cmd = ['cargo', 'fetch', '--locked']
    build_cmd = ['cargo', 'build', '--offline', '--locked', '--release', '-p',
                 'houseatlas-backend', '--bin', 'houseatlas', '--target', TARGET]
    healthy_cmd = ['cargo', 'run', '--offline', '--locked', '--release', '-p',
                   'houseatlas-backend', '--example', 'healthy-native-full-geodata-profile', '--target', TARGET]
    overview_healthy_cmd = ['cargo', 'run', '--offline', '--locked', '--release', '-p',
                            'houseatlas-backend', '--example', 'healthy-model-overview-read', '--target', TARGET]
    unified_healthy_cmd = ['cargo', 'run', '--offline', '--locked', '--release', '-p',
                           'houseatlas-backend', '--example', 'healthy-unified-atlas-read', '--target', TARGET]
    room_links_healthy_cmd = ['cargo', 'run', '--offline', '--locked', '--release', '-p',
                              'houseatlas-backend', '--example', 'healthy-unified-atlas-room-links-read', '--target', TARGET]
    try:
        record('cargo-fetch', fetch_cmd, cwd=source)
        record('cargo-build', build_cmd, cwd=source)
        record('healthy-native-full-geodata-profile', healthy_cmd, cwd=source)
        record('healthy-model-overview-read', overview_healthy_cmd, cwd=source)
        record('healthy-unified-atlas-read', unified_healthy_cmd, cwd=source)
        record('healthy-unified-atlas-room-links-read', room_links_healthy_cmd, cwd=source)
    finally:
        source_pin(source)
        workflow_pin()
        need(recipe_hashes == {name: digest(recipe / name) for name in recipe_hashes}, 'Recipe changed during build')
    binary = target / TARGET / 'release' / 'houseatlas'
    initial_hash = digest(binary)
    record('file', ['file', str(binary)])
    architectures = record('lipo', ['lipo', '-archs', str(binary)])
    record('otool-load-commands', ['otool', '-l', str(binary)])
    record('otool-linked-libraries', ['otool', '-L', str(binary)])
    record('vtool-build', ['xcrun', 'vtool', '-show-build', str(binary)])
    record('codesign-display', ['codesign', '--display', '--verbose=4', str(binary)], required=False)
    record('codesign-verify', ['codesign', '--verify', '--verbose=4', str(binary)], required=False)
    need(architectures == 'x86_64', 'lipo reports non-thin/non-x86_64 binary')
    abi = inspect_macho(binary)
    need(digest(binary) == initial_hash, 'Binary changed during read-only inspection')
    source_pin(source)
    workflow_pin()
    need(native_input_receipt(source) == native_before,
         'Native source inputs changed during build or inspection')
    receipt = {
        'format': 'houseatlas-model-overview-darwin-build/1', 'sourceCommit': SOURCE, 'sourceTree': TREE,
        'cargoLockSha256': LOCK, 'target': TARGET, 'deploymentTarget': '15.0',
        'rustc': rust, 'cargo': cargo, 'host': host, 'kernel': kernel,
        'appleSdk': {'version': sdk, 'path': sdk_path, 'clang': clang, 'xcode': xcode},
        'runner': runner,
        'nativeInputs': {key: native_before[key] for key in
                         ('format', 'sourceCommit', 'sourceTree', 'count', 'sha256')},
        'github': {key: os.environ.get(key) for key in ('GITHUB_REPOSITORY', 'GITHUB_RUN_ID',
                   'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_WORKFLOW')},
        'effectiveBuildEnvironment': dict(sorted(child_env.items())),
        'recipeCommit': command(['git', 'rev-parse', 'HEAD'], recipe), 'recipeFileSha256': recipe_hashes,
        'executedWorkflow': {'commit': workflow_commit,
                             'ref': os.environ['HOUSEATLAS_EXECUTED_WORKFLOW_REF'],
                             'path': WORKFLOW, 'sha256': recipe_hashes[WORKFLOW]},
        'commands': commands, 'sourceCleanBeforeAndAfter': True,
        'binary': {'name': 'houseatlas', 'bytes': binary.stat().st_size, 'sha256': initial_hash, 'abi': abi},
        'limitations': ['Generated checks require the recorded canonical private TMPDIR; default /var aliases and target-host compatibility are not qualified.',
                         'Synthetic platform qualification only; no household files, provider or NAS access.',
                         'No deployment, installed-service, real-data, rollback or operator acceptance.',
                         'No credential signing or notarization; codesign records are inspection only.',
                         'Native profile prequalification only; no reviewed storage-contract or release-bundle promotion is supplied.',
                         'Minimum-OS and system-library checks do not prove compatibility with a particular NAS.']}
    receipt_bytes = (json.dumps(receipt, indent=2, sort_keys=True) + '\n').encode()
    readme = ('HouseAtlas current-source Intel macOS qualification\n'
              f'Source: {SOURCE}\nTarget: {TARGET}; MACOSX_DEPLOYMENT_TARGET=15.0.\n'
              'Built on GitHub-hosted macos-15-intel with Rust 1.99.0.\n'
              'Inspect BUILD_RECEIPT.json and detached evidence before selecting this artifact.\n'
              'No installation or NAS qualification is supplied. No credential signing or notarization.\n').encode()
    archive = output / 'houseatlas-current-source-d36a4854-x86_64-apple-darwin.tar.gz'
    with archive.open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as tar:
                for name, data, mode in [('houseatlas', binary.read_bytes(), 0o755),
                                         ('BUILD_RECEIPT.json', receipt_bytes, 0o600),
                                         ('README.txt', readme, 0o600)]:
                    info = tarfile.TarInfo(name)
                    info.size, info.mode, info.mtime = len(data), mode, 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    tar.addfile(info, io.BytesIO(data))
    # Inspect the produced archive itself; never alter or sign the compiled file.
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        need([(m.name, m.mode) for m in members] == [('houseatlas', 0o755),
             ('BUILD_RECEIPT.json', 0o600), ('README.txt', 0o600)], 'Unexpected archive members/modes')
        need(hashlib.sha256(tar.extractfile('houseatlas').read()).hexdigest() == initial_hash,
             'Archived binary does not match compiled binary')
    (output / 'BUILD_RECEIPT.json').write_bytes(receipt_bytes)
    (output / 'README.txt').write_bytes(readme)
    detached = {'format': 'houseatlas-model-overview-darwin-archive/1', 'archive': archive.name,
                'bytes': archive.stat().st_size, 'sha256': digest(archive),
                'buildReceiptSha256': hashlib.sha256(receipt_bytes).hexdigest(),
                'sourceCommit': SOURCE, 'sourceTree': TREE, 'binarySha256': initial_hash,
                'evidence': {f.name: digest(f) for f in sorted(evidence.iterdir())}}
    (output / 'ARCHIVE_RECEIPT.json').write_text(json.dumps(detached, indent=2, sort_keys=True) + '\n')
    for f in output.rglob('*'):
        if f.is_file():
            f.chmod(0o600)
    print(json.dumps(detached, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
