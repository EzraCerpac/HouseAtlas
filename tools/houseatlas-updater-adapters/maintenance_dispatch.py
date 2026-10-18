"""Pure fixed-command adapter around the existing controller-bound CLI.

The authenticated owner bridge supplies its one already-bound Controller. This
module installs no endpoint, authorizer, process, path/URL selection or updater.
"""

import io
import json
from types import MappingProxyType

from houseatlas_updater.cli import run
from houseatlas_updater.journal import CODES
from houseatlas_updater.model import UpdateError
from houseatlas_updater.validation import json_object, require


COMMAND_FORMATS = MappingProxyType({
    "check": "houseatlas.updater.check.v1",
    "apply": "houseatlas.updater.apply.v1",
    "status": "houseatlas.updater.status-request.v1",
})


def dispatch(controller, command: str, raw_request: bytes) -> dict:
    """Handle exactly one <=4096-byte protocol request and return CLI result.

    Authentication, target binding and apply approval remain the bridge owner's
    responsibility. A handled result's ok=true is not activation/health success.
    Inspect status.phase/code/healthVerified/recoveryNeeded as in cli.run.
    """
    try:
        require(type(command) is str and command in COMMAND_FORMATS, "invalid-request")
        packet = json_object(raw_request, 4096)
        require(packet.get("format") == COMMAND_FORMATS[command], "invalid-request")
        output = io.StringIO()
        run(controller, io.BytesIO(raw_request), output)
        return json.loads(output.getvalue())
    except Exception as error:
        code = error.code if isinstance(error, UpdateError) and error.code in CODES else "boundary-failed"
        return {"format": "houseatlas.updater.result.v1", "ok": False,
                "code": code, "status": None}
