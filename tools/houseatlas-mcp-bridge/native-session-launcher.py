#!/usr/bin/env python3
"""Start the fixed bridge; native gateway login/cookie/CSRF stay in memory."""
import os
from pathlib import Path
import stat
import sys

ROOT = Path('/Users/server/.local/share/houseatlas-mcp-read-bridge')
CONFIG = Path('/Users/server/.config/houseatlas-mcp-read-bridge')
STATE = Path('/Users/server/.local/state/houseatlas-mcp-read-bridge')
PYTHON = '/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14'
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
    # No native-session.json, cookie pipe or credential extraction. The bridge
    # uses its normal canonical HTTPS /auth/proxy owner and logs out on shutdown.
    os.execve(PYTHON, [PYTHON, '-I', '-B', str(helper), '--config', str(CONFIG / 'bridge.json'),
                       '--state-dir', str(STATE)], {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'})


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('HouseAtlas native session launcher stopped; inspect private custody metadata.', file=sys.stderr)
        raise SystemExit(1)
