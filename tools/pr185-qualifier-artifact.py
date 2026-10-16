#!/usr/bin/env python3
"""Separate public external qualifier build; no product source or ordinary CI changes."""
import argparse
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile

SOURCE = 'e8fe7494068c83b3623d03b41bef29549ef9f703'
TREE = 'd04bdf99d7f7c08b12b11f93326d7c6b974b2cd5'
LOCK = '9e7275031042b5010f12a69746ec10ef41c48e351605f4cd9ef8009bb260b1c8'
TARGET = 'x86_64-apple-darwin'
BINARY = 'houseatlas-pr185-full-qualifier'
WORKFLOW = '.github/workflows/pr185-qualifier-artifact.yml'
SUPPORT = 'tools/pr185-qualifier-artifact.py'
HELPER = 'tools/pr185-full-qualifier.rs'
ABI_SUPPORT = 'tools/pr185-darwin-artifact.py'
ABI_SUPPORT_SHA256 = '8730d79b2a1acfae3756f091726d988c39c02ea7019d27bff9d709661b04b59b'
CRATES = ('houseatlas_backend', 'rusqlite', 'serde_json', 'sha2', 'rustix')


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(args, cwd):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


def load_abi_support(recipe):
    path = recipe / ABI_SUPPORT
    need(digest(path) == ABI_SUPPORT_SHA256, 'ABI verifier differs from reviewed immutable recipe')
    spec = importlib.util.spec_from_file_location('pr185_reviewed_abi', path)
    need(spec is not None and spec.loader is not None, 'Cannot load ABI verifier')
    module = importlib.util.module_from_spec(spec)
    # Reviewed module has only function definitions/imports outside guarded main.
    # Do not write __pycache__ into the recipe checkout.
    import sys
    sys.dont_write_bytecode = True
    spec.loader.exec_module(module)
    need((module.SOURCE, module.TREE, module.LOCK, module.TARGET) == (SOURCE, TREE, LOCK, TARGET),
         'ABI/source constants disagree')
    return module


