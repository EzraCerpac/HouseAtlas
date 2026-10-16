#!/usr/bin/env python3
"""NAS custodian's create-only /dev/tty entry. Never activates a service."""
import json
import os
import re
from pathlib import Path
import signal
import stat
import sys
import termios

UID = None
CONFIG = None
KEY_NAME = 'runtime-key'

class EntryError(Exception):
    pass


def need(condition):
    if not condition:
        raise EntryError()


def check_directory(path, owner=None, mode=None):
    need(path.is_absolute() and path.resolve() == path)
    item = path.lstat()
    need(stat.S_ISDIR(item.st_mode) and not (item.st_mode & 0o022))
    if owner is not None:
        need(item.st_uid == owner)
    if mode is not None:
        need(stat.S_IMODE(item.st_mode) == mode)


def deployment():
    """Trusted installer metadata only; no CLI/env/MCP selection or discovery."""
    script = Path(__file__).absolute()
    need(script.resolve() == script)
    root = script.parent
    if root.name == 'houseatlas-mcp-bridge' and root.parent.name == 'tools':
        root = root.parent.parent
    check_directory(root, os.getuid(), 0o700)
    need(script in (root / 'key-entry.py', root / 'tools/houseatlas-mcp-bridge/key-entry.py'))
    fd = os.open(root / 'deployment.json', os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 16384)
        raw = os.read(fd, 16385)
        need(len(raw) == info.st_size)
    finally:
        os.close(fd)
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out)
            out[key] = value
        return out
    host = json.loads(raw, object_pairs_hook=pairs)
    need(type(host) is dict and set(host) == {'schemaVersion', 'uid', 'root', 'config', 'state', 'tunnel', 'python'})
    need(type(host['schemaVersion']) is int and host['schemaVersion'] == 1
         and type(host['uid']) is int and host['uid'] == os.getuid() == os.geteuid()
         and host['root'] == str(root))
    for key in ('root', 'config', 'state'):
        need(isinstance(host[key], str))
        path = Path(host[key])
        need(path.is_absolute() and path.resolve() == path and len(path.parts) > 2)
    need(len({host[k] for k in ('root', 'config', 'state')}) == 3)
    for key in ('tunnel', 'python'):
        pin = host[key]
        fields = {'path', 'sha256', 'uid', 'mode'} | ({'version'} if key == 'tunnel' else set())
        need(type(pin) is dict and set(pin) == fields and isinstance(pin['path'], str))
        path = Path(pin['path'])
        need(path.is_absolute() and path.resolve() == path and len(path.parts) > 2
             and isinstance(pin['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', pin['sha256'])
             and type(pin['uid']) is int and pin['uid'] >= 0
             and type(pin['mode']) is int and 0 <= pin['mode'] <= 0o777
             and pin['mode'] & 0o111 and not pin['mode'] & 0o022)
    need(isinstance(host['tunnel']['version'], str)
         and re.fullmatch(r'0[.]0[.]14[+][0-9a-f]{40}', host['tunnel']['version']))
    return host


def open_config():
    need(os.getuid() == UID and os.geteuid() == UID)
    for path in reversed(CONFIG.parents):
        check_directory(path)
    check_directory(CONFIG.parent, UID)
    try:
        os.mkdir(CONFIG, 0o700)
        parent = os.open(CONFIG.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    except FileExistsError:
        pass
    check_directory(CONFIG, UID, 0o700)
    fd = os.open(CONFIG, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    need(info.st_uid == UID and stat.S_IMODE(info.st_mode) == 0o700)
    return fd


def read_tty_key():
    # No getpass fallback, stdin, environment, command-line argument or log input.
    fd = os.open('/dev/tty', os.O_RDWR | os.O_NOCTTY | os.O_NOFOLLOW)
    old, handlers = None, {}
    def interrupted(_number, _frame):
        raise KeyboardInterrupt()
    try:
        need(os.isatty(fd))
        old = termios.tcgetattr(fd)
        quiet = termios.tcgetattr(fd)
        quiet[3] &= ~(termios.ECHO | termios.ECHONL | termios.ICANON)
        quiet[6][termios.VMIN] = 1
        quiet[6][termios.VTIME] = 0
        # Require an ordinary terminal on entry, then avoid canonical line truncation.
        need(old[3] & termios.ICANON)
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGQUIT, signal.SIGTSTP):
            handlers[sig] = signal.signal(sig, interrupted)
        termios.tcsetattr(fd, termios.TCSAFLUSH, quiet)
        need(not (termios.tcgetattr(fd)[3] & (termios.ECHO | termios.ECHONL | termios.ICANON)))
        os.write(fd, b'Enter HouseAtlas tunnel runtime key (hidden): ')
        value = bytearray()
        valid = True
        while True:
            part = os.read(fd, 1024)
            need(part)
            line, separator, tail = part.partition(b'\n')
            if valid:
                valid = len(value) + len(line) <= 8192 and all(33 <= c <= 126 for c in line)
                if valid:
                    value.extend(line)
            # Discard the rest of an invalid line with noecho still enabled.
            # Restoring ECHO before its newline could expose delayed SSH paste bytes.
            if separator:
                need(valid and value and not tail)
                break
        os.write(fd, b'\n')
        return bytes(value)
    finally:
        if old is not None:
            termios.tcsetattr(fd, termios.TCSAFLUSH, old)
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        os.close(fd)


def create_key(directory_fd, value):
    # There is deliberately no replacement, retry, unlink or chmod path.
    fd = os.open(KEY_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=directory_fd)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
             and info.st_uid == UID and stat.S_IMODE(info.st_mode) == 0o600)
        view = memoryview(value)
        while view:
            count = os.write(fd, view)
            need(count > 0)
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.fsync(directory_fd)


def main():
    global UID, CONFIG
    need(len(sys.argv) == 1)
    host = deployment()
    UID, CONFIG = host['uid'], Path(host['config'])
    os.umask(0o077)
    directory = open_config()
    try:
        try:
            os.stat(KEY_NAME, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise EntryError()
        value = read_tty_key()
        create_key(directory, value)
        print('Runtime key stored. No service activated.')
    finally:
        os.close(directory)


if __name__ == '__main__':
    try:
        main()
    except (EntryError, OSError, ValueError, TypeError, KeyError, termios.error, KeyboardInterrupt):
        print('Key entry stopped. No replacement or retry was performed; inspect metadata privately.', file=sys.stderr)
        sys.exit(1)
