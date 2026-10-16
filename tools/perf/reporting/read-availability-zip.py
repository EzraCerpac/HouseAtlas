"""Read exactly one bounded JSON member into stdout, without extracting files."""
import io
import stat
import sys
import zipfile

try:
    archive = sys.stdin.buffer.read(65537)
    if len(archive) > 65536:
        raise ValueError()
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        entries = source.infolist()
        if len(entries) != 1:
            raise ValueError()
        entry = entries[0]
        mode = stat.S_IFMT(entry.external_attr >> 16)
        if (entry.filename != "availability.json" or entry.orig_filename != "availability.json"
                or entry.is_dir() or mode not in (0, stat.S_IFREG)
                or entry.flag_bits & 1 or entry.file_size > 4096
                or entry.compress_size > 16384
                or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            raise ValueError()
        with source.open(entry) as member:
            payload = member.read(4097)
        if len(payload) != entry.file_size or len(payload) > 4096:
            raise ValueError()
        sys.stdout.buffer.write(payload)
except Exception:
    sys.stderr.write("Invalid availability archive\n")
    sys.exit(1)