def select_rlibs(messages, release):
    selected = {name: {} for name in CRATES}
    for line in messages.splitlines():
        message = json.loads(line)
        if message.get('reason') != 'compiler-artifact':
            continue
        name = message['target']['name']
        if name not in selected:
            continue
        for filename in message['filenames']:
            path = Path(filename).resolve()
            # Exclude host build dependencies and all non-rlib outputs. The fresh
            # target was absent at entry and belongs solely to this controlled job.
            if path.suffix == '.rlib' and path.is_relative_to(release):
                selected[name][str(path)] = {'path': str(path), 'sha256': digest(path),
                    'bytes': path.stat().st_size, 'packageId': message['package_id'],
                    'features': message['features'], 'crate': name}
    need(all(len(paths) == 1 for paths in selected.values()),
         'Require exactly one fresh target rlib per named dependency')
    return {name: next(iter(paths.values())) for name, paths in selected.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source, recipe, output = args.source.resolve(), args.recipe.resolve(), args.output.resolve()
    need(platform.system() == 'Darwin' and platform.machine() == 'x86_64', 'Require Intel macOS host')
    need(os.environ.get('MACOSX_DEPLOYMENT_TARGET') == '15.0', 'Require macOS15.0 deployment target')
    temp = Path(os.environ['RUNNER_TEMP']).resolve()
    target, cargo_home = (Path(os.environ[name]).resolve() for name in ('CARGO_TARGET_DIR', 'CARGO_HOME'))
    for path in (target, cargo_home, output):
        need(path.is_relative_to(temp), 'Build paths must belong to runner.temp')
        need(not path.is_relative_to(source) and not path.is_relative_to(recipe), 'Build writes overlap checkout')
    need(not target.exists() and not output.exists(), 'Require fresh target/artifact output paths')
    need(len({target, cargo_home, output}) == 3, 'Build paths must be distinct')
    need(all(not a.is_relative_to(b) for a in (target, cargo_home, output)
             for b in (target, cargo_home, output) if a != b), 'Build paths overlap')
    need(git(['status', '--porcelain=v1', '--untracked-files=all'], recipe) == '', 'Recipe checkout is dirty')
    recipe_head = git(['rev-parse', 'HEAD'], recipe)
    recipe_hashes = {name: digest(recipe / name) for name in (WORKFLOW, SUPPORT, HELPER, ABI_SUPPORT)}
    abi_support = load_abi_support(recipe)
    abi_support.source_pin(source)
    output.mkdir(mode=0o700)
    evidence = output / 'evidence'
    evidence.mkdir(mode=0o700)
    # macOS /var can alias /private/var. Native SQLite NOFOLLOW guards
    # require canonical paths even for generated default-temp fixture data.
    # Use a fresh private runner-owned child, outside source/cache/artifacts.
    canonical_tmp = temp / 'pr185-qualifier-canonical-tmp'
    for other in (source, recipe, output, cargo_home, target):
        need(not canonical_tmp.is_relative_to(other) and not other.is_relative_to(canonical_tmp),
             'Fixture TMPDIR overlaps checkout/cache/artifacts')
    need(not canonical_tmp.exists(), 'Canonical fixture TMPDIR already exists')
    canonical_tmp.mkdir(mode=0o700)
    need(canonical_tmp.resolve() == canonical_tmp
         and canonical_tmp.stat().st_mode & 0o777 == 0o700,
         'Fixture TMPDIR must be canonical and private')
    commands = []
    child_env = {key: os.environ[key] for key in
                 ('PATH', 'HOME', 'RUSTUP_HOME', 'LANG', 'LC_ALL', 'LC_CTYPE') if key in os.environ}
    child_env.update({'TMPDIR': str(canonical_tmp), 'RUSTUP_TOOLCHAIN': '1.99.0', 'CARGO_HOME': str(cargo_home),
        'CARGO_TARGET_DIR': str(target), 'CARGO_BUILD_JOBS': '2', 'MACOSX_DEPLOYMENT_TARGET': '15.0',
        'RUSTFLAGS': '-C target-cpu=x86-64',
        'CFLAGS_x86_64_apple_darwin': '-arch x86_64 -mmacosx-version-min=15.0 -march=x86-64 -mtune=generic',
        'CXXFLAGS_x86_64_apple_darwin': '-arch x86_64 -mmacosx-version-min=15.0 -march=x86-64 -mtune=generic'})

    def record(name, argv, required=True, cwd=None):
        result = subprocess.run(argv, cwd=cwd, env=child_env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        (evidence / (name + '.txt')).write_text(result.stdout)
        (evidence / (name + '.stderr.txt')).write_text(result.stderr)
        commands.append({'name': name, 'argv': argv, 'exitCode': result.returncode})
        if required:
            need(result.returncode == 0, 'Command failed: ' + name)
        return result.stdout.strip()

    rust = record('rustc', ['rustc', '-vV'])
    cargo = record('cargo', ['cargo', '--version'])
    need(rust.startswith('rustc 1.99.0 ') and '\nhost: x86_64-apple-darwin\n' in rust + '\n', 'Wrong Rust compiler')
    need(cargo.startswith('cargo 1.99.0 '), 'Wrong Cargo version')
    host = record('host', ['sw_vers'])
    kernel = record('kernel', ['uname', '-a'])
    sdk = record('sdk-version', ['xcrun', '--sdk', 'macosx', '--show-sdk-version'])
    sdk_path = record('sdk-path', ['xcrun', '--sdk', 'macosx', '--show-sdk-path'])
    need(Path(sdk_path).is_dir(), 'SDK unavailable')
    child_env['SDKROOT'] = sdk_path
    clang = record('clang', ['xcrun', 'clang', '--version'])
    xcode = record('xcode', ['xcodebuild', '-version'])
    release = target / TARGET / 'release'
    binary = release / BINARY
    selfcheck = canonical_tmp / 'pr185-qualifier-self-check'
    need(not selfcheck.exists(), 'Self-check output root already exists')
    try:
        record('cargo-fetch', ['cargo', 'fetch', '--locked'], cwd=source)
        record('healthy-native-full-geodata-profile', ['cargo', 'run', '--offline', '--locked',
            '--release', '-p', 'houseatlas-backend', '--example', 'healthy-native-full-geodata-profile',
            '--target', TARGET], cwd=source)
        # Select dependencies from this exact Cargo invocation, not arbitrary glob
        # results, other targets, stale CargoHome or system-installed Rust libraries.
        messages = record('cargo-lib-json', ['cargo', 'build', '--offline', '--locked', '--release',
            '-p', 'houseatlas-backend', '--lib', '--target', TARGET,
            '--message-format=json-render-diagnostics'], cwd=source)
        rlibs = select_rlibs(messages, release)
        rustc_argv = ['rustc', '--edition=2024', '--target', TARGET, '-C', 'opt-level=3',
            '-C', 'target-cpu=x86-64', '--crate-name', 'houseatlas_pr185_full_qualifier',
            '-L', 'dependency=' + str(release / 'deps'),
            '-L', 'dependency=' + str(target / 'release' / 'deps')]
        for name in CRATES:
            rustc_argv += ['--extern', name + '=' + rlibs[name]['path']]
        rustc_argv += [str(recipe / HELPER), '-o', str(binary)]
        record('rustc-qualifier', rustc_argv, cwd=source)
        for linked in rlibs.values():
            need(digest(Path(linked['path'])) == linked['sha256'], 'Linked rlib changed during compilation')
        initial_hash = digest(binary)
        record('qualifier-self-check', [str(binary), 'self-check', '--output-root', str(selfcheck)], cwd=source)
        record('file', ['file', str(binary)])
        arches = record('lipo', ['lipo', '-archs', str(binary)])
        record('otool-load-commands', ['otool', '-l', str(binary)])
        record('otool-linked-libraries', ['otool', '-L', str(binary)])
        record('vtool-build', ['xcrun', 'vtool', '-show-build', str(binary)])
        record('codesign-display', ['codesign', '--display', '--verbose=4', str(binary)], required=False)
        record('codesign-verify', ['codesign', '--verify', '--verbose=4', str(binary)], required=False)
        need(arches == 'x86_64', 'Require thin x86_64 qualifier')
        abi = abi_support.inspect_macho(binary)
        need(digest(binary) == initial_hash, 'Compiled helper changed during read-only checks')
    finally:
        abi_support.source_pin(source)
        need(recipe_head == git(['rev-parse', 'HEAD'], recipe), 'Recipe head changed')
        need(recipe_hashes == {name: digest(recipe / name) for name in recipe_hashes}, 'Recipe files changed')
        need(git(['status', '--porcelain=v1', '--untracked-files=all'], recipe) == '', 'Recipe checkout changed')
    receipt = {'format': 'houseatlas-pr185-qualifier-build/1', 'sourceCommit': SOURCE, 'sourceTree': TREE,
        'cargoLockSha256': LOCK, 'recipeCommit': recipe_head, 'recipeFileSha256': recipe_hashes,
        'helperSourceSha256': recipe_hashes[HELPER], 'linkedRlibs': rlibs, 'target': TARGET,
        'deploymentTarget': '15.0', 'rustc': rust, 'cargo': cargo, 'host': host, 'kernel': kernel,
        'appleSdk': {'version': sdk, 'path': sdk_path, 'clang': clang, 'xcode': xcode},
        'github': {key: os.environ.get(key) for key in ('GITHUB_REPOSITORY', 'GITHUB_RUN_ID',
            'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_WORKFLOW')},
        'effectiveBuildEnvironment': dict(sorted(child_env.items())), 'commands': commands,
        'sourceAndRecipeCleanBeforeAndAfter': True,
        'binary': {'name': BINARY, 'bytes': binary.stat().st_size, 'sha256': initial_hash, 'abi': abi},
        'limitations': ['Generated checks require the recorded canonical private TMPDIR; default /var aliases and target-host compatibility are not qualified.',
            'Named nonempty product healthy example and empty generated helper self-check only.',
            'No supplied household input, private policy/database/media, live provider, account or NAS access.',
            'External qualifier has no account/session setup, grant issuance, listener or HTTP path; its executed self-check uses generated empty data and performs no intake.',
            'The separately named generated product healthy fixture exercises genuine synthetic native sessions/authority and in-process HTTP.',
            'Helper self-check output remains outside uploaded artifacts; no fixture database is packaged.',
            'No NAS/runtime/deployment/rollback acceptance; no credential signing or notarization.']}
    receipt_bytes = (json.dumps(receipt, indent=2, sort_keys=True) + '\n').encode()
    readme = (f'HouseAtlas PR185 external qualifier: {BINARY}\nSource: {SOURCE}\n'
              f'Target: {TARGET}; minimum deployment target15.0.\n'
              'Public external helper linked to the exact product library; no product source mutation.\n'
              'Only named synthetic checks ran. Review build/ABI/source receipts before use.\n'
              'No NAS or actual database/policy qualification or installation is supplied.\n').encode()
    archive = output / (BINARY + '-' + TARGET + '.tar.gz')
    with archive.open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as tar:
                for name, data, mode in [(BINARY, binary.read_bytes(), 0o755),
                        ('BUILD_RECEIPT.json', receipt_bytes, 0o600), ('README.txt', readme, 0o600)]:
                    info = tarfile.TarInfo(name)
                    info.size, info.mode, info.mtime = len(data), mode, 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    tar.addfile(info, io.BytesIO(data))
    with tarfile.open(archive, 'r:gz') as tar:
        need([(m.name, m.mode) for m in tar.getmembers()] == [(BINARY, 0o755),
            ('BUILD_RECEIPT.json', 0o600), ('README.txt', 0o600)], 'Wrong archive members/modes')
        need(hashlib.sha256(tar.extractfile(BINARY).read()).hexdigest() == initial_hash, 'Archived helper mismatch')
    (output / 'BUILD_RECEIPT.json').write_bytes(receipt_bytes)
    (output / 'README.txt').write_bytes(readme)
    (output / 'pr185-full-qualifier.rs').write_bytes((recipe / HELPER).read_bytes())
    detached = {'format': 'houseatlas-pr185-qualifier-archive/1', 'archive': archive.name,
        'bytes': archive.stat().st_size, 'sha256': digest(archive), 'binarySha256': initial_hash,
        'buildReceiptSha256': hashlib.sha256(receipt_bytes).hexdigest(), 'sourceCommit': SOURCE,
        'sourceTree': TREE, 'helperSourceSha256': recipe_hashes[HELPER],
        'evidence': {f.name: digest(f) for f in sorted(evidence.iterdir())}}
    (output / 'ARCHIVE_RECEIPT.json').write_text(json.dumps(detached, indent=2, sort_keys=True) + '\n')
    for path in output.rglob('*'):
        if path.is_file():
            path.chmod(0o600)
    print(json.dumps(detached, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
