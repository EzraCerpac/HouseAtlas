"""Job-local pinned Chrome SUID helper custody. Only install/cleanup require root.

No existing helper, browser, policy, package or permission is repaired. The browser
remains user-owned. An archive is copied into an inaccessible root directory and
that copy is verified before extraction, preventing source substitution at chmod.
"""
import argparse
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import sys
import zipfile

VERSION = '156.0.8078.47'
ARCHIVE_SHA = 'e6c94490f0b6b337225aeb2d2a5034858516b7017356980ba94f5176d8774a50'
MEMBER = 'chrome-linux64/chrome_sandbox'
PARENT = Path('/usr/local/libexec')
DIRECTORY = 'houseatlas-ci-sandbox-' + VERSION
DESTINATION = PARENT / DIRECTORY / 'chrome-sandbox'
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_HELPER = 4 * 1024 * 1024
NOFOLLOW = os.O_NOFOLLOW
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW


class Refused(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def identity(info):
    return [info.st_dev, info.st_ino]


def secure_directory(info):
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
            and not info.st_mode & 0o022, 'insecure directory; no permissions changed')


def secure_file(info, modes):
    require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) in modes,
            'unexpected file ownership, mode, type or links')


def parent_fd(create):
    """Walk held root-owned, non-writable, no-follow directory descriptors."""
    descriptor = os.open('/', DIR_FLAGS)
    made = False
    walked = Path('/')
    try:
        secure_directory(os.fstat(descriptor))
        for component in ('usr', 'local', 'libexec'):
            walked = walked / component
            try:
                child = os.open(component, DIR_FLAGS, dir_fd=descriptor)
            except FileNotFoundError:
                if not create:
                    raise
                require(component == 'libexec', 'required parent absent')
                os.mkdir(component, 0o755, dir_fd=descriptor)
                made = True
                child = os.open(component, DIR_FLAGS, dir_fd=descriptor)
                os.fchown(child, 0, 0)
                os.fchmod(child, 0o755)
            try:
                secure_directory(os.fstat(child))
            except Refused as error:
                info = os.fstat(child)
                os.close(child)
                raise Refused(str(walked) + ': uid=' + str(info.st_uid)
                              + ' mode=' + oct(stat.S_IMODE(info.st_mode)) + '; ' + str(error)) from error
            except BaseException:
                os.close(child)
                raise
            os.close(descriptor)
            descriptor = child
        return descriptor, made
    except BaseException:
        os.close(descriptor)
        raise


