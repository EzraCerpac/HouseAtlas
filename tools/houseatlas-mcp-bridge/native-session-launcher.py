#!/usr/bin/env python3
"""Host custody file -> anonymous inherited pipe -> scoped stdio bridge.

The native owner must provision/refresh this genuine session independently.
This launcher cannot log in, issue credentials, choose identity or grant access.
"""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys

ROOT = Path('/Users/server/.local/share/houseatlas-mcp-read-bridge')
CONFIG = Path('/Users/server/.config/houseatlas-mcp-read-bridge')
STATE = Path('/Users/server/.local/state/houseatlas-mcp-read-bridge')
UID = 502


def main():
    if len(sys.argv) != 1 or os.getuid() != UID or os.geteuid() != UID:
        raise RuntimeError()
    for directory in (ROOT, CONFIG, STATE):
        info = directory.lstat()
        if directory.resolve() != directory or not stat.S_ISDIR(info.st_mode) or info.st_uid != UID or stat.S_IMODE(info.st_mode) != 0o700:
            raise RuntimeError()
    helper = ROOT / 'tools/houseatlas-mcp-bridge/bridge.py'
    if helper.resolve() != helper:
        raise RuntimeError()
    # Import the reviewed sibling solely for strict private-file/JSON checks.
    spec = importlib.util.spec_from_file_location('houseatlas_bridge', helper)
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    fd = bridge.private_open(CONFIG / 'native-session.json', os.O_RDONLY)
    with os.fdopen(fd, 'rb') as stream:
        raw = stream.read(8193)
    value = bridge.strict_json(raw, 8192)
    bridge.keys(value, ('cookie',))
    bridge.need(isinstance(value['cookie'], str))
    # Validate nonsecret config and state before starting child; no native request.
    fd = bridge.private_open(CONFIG / 'bridge.json', os.O_RDONLY)
    os.close(fd)
    read_fd, write_fd = os.pipe()
    process = None
    try:
        # Explicit pass_fds only. A shell never sees or interprets credentials.
        process = subprocess.Popen([sys.executable, '-I', '-B', str(helper),
                                    '--config', str(CONFIG / 'bridge.json'),
                                    '--session-fd', str(read_fd), '--state-dir', str(STATE)],
                                   pass_fds=(read_fd,), env={'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'})
        os.close(read_fd); read_fd = -1
        remaining = memoryview(raw)
        while remaining:
            sent = os.write(write_fd, remaining)
            if sent <= 0:
                raise RuntimeError()
            remaining = remaining[sent:]
        os.close(write_fd); write_fd = -1
        return process.wait()
    finally:
        if read_fd >= 0:
            os.close(read_fd)
        if write_fd >= 0:
            os.close(write_fd)
        # Do not retry/restart. A child failure leaves the durable native outcome
        # untouched; the tunnel's reconnection is not write retry permission.
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (Exception, KeyboardInterrupt):
        print('HouseAtlas native session launcher stopped; inspect private custody metadata.', file=sys.stderr)
        raise SystemExit(1)
