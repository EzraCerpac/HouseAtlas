#!/usr/bin/env python3
"""Reviewed NAS wrapper: raw key -> child environment, never shell/config/argv."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

UID = 502
CONFIG = Path('/Users/server/.config/houseatlas-mcp-read-bridge')
BINARY = '/usr/local/Cellar/tunnel-client/0.0.14/bin/tunnel-client'
VERSION = '0.0.14+0f870e50a973fa820d4c409000059e181e8d242b'

class WrapperError(Exception):
    pass


def need(condition):
    if not condition:
        raise WrapperError()


def read_private(name, limit):
    need(CONFIG.resolve() == CONFIG)
    directory = CONFIG.lstat()
    need(stat.S_ISDIR(directory.st_mode) and directory.st_uid == UID
         and stat.S_IMODE(directory.st_mode) == 0o700)
    fd = os.open(CONFIG / name, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == UID and info.st_nlink == 1
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= limit)
        value = os.read(fd, limit + 1)
        need(len(value) == info.st_size)
        return value
    finally:
        os.close(fd)


def launch():
    need(len(sys.argv) == 1 and os.getuid() == UID and os.geteuid() == UID)
    # Launch flags/origin/health contract must come from the NAS owner's inspected
    # 0.0.14 CLI. The delivered spec is deliberately unconfigured and cannot run.
    spec = json.loads(read_private('launch-spec.json', 16384))
    need(set(spec) == {'configured', 'expectedVersion', 'argv', 'controlPlaneOrigin', 'healthContract'})
    need(spec['configured'] is True and spec['expectedVersion'] == VERSION)
    need(isinstance(spec['argv'], list) and spec['argv'] and len(spec['argv']) <= 64
         and all(isinstance(a, str) and 0 < len(a) <= 2048 and '\0' not in a
                 and '\n' not in a and '\r' not in a for a in spec['argv']))
    need(isinstance(spec['controlPlaneOrigin'], str) and spec['controlPlaneOrigin'].startswith('https://')
         and isinstance(spec['healthContract'], str) and spec['healthContract'])
    need(Path(BINARY).resolve() == Path(BINARY))
    info = os.stat(BINARY)
    need(stat.S_ISREG(info.st_mode) and not (info.st_mode & 0o022) and info.st_uid == 0)
    # Version probe precedes reading the key and has a credential-free environment.
    env = {k: v for k, v in os.environ.items() if k != 'CONTROL_PLANE_API_KEY'}
    version = subprocess.run([BINARY, '--version'], env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5, check=True)
    need(VERSION in version.stdout.decode('ascii').strip().split())
    value = read_private('runtime-key', 8192)
    need(value and all(33 <= c <= 126 for c in value))
    env['CONTROL_PLANE_API_KEY'] = value.decode('ascii')
    os.execve(BINARY, [BINARY] + spec['argv'], env)


if __name__ == '__main__':
    try:
        launch()
    except (WrapperError, OSError, ValueError, subprocess.SubprocessError):
        print('HouseAtlas tunnel wrapper stopped; inspect private launch contract metadata.', file=sys.stderr)
        sys.exit(1)
