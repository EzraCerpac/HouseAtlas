"""Optional fixed MCP maintenance catalog/call adapter; no installed endpoint.

The bridge owner must explicitly inject this object and a separate trusted NAS
maintenance authorizer. Native Editor/write grants supply no authority here.
"""

from types import MappingProxyType

from houseatlas_updater.journal import CODES
from houseatlas_updater.model import UpdateError
from houseatlas_updater.validation import json_object, require
from maintenance_dispatch import COMMAND_FORMATS, dispatch


TOOL_COMMANDS = MappingProxyType({
    "houseatlas_update_check": "check",
    "houseatlas_update_apply": "apply",
    "houseatlas_update_status": "status",
})
_DESCRIPTIONS = MappingProxyType({
    "check": "Validate and stage one exact release using the owner-bound updater. Requires separate NAS maintenance authorization; a check does not activate code.",
    "apply": "Apply one exact release using the owner-bound updater. Requires separate NAS maintenance authorization and action-time approval. Inspect status phase and health; ok alone is not deployment success.",
    "status": "Read an updater operation status using separate NAS maintenance authorization. Historical status is not a fresh target observation or apply approval.",
})


class MaintenanceOwner:
    def __init__(self, controller, *, authorize):
        """authorize(command, exact_raw_request) must return literal True.

        The trusted callback binds separate maintenance policy, target and current
        action-time approval. It must not infer permission from native Editor or
        Atlas write grants. There is no default, cached grant or caller override.
        This object does not qualify that external policy implementation.
        """
        require(controller is not None and callable(authorize), "boundary-failed")
        self._controller, self._authorize = controller, authorize

    def catalog(self) -> list[dict]:
        """Fresh definitions; advertise only when the owner explicitly installs us."""
        return [{
            "name": name,
            "description": _DESCRIPTIONS[command],
            "inputSchema": {
                "type": "object", "additionalProperties": False,
                "properties": {"requestJson": {"type": "string", "maxLength": 4096,
                                                "description": "One exact updater protocol JSON request, at most 4096 UTF-8 bytes."}},
                "required": ["requestJson"],
            },
            "annotations": {"readOnlyHint": command == "status",
                            "destructiveHint": command == "apply",
                            "idempotentHint": False, "openWorldHint": False},
        } for name, command in TOOL_COMMANDS.items()]

    def call(self, name: str, arguments: dict) -> dict:
        """Authorize one bounded exact request, then invoke the existing dispatcher.

        Return the updater result unchanged. The bridge supplies the MCP envelope;
        ok=true only means handled, including rejected/recovery-needed statuses.
        No callback/controller exception text can cross this result boundary.
        """
        try:
            require(type(name) is str and name in TOOL_COMMANDS and type(arguments) is dict and
                    set(arguments) == {"requestJson"}, "invalid-request")
            text = arguments["requestJson"]
            require(type(text) is str and len(text) <= 4096, "invalid-request")
            try:
                raw = text.encode("utf-8")
            except UnicodeError:
                raise UpdateError("invalid-request") from None
            packet = json_object(raw, 4096)
            command = TOOL_COMMANDS[name]
            require(packet.get("format") == COMMAND_FORMATS[command], "invalid-request")
            try:
                authorized = self._authorize(command, raw)
            except Exception:
                raise UpdateError("boundary-failed") from None
            require(authorized is True, "boundary-failed")
            return dispatch(self._controller, command, raw)
        except Exception as error:
            code = error.code if isinstance(error, UpdateError) and error.code in CODES else "boundary-failed"
            return {"format": "houseatlas.updater.result.v1", "ok": False,
                    "code": code, "status": None}
