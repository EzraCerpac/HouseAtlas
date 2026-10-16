"""Synthetic TTY/filesystem fixtures only; never the NAS key path or binary."""
import argparse
import importlib.util
import os
from pathlib import Path
import pty
import stat
import tempfile
import termios
import threading
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

entry = module('entry', HERE / 'key-entry.py')
wrapper = module('wrapper', HERE / 'tunnel-wrapper.py')
launcher = module('launcher', HERE / 'native-session-launcher.py')

class Cases(unittest.TestCase):
    def healthy_create_only_file(self):
        with tempfile.TemporaryDirectory(prefix='houseatlas-key-synthetic-') as root:
            os.chmod(root, 0o700)
            directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                with patch.object(entry, 'UID', os.getuid()):
                    entry.create_key(directory, b'SYNTHETIC-ONLY-NOT-A-CREDENTIAL')
                path = Path(root) / 'runtime-key'
                info = path.lstat()
                self.assertTrue(stat.S_ISREG(info.st_mode))
                self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
                self.assertEqual(info.st_nlink, 1)
                self.assertEqual(info.st_uid, os.getuid())
                self.assertEqual(path.read_bytes(), b'SYNTHETIC-ONLY-NOT-A-CREDENTIAL')
            finally:
                os.close(directory)

    def healthy_tty_noecho(self):
        master, slave = pty.openpty()
        original = termios.tcgetattr(slave)
        observed = bytearray()
        errors = []
        def typer():
            try:
                while b'(hidden): ' not in observed:
                    observed.extend(os.read(master, 1024))
                os.write(master, b'SYNTHETIC-TTY-ONLY\n')
            except BaseException as error:
                errors.append(error)
        real_open = os.open
        def fake_open(path, flags, *args, **kwargs):
            if path == '/dev/tty':
                return os.dup(slave)
            return real_open(path, flags, *args, **kwargs)
        worker = threading.Thread(target=typer, daemon=True)
        worker.start()
        try:
            with patch.object(entry.os, 'open', fake_open):
                value = entry.read_tty_key()
            worker.join(2)
            self.assertFalse(worker.is_alive())
            self.assertEqual(errors, [])
            self.assertEqual(value, b'SYNTHETIC-TTY-ONLY')
            self.assertEqual(termios.tcgetattr(slave), original)
            os.set_blocking(master, False)
            try:
                observed.extend(os.read(master, 1024))
            except BlockingIOError:
                pass
            self.assertNotIn(b'SYNTHETIC-TTY-ONLY', observed)
        finally:
            os.close(master); os.close(slave)

    def denial_tty_oversize(self):
        master, slave = pty.openpty()
        original = termios.tcgetattr(slave)
        observed = bytearray()
        def typer():
            while b'(hidden): ' not in observed:
                observed.extend(os.read(master, 1024))
            os.write(master, b'X' * 9000)
            time.sleep(0.05)
            os.write(master, b'SYNTHETIC-SUFFIX-NEVER-ECHO\n')
        real_open = os.open
        def fake_open(path, flags, *args, **kwargs):
            return os.dup(slave) if path == '/dev/tty' else real_open(path, flags, *args, **kwargs)
        worker = threading.Thread(target=typer, daemon=True)
        worker.start()
        try:
            with patch.object(entry.os, 'open', fake_open):
                with self.assertRaises(entry.EntryError): entry.read_tty_key()
            worker.join(2)
            self.assertFalse(worker.is_alive())
            self.assertEqual(termios.tcgetattr(slave), original)
            os.set_blocking(master, False)
            while True:
                try:
                    observed.extend(os.read(master, 4096))
                except BlockingIOError:
                    break
            self.assertNotIn(b'XXXXX', observed)
            self.assertNotIn(b'SYNTHETIC-SUFFIX-NEVER-ECHO', observed)
        finally:
            os.close(master); os.close(slave)

    def denial_existing_or_symlink(self):
        with tempfile.TemporaryDirectory(prefix='houseatlas-key-denial-') as root:
            directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                target = Path(root) / 'other'
                target.write_bytes(b'SYNTHETIC-PREIMAGE')
                (Path(root) / 'runtime-key').symlink_to(target)
                with self.assertRaises(FileExistsError):
                    entry.create_key(directory, b'SYNTHETIC-NEVER-WRITTEN')
                self.assertEqual(target.read_bytes(), b'SYNTHETIC-PREIMAGE')
            finally:
                os.close(directory)

    def denial_no_tty_fallback(self):
        with patch.object(entry.os, 'open', side_effect=OSError('synthetic no TTY')):
            with self.assertRaises(OSError): entry.read_tty_key()

    def denial_unconfigured_wrapper(self):
        spec = b'{"configured":false,"expectedVersion":"unused","argv":[],"controlPlaneOrigin":null,"healthContract":null}'
        names = []
        def read(name, limit):
            names.append(name)
            self.assertEqual(name, 'launch-spec.json')
            return spec
        with patch.object(wrapper.os, 'getuid', return_value=502), patch.object(wrapper.os, 'geteuid', return_value=502), \
             patch.object(wrapper.sys, 'argv', ['wrapper']), patch.object(wrapper, 'read_private', read), \
             patch.object(wrapper.subprocess, 'run', side_effect=AssertionError('No binary execution')):
            with self.assertRaises(wrapper.WrapperError): wrapper.launch()
        self.assertEqual(names, ['launch-spec.json'])

    def healthy_launcher_pipe(self):
        with tempfile.TemporaryDirectory(prefix='houseatlas-launcher-synthetic-') as temp:
            root, config, state = (Path(temp) / name for name in ('source', 'config', 'state'))
            for directory in (root, config, state): directory.mkdir(mode=0o700)
            helper = root / 'tools/houseatlas-mcp-bridge/bridge.py'
            helper.parent.mkdir(parents=True)
            helper.write_bytes((HERE / 'bridge.py').read_bytes())
            cookie = b'{"cookie":"SYNTHETIC-NATIVE-COOKIE-ONLY"}'
            for name, value in (('native-session.json', cookie), ('bridge.json', b'{}')):
                (config / name).write_bytes(value)
                (config / name).chmod(0o600)
            captured = {}
            class Child:
                def __init__(self, argv, **kwargs):
                    captured.update(argv=argv, kwargs=kwargs)
                    self.fd = os.dup(kwargs['pass_fds'][0])
                    self.done = False
                def wait(self):
                    captured['pipeBytes'] = os.read(self.fd, 8192)
                    os.close(self.fd)
                    self.done = True
                    return 0
                def poll(self): return 0 if self.done else None
            with patch.object(launcher, 'UID', os.getuid()), patch.object(launcher, 'ROOT', root), \
                 patch.object(launcher, 'CONFIG', config), patch.object(launcher, 'STATE', state), \
                 patch.object(launcher.sys, 'argv', ['launcher']), patch.object(launcher.subprocess, 'Popen', Child):
                self.assertEqual(launcher.main(), 0)
            self.assertEqual(captured['pipeBytes'], cookie)
            self.assertNotIn('SYNTHETIC-NATIVE-COOKIE-ONLY', ' '.join(captured['argv']))
            self.assertNotIn('CONTROL_PLANE_API_KEY', captured['kwargs']['env'])
            self.assertEqual(len(captured['kwargs']['pass_fds']), 1)

    def healthy_wrapper_environment(self):
        spec = {'configured': True, 'expectedVersion': wrapper.VERSION,
                'argv': ['SYNTHETIC-REVIEWED-FLAGS'], 'controlPlaneOrigin': 'https://api.openai.com',
                'healthContract': 'Synthetic loopback-only health contract'}
        import json
        def read(name, limit):
            return json.dumps(spec).encode() if name == 'launch-spec.json' else b'SYNTHETIC-WRAPPER-ONLY'
        def run(argv, **kwargs):
            self.assertNotIn('CONTROL_PLANE_API_KEY', kwargs['env'])
            self.assertEqual(argv, [wrapper.BINARY, '--version'])
            return types.SimpleNamespace(stdout=wrapper.VERSION.encode())
        captured = {}
        def execute(binary, argv, env):
            captured.update(binary=binary, argv=argv, env=env)
        with patch.object(wrapper.os, 'getuid', return_value=502), patch.object(wrapper.os, 'geteuid', return_value=502), \
             patch.object(wrapper.sys, 'argv', ['wrapper']), patch.object(wrapper, 'read_private', read), \
             patch.object(wrapper.Path, 'resolve', lambda self: self), \
             patch.object(wrapper.os, 'stat', return_value=types.SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=0)), \
             patch.object(wrapper.subprocess, 'run', run), patch.object(wrapper.os, 'execve', execute):
            wrapper.launch()
        self.assertEqual(captured['env']['CONTROL_PLANE_API_KEY'], 'SYNTHETIC-WRAPPER-ONLY')
        self.assertNotIn('SYNTHETIC-WRAPPER-ONLY', captured['argv'])
        self.assertEqual(captured['binary'], wrapper.BINARY)

HEALTHY = ('healthy_create_only_file', 'healthy_tty_noecho', 'healthy_wrapper_environment', 'healthy_launcher_pipe')
REGRESSION = ('denial_existing_or_symlink', 'denial_no_tty_fallback', 'denial_unconfigured_wrapper', 'denial_tty_oversize')
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case', choices=HEALTHY + REGRESSION)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([Cases(args.case)]))
    raise SystemExit(0 if result.wasSuccessful() else 1)
