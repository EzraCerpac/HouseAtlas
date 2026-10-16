#!/usr/bin/env python3
"""NAS custodian's create-only /dev/tty entry. Never activates a service."""
import os
from pathlib import Path
import signal
import stat
import sys
import termios

UID = 502
CONFIG = Path('/Users/server/.config/houseatlas-mcp-read-bridge')
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


def open_config():
    need(os.getuid() == UID and os.geteuid() == UID)
    for path in (Path('/Users'), Path('/Users/server'), Path('/Users/server/.config')):
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
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
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
    need(len(sys.argv) == 1)
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
    except (EntryError, OSError, termios.error, KeyboardInterrupt):
        print('Key entry stopped. No replacement or retry was performed; inspect metadata privately.', file=sys.stderr)
        sys.exit(1)
