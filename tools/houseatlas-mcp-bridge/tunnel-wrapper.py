#!/usr/bin/env python3
"""Reviewed NAS wrapper: raw key -> child environment, never shell/config/argv."""
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shlex
import stat
import subprocess
import sys

UID = CONFIG = ROOT = STATE = BINARY = VERSION = PYTHON = None

class WrapperError(Exception):
    pass


def need(condition):
    if not condition:
        raise WrapperError()


def load_host():
    script = Path(__file__).absolute()
    root = script.parents[2]
    need(script.resolve() == script and root.resolve() == root)
    info = root.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
         and stat.S_IMODE(info.st_mode) == 0o700)
    helper = script.parent / 'key-entry.py'
    info = helper.lstat()
    need(helper.resolve() == helper and stat.S_ISREG(info.st_mode)
         and info.st_uid == os.getuid() and info.st_nlink == 1 and not info.st_mode & 0o022)
    return runpy.run_path(str(helper))['deployment']()


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


def verify_executable(path, expected_hash, exact_mode=None, exact_uid=None):
    need(Path(path).resolve() == Path(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= 256 * 1024 * 1024
             and not (before.st_mode & 0o022) and before.st_mode & 0o111)
        if exact_uid is not None:
            need(before.st_uid == exact_uid)
        if exact_mode is not None:
            need(stat.S_IMODE(before.st_mode) == exact_mode)
        digest = hashlib.sha256()
        while True:
            part = os.read(fd, 65536)
            if not part:
                break
            digest.update(part)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns,
                                 item.st_ctime_ns, item.st_mode, item.st_uid, item.st_gid, item.st_nlink)
        need(identity(os.fstat(fd)) == identity(before)
             and identity(os.stat(path, follow_symlinks=False)) == identity(before)
             and digest.hexdigest() == expected_hash)
    finally:
        os.close(fd)


def command(spec):
    need(set(spec) == {'configured', 'registrationId'})
    need(spec['configured'] is True
         and isinstance(spec['registrationId'], str)
         and re.fullmatch(r'tunnel_[0-9a-f]{32}', spec['registrationId']))
    return [BINARY, 'run', '--control-plane.base-url', 'https://api.openai.com',
            '--control-plane.tunnel-id', spec['registrationId'],
            '--control-plane.api-key=env:CONTROL_PLANE_API_KEY',
            '--mcp.command', shlex.join([PYTHON, '-I', '-B', str(ROOT / 'tools/houseatlas-mcp-bridge/native-session-launcher.py')]),
            '--mcp.max-concurrent-requests', '1', '--mcp.stdio-send-initialized-notification',
            '--control-plane.max-inflight', '1', '--health.listen-addr', '127.0.0.1:0',
            '--health.url-file', str(STATE / 'health-url'), '--log.level', 'info', '--log.format', 'json']


def launch():
    global UID, CONFIG, ROOT, STATE, BINARY, VERSION, PYTHON
    host = load_host()
    UID = host['uid']
    CONFIG, ROOT, STATE = (Path(host[key]) for key in ('config', 'root', 'state'))
    BINARY, VERSION, PYTHON = host['tunnel']['path'], host['tunnel']['version'], host['python']['path']
    need(len(sys.argv) == 1 and os.getuid() == UID and os.geteuid() == UID)
    for directory in (ROOT, STATE):
        info = directory.lstat()
        need(directory.resolve() == directory and stat.S_ISDIR(info.st_mode)
             and info.st_uid == UID and stat.S_IMODE(info.st_mode) == 0o700)
    argv = command(json.loads(read_private('launch-spec.json', 16384)))
    for key in ('tunnel', 'python'):
        pin = host[key]
        verify_executable(pin['path'], pin['sha256'], exact_mode=pin['mode'], exact_uid=pin['uid'])
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR')}
    version = subprocess.run([BINARY, '--version'], env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5, check=True)
    need(VERSION in version.stdout.decode('ascii').strip().split())
    value = read_private('runtime-key', 8192)
    need(value and all(33 <= c <= 126 for c in value))
    env['CONTROL_PLANE_API_KEY'] = value.decode('ascii')
    os.execve(BINARY, argv, env)


if __name__ == '__main__':
    try:
        launch()
    except (Exception, KeyboardInterrupt):
        print('HouseAtlas tunnel wrapper stopped; inspect private launch contract metadata.', file=sys.stderr)
        sys.exit(1)