def copy_verified_archive(source, output, expected=ARCHIVE_SHA):
    descriptor = os.open(source, os.O_RDONLY | NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as incoming:
        info = os.fstat(incoming.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and 0 < info.st_size <= MAX_ARCHIVE, 'archive is not a bounded regular file')
        total = 0
        while chunk := incoming.read(1024 * 1024):
            total += len(chunk)
            require(total <= MAX_ARCHIVE, 'archive exceeds bound')
            output.write(chunk)
    output.flush()
    os.fsync(output.fileno())
    output.seek(0)
    digest = hashlib.file_digest(output, 'sha256').hexdigest()
    require(digest == expected, 'root-private archive copy differs from pin')
    output.seek(0)


def extract_helper(archive, output):
    with zipfile.ZipFile(archive) as source:
        matches = [row for row in source.infolist() if row.filename == MEMBER]
        require(len(matches) == 1, 'helper member missing or duplicated')
        row = matches[0]
        kind = stat.S_IFMT(row.external_attr >> 16)
        require(not row.is_dir() and kind in (0, stat.S_IFREG)
                and not row.flag_bits & 1 and row.compress_type in (0, 8)
                and 0 < row.file_size <= MAX_HELPER, 'unsupported helper member')
        total = 0
        digest = hashlib.sha256()
        with source.open(row) as incoming:
            while chunk := incoming.read(65536):
                total += len(chunk)
                require(total <= MAX_HELPER, 'helper exceeds bound')
                if total == len(chunk):
                    require(chunk.startswith(b'\x7fELF'), 'helper is not ELF')
                output.write(chunk)
                digest.update(chunk)
        require(total == row.file_size, 'helper size mismatch')
    output.flush()
    os.fsync(output.fileno())
    return digest.hexdigest()


def file_digest(descriptor):
    os.lseek(descriptor, 0, os.SEEK_SET)
    with os.fdopen(os.dup(descriptor), 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def new_file(directory, name, mode):
    return os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | NOFOLLOW,
                   mode, dir_fd=directory)


def verify_marker(marker, job, directory_info, parent_info):
    require(isinstance(marker, dict) and set(marker) == {
        'format', 'job', 'archive', 'sha256', 'directory', 'helper', 'parent', 'madeParent'},
        'unexpected ownership marker shape')
    def valid_identity(value):
        return (isinstance(value, list) and len(value) == 2
                and all(type(part) is int for part in value)
                and value[0] >= 0 and value[1] > 0)
    require(all(valid_identity(marker[key]) for key in ('directory', 'helper', 'parent')),
            'invalid ownership identity')
    require(type(marker['format']) is int and marker['format'] == 1 and marker['job'] == job
            and marker['archive'] == ARCHIVE_SHA
            and marker['directory'] == identity(directory_info)
            and marker['parent'] == identity(parent_info)
            and type(marker['madeParent']) is bool
            and isinstance(marker['sha256'], str)
            and re.fullmatch(r'[0-9a-f]{64}', marker['sha256']) is not None,
            'directory is not owned by this job')


def install(archive_path, job):
    parent, made_parent = parent_fd(True)
    directory = None
    created = False
    complete = False
    try:
        os.mkdir(DIRECTORY, 0o700, dir_fd=parent)  # Existing destinations refuse.
        created = True
        directory = os.open(DIRECTORY, DIR_FLAGS, dir_fd=parent)
        secure_directory(os.fstat(directory))
        os.fchown(directory, 0, 0)
        os.fchmod(directory, 0o700)
        fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with os.fdopen(new_file(directory, 'source.zip', 0o600), 'w+b') as archive:
            copy_verified_archive(archive_path, archive)
            with os.fdopen(new_file(directory, 'chrome-sandbox', 0o755), 'w+b') as helper:
                os.fchown(helper.fileno(), 0, 0)
                os.fchmod(helper.fileno(), 0o755)
                expected = extract_helper(archive, helper)
        os.unlink('source.zip', dir_fd=directory)
        # No writable descriptor survives into activation or later API execution.
        helper = os.open('chrome-sandbox', os.O_RDONLY | NOFOLLOW, dir_fd=directory)
        try:
            info = os.fstat(helper)
            secure_file(info, (0o755,))
            require(file_digest(helper) == expected, 'installed helper differs from member')
            require(identity(os.stat('chrome-sandbox', dir_fd=directory, follow_symlinks=False))
                    == identity(info), 'helper identity changed')
            marker = {'format': 1, 'job': job, 'archive': ARCHIVE_SHA, 'sha256': expected,
                      'directory': identity(os.fstat(directory)), 'helper': identity(info),
                      'parent': identity(os.fstat(parent)), 'madeParent': made_parent}
            with os.fdopen(new_file(directory, 'owner.json', 0o600), 'w') as owner:
                os.fchown(owner.fileno(), 0, 0)
                json.dump(marker, owner, sort_keys=True)
                owner.flush()
                os.fsync(owner.fileno())
            os.fsync(directory)  # Ownership record is durable BEFORE any SUID bit.
            os.fchmod(helper, 0o4755)
            os.fsync(helper)
            secure_file(os.fstat(helper), (0o4755,))
            require(identity(os.stat(DIRECTORY, dir_fd=parent, follow_symlinks=False))
                    == identity(os.fstat(directory)), 'job directory changed before publication')
            os.fchmod(directory, 0o755)  # Publish only the verified read-only helper.
            os.fsync(directory)
            os.fsync(parent)
        finally:
            os.close(helper)
        complete = True
        print(json.dumps({'path': str(DESTINATION), 'sha256': expected,
                          'archiveSha256': ARCHIVE_SHA, 'api': 'not queried by installer'}))
    finally:
        if created and not complete and directory is not None:
            # Only entries created by this invocation, inside its held private FD.
            for name in ('chrome-sandbox', 'source.zip', 'owner.json'):
                try:
                    os.unlink(name, dir_fd=directory)
                except FileNotFoundError:
                    pass
            require(identity(os.stat(DIRECTORY, dir_fd=parent, follow_symlinks=False))
                    == identity(os.fstat(directory)), 'failed-install directory replaced')
            os.rmdir(DIRECTORY, dir_fd=parent)
        if directory is not None:
            os.close(directory)
        if made_parent and not complete:
            try:
                require(identity(os.stat(PARENT, follow_symlinks=False)) == identity(os.fstat(parent)),
                        'created parent changed after failed install')
                os.rmdir(PARENT)
            except OSError as error:
                if error.errno not in (errno.ENOTEMPTY, errno.EEXIST):
                    raise
        os.close(parent)


def cleanup(job):
    try:
        parent, _ = parent_fd(False)
    except FileNotFoundError:
        return
    directory = None
    try:
        try:
            directory = os.open(DIRECTORY, DIR_FLAGS, dir_fd=parent)
        except FileNotFoundError:
            return
        secure_directory(os.fstat(directory))
        fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        contents = set(os.listdir(directory))
        require('owner.json' in contents and contents <= {'chrome-sandbox', 'owner.json'},
                'unexpected job directory contents; no recursive deletion')
        owner = os.open('owner.json', os.O_RDONLY | NOFOLLOW, dir_fd=directory)
        with os.fdopen(owner, 'r') as source:
            secure_file(os.fstat(source.fileno()), (0o600,))
            require(os.fstat(source.fileno()).st_size <= 4096, 'oversized ownership marker')
            marker = json.load(source)
        verify_marker(marker, job, os.fstat(directory), os.fstat(parent))
        if 'chrome-sandbox' in contents:
            helper = os.open('chrome-sandbox', os.O_RDONLY | NOFOLLOW, dir_fd=directory)
            try:
                info = os.fstat(helper)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0
                        and marker['helper'] == identity(info), 'helper ownership changed')
                # Revoke privileges on the positively identified job inode even if
                # later hash/link validation must refuse deletion of changed state.
                os.fchmod(helper, stat.S_IMODE(info.st_mode) & ~(stat.S_ISUID | stat.S_ISGID))
                secure_file(os.fstat(helper), (0o755,))
                require(marker['sha256'] == file_digest(helper), 'helper contents changed')
                require(identity(os.stat('chrome-sandbox', dir_fd=directory, follow_symlinks=False))
                        == identity(os.fstat(helper)), 'helper replaced during cleanup')
                os.unlink('chrome-sandbox', dir_fd=directory)
            finally:
                os.close(helper)
        os.unlink('owner.json', dir_fd=directory)
        require(identity(os.stat(DIRECTORY, dir_fd=parent, follow_symlinks=False))
                == identity(os.fstat(directory)), 'directory replaced during cleanup')
        os.rmdir(DIRECTORY, dir_fd=parent)
        os.fsync(parent)
        if marker.get('madeParent'):
            require(identity(os.stat(PARENT, follow_symlinks=False)) == identity(os.fstat(parent)),
                    'created parent changed')
            try:
                os.rmdir(PARENT)
            except OSError as error:
                if error.errno not in (errno.ENOTEMPTY, errno.EEXIST):
                    raise
        print('Removed only the marker-bound job helper; no environment variable emptied.')
    finally:
        if directory is not None:
            os.close(directory)
        os.close(parent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('install', 'cleanup'))
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--job', required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'root is required for approved job helper custody')
    require(sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and os.environ.get('RUNNER_OS') == 'Linux', 'only ephemeral Linux GitHub jobs')
    release = platform.freedesktop_os_release()
    require(release.get('ID') == 'ubuntu' and release.get('VERSION_ID') == '24.04',
            'only the existing Ubuntu24 runner profile')
    require(re.fullmatch(r'[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,80}', args.job) is not None,
            'invalid job correlation')
    if args.action == 'install':
        require(args.archive is not None, 'archive required')
        require(Path('/proc/sys/fs/protected_hardlinks').read_text().strip() == '1',
                'protected hardlinks must already be enabled; no policy change')
        install(args.archive, args.job)
    else:
        require(args.archive is None, 'cleanup takes no archive')
        cleanup(args.job)


if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, ValueError, zipfile.BadZipFile) as error:
        print('chrome-sandbox custody refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
