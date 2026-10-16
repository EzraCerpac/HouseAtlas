#!/usr/bin/env python3
"""Start the fixed bridge; native gateway login/cookie/CSRF stay in memory."""
import os
from pathlib import Path
import runpy
import stat
import sys

def load_host():
    script = Path(__file__).absolute()
    root = script.parents[2]
    if script.resolve() != script or root.resolve() != root:
        raise RuntimeError()
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError()
    helper = script.parent / 'key-entry.py'
    info = helper.lstat()
    if helper.resolve() != helper or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o022:
        raise RuntimeError()
    return runpy.run_path(str(helper))['deployment']()


def main():
    host = load_host()
    root, config, state = (Path(host[key]) for key in ('root', 'config', 'state'))
    python, owner = host['python']['path'], host['uid']
    if len(sys.argv) != 1 or os.getuid() != owner or os.geteuid() != owner:
        raise RuntimeError()
    for directory in (root, config, state):
        info = directory.lstat()
        if directory.resolve() != directory or not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or stat.S_IMODE(info.st_mode) != 0o700:
            raise RuntimeError()
    helper = root / 'tools/houseatlas-mcp-bridge/bridge.py'
    if helper.resolve() != helper:
        raise RuntimeError()
    # No native-session.json, cookie pipe or credential extraction. The bridge
    # uses its normal canonical HTTPS /auth/proxy owner and logs out on shutdown.
    os.execve(python, [python, '-I', '-B', str(helper), '--config', str(config / 'bridge.json'),
                       '--state-dir', str(state)], {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'})


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('HouseAtlas native session launcher stopped; inspect private custody metadata.', file=sys.stderr)
        raise SystemExit(1)
