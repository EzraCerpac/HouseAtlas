"""Generated archive/metadata controls only. Never invoke install, cleanup, SUID
permissions, a helper, browser, sudo or a real package/network operation.
"""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import warnings
import zipfile

SPEC = importlib.util.spec_from_file_location('chrome_sandbox', Path(__file__).with_name('chrome_sandbox.py'))
custody = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(custody)
PAYLOAD = b'\x7fELFgenerated-inert-bytes-not-an-executable'


def generated_zip(entries=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for kind, payload in entries or [(stat.S_IFREG, PAYLOAD)]:
            info = zipfile.ZipInfo(custody.MEMBER)
            info.create_system = 3
            info.external_attr = (kind | 0o755) << 16
            archive.writestr(info, payload)
    return output.getvalue()


class ChromeSandboxDataTests(unittest.TestCase):
    def test_verified_private_copy_extracts_exact_generated_bytes(self):
        raw = generated_zip()
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'synthetic.zip'
            source.write_bytes(raw)
            with tempfile.TemporaryFile() as copied:
                custody.copy_verified_archive(source, copied, hashlib.sha256(raw).hexdigest())
                with tempfile.TemporaryFile() as helper:
                    digest = custody.extract_helper(copied, helper)
                    helper.seek(0)
                    self.assertEqual(helper.read(), PAYLOAD)
                    self.assertEqual(digest, hashlib.sha256(PAYLOAD).hexdigest())

    def test_changed_archive_is_refused_before_member_extraction(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'synthetic.zip'
            source.write_bytes(generated_zip())
            with tempfile.TemporaryFile() as copied:
                with self.assertRaises(custody.Refused):
                    custody.copy_verified_archive(source, copied, '0' * 64)

    def test_source_symlink_and_hardlink_are_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'synthetic.zip'
            source.write_bytes(generated_zip())
            alias = Path(folder) / 'alias.zip'
            alias.symlink_to(source)
            with tempfile.TemporaryFile() as copied:
                with self.assertRaises(OSError):
                    custody.copy_verified_archive(alias, copied)
            alias.unlink()
            os.link(source, alias)
            with tempfile.TemporaryFile() as copied:
                with self.assertRaises(custody.Refused):
                    custody.copy_verified_archive(source, copied)

    def test_archive_and_member_size_bounds_refuse(self):
        raw = generated_zip()
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'synthetic.zip'
            source.write_bytes(raw)
            with tempfile.TemporaryFile() as copied, patch.object(custody, 'MAX_ARCHIVE', 4):
                with self.assertRaises(custody.Refused):
                    custody.copy_verified_archive(source, copied, hashlib.sha256(raw).hexdigest())
        with tempfile.TemporaryFile() as helper, patch.object(custody, 'MAX_HELPER', 4):
            with self.assertRaises(custody.Refused):
                custody.extract_helper(io.BytesIO(raw), helper)

    def test_duplicate_or_symlink_members_are_refused(self):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            duplicate = generated_zip([(stat.S_IFREG, PAYLOAD), (stat.S_IFREG, PAYLOAD)])
        for raw in [duplicate, generated_zip([(stat.S_IFLNK, PAYLOAD)])]:
            with self.subTest(), tempfile.TemporaryFile() as helper:
                with self.assertRaises(custody.Refused):
                    custody.extract_helper(io.BytesIO(raw), helper)

    def test_non_elf_and_crc_corruption_are_refused(self):
        with tempfile.TemporaryFile() as helper:
            with self.assertRaises(custody.Refused):
                custody.extract_helper(io.BytesIO(generated_zip([(stat.S_IFREG, b'not ELF')])), helper)
        raw = bytearray(generated_zip())
        raw[raw.index(PAYLOAD) + 4] ^= 1
        with tempfile.TemporaryFile() as helper:
            with self.assertRaises(zipfile.BadZipFile):
                custody.extract_helper(io.BytesIO(raw), helper)

    def test_original_replacement_cannot_change_already_verified_copy(self):
        raw = generated_zip()
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'synthetic.zip'
            source.write_bytes(raw)
            with tempfile.TemporaryFile() as copied:
                custody.copy_verified_archive(source, copied, hashlib.sha256(raw).hexdigest())
                source.write_bytes(b'replaced original after copy verification')
                with tempfile.TemporaryFile() as helper:
                    self.assertEqual(custody.extract_helper(copied, helper), hashlib.sha256(PAYLOAD).hexdigest())

    def test_untrusted_metadata_never_qualifies_for_activation(self):
        def info(kind, mode, uid=0, gid=0, links=1):
            return SimpleNamespace(st_mode=kind | mode, st_uid=uid, st_gid=gid, st_nlink=links)
        custody.secure_directory(info(stat.S_IFDIR, 0o755))
        custody.secure_file(info(stat.S_IFREG, 0o4755), (0o4755,))
        for candidate in [info(stat.S_IFDIR, 0o777), info(stat.S_IFDIR, 0o755, uid=1001),
                          info(stat.S_IFLNK, 0o755)]:
            with self.subTest(), self.assertRaises(custody.Refused):
                custody.secure_directory(candidate)
        for candidate in [info(stat.S_IFREG, 0o777), info(stat.S_IFREG, 0o4755, uid=1001),
                          info(stat.S_IFREG, 0o4755, links=2), info(stat.S_IFREG, 0o4755, gid=1001),
                          info(stat.S_IFLNK, 0o4755)]:
            with self.subTest(), self.assertRaises(custody.Refused):
                custody.secure_file(candidate, (0o4755,))

    def test_installer_pin_matches_existing_verified_browser_source(self):
        action = (Path(__file__).resolve().parents[2] / '.github/actions/ordinary-setup/action.yml').read_text()
        self.assertIn("CHROME_VERSION: '" + custody.VERSION + "'", action)
        self.assertIn('CHROME_SHA256: ' + custody.ARCHIVE_SHA, action)
        with tempfile.TemporaryFile() as helper:
            helper.write(PAYLOAD)
            helper.flush()
            self.assertEqual(custody.file_digest(helper.fileno()), hashlib.sha256(PAYLOAD).hexdigest())
            self.assertEqual(custody.file_digest(helper.fileno()), hashlib.sha256(PAYLOAD).hexdigest())

    def test_cleanup_marker_is_bound_to_exact_job_and_directory(self):
        directory = SimpleNamespace(st_dev=1, st_ino=2)
        parent = SimpleNamespace(st_dev=1, st_ino=3)
        marker = {'format': 1, 'job': '100:1:frontend', 'archive': custody.ARCHIVE_SHA,
                  'sha256': 'a' * 64, 'directory': [1, 2], 'helper': [1, 4],
                  'parent': [1, 3], 'madeParent': False}
        custody.verify_marker(marker, '100:1:frontend', directory, parent)
        for key, value in [('job', '100:2:frontend'), ('directory', [1, 9]),
                           ('parent', [2, 3]), ('archive', '0' * 64),
                           ('madeParent', 'true'), ('sha256', 'unknown'),
                           ('format', True), ('directory', [True, 2]),
                           ('helper', [1, 0]), ('helper', [1, '4'])]:
            with self.subTest(key=key), self.assertRaises(custody.Refused):
                custody.verify_marker({**marker, key: value}, '100:1:frontend', directory, parent)
        with self.assertRaises(custody.Refused):
            custody.verify_marker([], '100:1:frontend', directory, parent)


if __name__ == '__main__':
    unittest.main()
