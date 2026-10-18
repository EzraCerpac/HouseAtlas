"""Read the admitted thin Mach-O header; never execute a staged binary."""

import struct
from pathlib import Path

from .validation import os_version, require


def verify_macho(path: Path, target: str, declared_minimum_os: str) -> None:
    with path.open("rb") as source:
        header = source.read(32)
        require(len(header) == 32, "platform-incompatible")
        magic, cpu, subtype, filetype, count, size, _flags, _reserved = struct.unpack("<8I", header)
        require(magic == 0xFEEDFACF and filetype == 2 and
                cpu == {"x86_64-apple-darwin": 0x01000007,
                        "aarch64-apple-darwin": 0x0100000C}[target] and
                subtype == {"x86_64-apple-darwin": 3, "aarch64-apple-darwin": 0}[target] and
                0 < count <= 1024 and 0 < size <= 64 * 1024, "platform-incompatible")
        commands = source.read(size)
        require(len(commands) == size, "platform-incompatible")
    offset = 0
    minimums = []
    for _ in range(count):
        require(offset + 8 <= size, "platform-incompatible")
        command, length = struct.unpack_from("<II", commands, offset)
        require(length >= 8 and length % 4 == 0 and offset + length <= size,
                "platform-incompatible")
        if command == 0x32:  # LC_BUILD_VERSION
            require(length >= 24, "platform-incompatible")
            platform, minimum, _sdk, tools = struct.unpack_from("<4I", commands, offset + 8)
            require(platform == 1 and length == 24 + tools * 8, "platform-incompatible")
            minimums.append(minimum)
        elif command == 0x24:  # LC_VERSION_MIN_MACOSX
            require(length == 16, "platform-incompatible")
            minimums.append(struct.unpack_from("<I", commands, offset + 8)[0])
        offset += length
    require(offset == size and len(minimums) == 1, "platform-incompatible")
    value = minimums[0]
    actual = (value >> 16, (value >> 8) & 255, value & 255)
    require(actual <= os_version(declared_minimum_os), "platform-incompatible")
