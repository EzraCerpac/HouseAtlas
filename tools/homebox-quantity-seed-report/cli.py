"""Read one supplied document, emit one complete documentary report to stdout."""

import argparse
from pathlib import Path
import sys

from report import InputError, MAX_INPUT, build_report


class FixedArgumentParser(argparse.ArgumentParser):
    def error(self, _message):
        # argparse's default diagnostics echo rejected arguments. Keep caller
        # text out of the same fixed-error channel used for document failures.
        raise InputError("invalid-arguments")


def main():
    parser = FixedArgumentParser(description=__doc__)
    parser.add_argument("input", help="supplied input file, or - for stdin; retain its exact bytes")
    try:
        args = parser.parse_args()
        if args.input == "-":
            original = sys.stdin.buffer.read(MAX_INPUT + 1)
        else:
            with Path(args.input).open("rb") as stream:
                original = stream.read(MAX_INPUT + 1)
        encoded = build_report(original)
    except InputError as error:
        print(f"quantity-seed-report: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("quantity-seed-report: input-read-failed", file=sys.stderr)
        return 2
    # Validation and the output bound complete before the first output byte.
    sys.stdout.buffer.write(encoded)
    return 0


if __name__ == "__main__":
    sys.exit(main())
