"""One bounded JSON request on stdin, one sanitized result on stdout.

An owner-bound entrypoint calls run(controller, stdin.buffer, stdout). There is
no import-by-name, executable, shell, URL, runtime path or environment plugin
selection. Running this file directly installs no ports and reports unavailable.
"""

import json

from .journal import CODES
from .model import UpdateError
from .validation import json_object, operation_id, require


def run(controller, source, output) -> int:
    try:
        require(controller is not None, "boundary-failed")
        raw = source.read(4097)
        packet = json_object(raw, 4096)
        if packet.get("format") == "houseatlas.updater.status-request.v1":
            require(set(packet) == {"format", "operationId"}, "invalid-request")
            if packet["operationId"] is not None:
                operation_id(packet["operationId"])
            result = controller.status(packet["operationId"])
        else:
            result = controller.execute(raw)
        response = {"format": "houseatlas.updater.result.v1", "ok": True,
                    "code": "none", "status": result}
        exit_code = 0
    except Exception as error:
        code = error.code if isinstance(error, UpdateError) and error.code in CODES else "boundary-failed"
        response = {"format": "houseatlas.updater.result.v1", "ok": False,
                    "code": code, "status": None}
        exit_code = 1
    output.write(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")
    return exit_code


if __name__ == "__main__":
    import sys
    raise SystemExit(run(None, sys.stdin.buffer, sys.stdout))
