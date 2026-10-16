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

SOURCE = '318c87122f7b3e3de612c16bdcb4970c12f5a4dc'
TREE = 'c408cfabfc22c055ec11e53e6920705157e470f9'
LOCK = '9e7275031042b5010f12a69746ec10ef41c48e351605f4cd9ef8009bb260b1c8'
TARGET = 'x86_64-apple-darwin'
WORKFLOW = '.github/workflows/model-overview-darwin-artifact.yml'
SUPPORT = 'tools/model-overview-darwin-artifact.py'


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
    need(all(tuple(v) <= (15, 8, 0) for v in minimums), 'Minimum macOS exceeds 15.8')
    return {'format': 'thin Mach-O64', 'architecture': 'x86_64',
            'minimumMacOSVersions': minimums, 'platformIds': platforms,
            'linkedLibraries': libraries, 'loadCommands': count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source, recipe, output = args.source.resolve(), args.recipe.resolve(), args.output.resolve()
    need(platform.system() == 'Darwin' and platform.machine() == 'x86_64', 'Require Intel macOS host')
    need(os.environ.get('MACOSX_DEPLOYMENT_TARGET') == '15.0', 'Require deployment target 15.0')
    temp = Path(os.environ['RUNNER_TEMP']).resolve()
    target = Path(os.environ['CARGO_TARGET_DIR']).resolve()
    cargo_home = Path(os.environ['CARGO_HOME']).resolve()
    need(target.is_relative_to(temp) and cargo_home.is_relative_to(temp), 'Build caches must be in runner.temp')
    need(output.is_relative_to(temp) and not output.exists(), 'Require fresh runner.temp artifact directory')
    need(not target.is_relative_to(source) and not cargo_home.is_relative_to(source), 'Cache inside product checkout')
    source_pin(source)
    recipe_hashes = {name: digest(recipe / name) for name in (WORKFLOW, SUPPORT)}
    output.mkdir(mode=0o700)
    evidence = output / 'evidence'
    evidence.mkdir(mode=0o700)
    # macOS /var can alias /private/var. Native SQLite NOFOLLOW guards
    # require canonical paths even for generated default-temp fixture data.
    # Use a fresh private runner-owned child, outside source/cache/artifacts.
    canonical_tmp = temp / 'model-overview-product-canonical-tmp'
    for other in (source, recipe, output, cargo_home, target):
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
    try:
        record('cargo-fetch', fetch_cmd, cwd=source)
        record('cargo-build', build_cmd, cwd=source)
        record('healthy-native-full-geodata-profile', healthy_cmd, cwd=source)
        record('healthy-model-overview-read', overview_healthy_cmd, cwd=source)
    finally:
        source_pin(source)
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
    receipt = {
        'format': 'houseatlas-model-overview-darwin-build/1', 'sourceCommit': SOURCE, 'sourceTree': TREE,
        'cargoLockSha256': LOCK, 'target': TARGET, 'deploymentTarget': '15.0',
        'rustc': rust, 'cargo': cargo, 'host': host, 'kernel': kernel,
        'appleSdk': {'version': sdk, 'path': sdk_path, 'clang': clang, 'xcode': xcode},
        'github': {key: os.environ.get(key) for key in ('GITHUB_REPOSITORY', 'GITHUB_RUN_ID',
                   'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_WORKFLOW')},
        'effectiveBuildEnvironment': dict(sorted(child_env.items())),
        'recipeCommit': command(['git', 'rev-parse', 'HEAD'], recipe), 'recipeFileSha256': recipe_hashes,
        'commands': commands, 'sourceCleanBeforeAndAfter': True,
        'binary': {'name': 'houseatlas', 'bytes': binary.stat().st_size, 'sha256': initial_hash, 'abi': abi},
        'limitations': ['Generated checks require the recorded canonical private TMPDIR; default /var aliases and target-host compatibility are not qualified.',
                         'Synthetic platform qualification only; no household files, provider or NAS access.',
                         'No deployment, installed-service, real-data, rollback or operator acceptance.',
                         'No credential signing or notarization; codesign records are inspection only.',
                         'Minimum-OS and system-library checks do not prove compatibility with a particular NAS.']}
    receipt_bytes = (json.dumps(receipt, indent=2, sort_keys=True) + '\n').encode()
    readme = ('HouseAtlas Model overview Intel macOS artifact\n'
              f'Source: {SOURCE}\nTarget: {TARGET}; MACOSX_DEPLOYMENT_TARGET=15.0.\n'
              'Built on GitHub-hosted macos-15-intel with Rust 1.99.0.\n'
              'Inspect BUILD_RECEIPT.json and detached evidence before selecting this artifact.\n'
              'No installation or NAS qualification is supplied. No credential signing or notarization.\n').encode()
    archive = output / 'houseatlas-model-overview-x86_64-apple-darwin.tar.gz'
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
