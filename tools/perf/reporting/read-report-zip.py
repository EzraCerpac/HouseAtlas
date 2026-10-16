"""Read one availability record or one base/head pair, without extracting files."""
import io
import json
import stat
import sys
import zipfile

try:
    archive = sys.stdin.buffer.read(262145)
    if len(archive) > 262144:
        raise ValueError()
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        entries = source.infolist()
        names = {entry.filename for entry in entries}
        if (len(entries) != len(names) or names not in
                ({"availability.json"}, {"base.json", "head.json"})):
            raise ValueError()
        limit = 4096 if names == {"availability.json"} else 1048576
        records = {}
        for entry in entries:
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if (entry.orig_filename != entry.filename or entry.is_dir()
                    or mode not in (0, stat.S_IFREG) or entry.flag_bits & 1
                    or entry.file_size > limit or entry.compress_size > 262144
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                raise ValueError()
            with source.open(entry) as member:
                payload = member.read(limit + 1)
            if len(payload) != entry.file_size or len(payload) > limit:
                raise ValueError()
            records[entry.filename] = payload.decode('utf-8')
        sys.stdout.write(json.dumps(records))
except Exception:
    sys.stderr.write("Invalid availability archive\n")
    sys.exit(1)
