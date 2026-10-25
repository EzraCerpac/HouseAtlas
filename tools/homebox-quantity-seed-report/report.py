"""Bounded documentary quantity reconciliation. No transport or authority objects."""

from collections import Counter
from datetime import date
import hashlib
import json
import re
import uuid


MAX_INPUT = 8 * 1024 * 1024
MAX_ORIGINAL = 64 * 1024
MAX_REPORT = 256 * 1024
MAX_ROWS = 100
MAX_DEPTH = 32
MAX_QUANTITY = 9_007_199_254_740_991
CONTRACT = "0.3.0-at34.stock.2"
PROFILE = {
    "owner": "homebox", "resourceKind": "entity",
    "dialect": "homebox-stock-v0.26.2", "providerVersion": "v0.26.2",
}
OPERATION = "homebox.entity.quantity.set"
# Closed documentary property names from the pinned native Swagger. This is
# not a complete EntityOut validator or qualification of a native response.
# Expanded ent edge graphs are outside this report's bounded observation form.
NATIVE_KEYS = {
    "entity": "archived assetId attachments children createdAt description entityType fields id imageId insured itemCount lifetimeWarranty manufacturer modelNumber name notes parent purchaseDate purchaseFrom purchasePrice quantity serialNumber soldDate soldNotes soldPrice soldTo syncChildEntityLocations tags thumbnailId totalPrice updatedAt warrantyDetails warrantyExpires",
    "summary": "archived assetId createdAt description entityType id imageId insured itemCount name parent purchasePrice quantity soldDate tags thumbnailId updatedAt",
    "type": "createdAt defaultTemplate defaultTemplateId description icon id isLocation name updatedAt",
    "template": "createdAt description id name updatedAt",
    "field": "booleanValue id name numberValue textValue type",
    "tag": "color createdAt description icon id name parentId updatedAt",
    "attachment": "createdAt id mimeType path primary thumbnail title type updatedAt",
    "thumbnail": "created_at edges id mime_type path primary title type updated_at",
    "edges": "",
}
NATIVE_LINKS = {
    "entity": {"attachments": ("attachment", True), "children": ("summary", True),
               "fields": ("field", True), "tags": ("tag", True),
               "parent": ("summary", False), "entityType": ("type", False)},
    "summary": {"parent": ("summary", False), "entityType": ("type", False),
                "tags": ("tag", True)},
    "type": {"defaultTemplate": ("template", False)},
    "attachment": {"thumbnail": ("thumbnail", False)},
    "thumbnail": {"edges": ("edges", False)},
}
STAMP = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]"
    r"([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?"
    r"(?:[Zz]|([+-])([0-9]{2}):([0-9]{2}))\Z"
)


class InputError(ValueError):
    """Fixed diagnostic code; never include caller data in an error."""


class NumberToken(str):
    """JSON number spelling, retained without int/float decoding."""


def _fail(code):
    raise InputError(code)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("duplicate-property")
        result[key] = value
    return result


def _constant(_value):
    _fail("non-finite-number")


def _depth(text):
    depth = 0
    quoted = escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > MAX_DEPTH:
                _fail("nesting-limit")
        elif char in "]}":
            depth -= 1


def _strings(value, path=()):
    if isinstance(value, NumberToken):
        if len(value) > 4096:
            _fail("number-token-limit")
    elif type(value) is str:
        try:
            size = len(value.encode("utf-8"))
        except UnicodeError:
            _fail("invalid-unicode")
        if path and path[-1] in ("updatedAt", "observedAt", "createdAt", "updated_at", "created_at"):
            if not value.isascii() or len(value) > 64:
                _fail("invalid-timestamp")
        original = (len(path) == 3 and path[0] == "observations"
                    and type(path[1]) is int and path[2] == "originalJsonUtf8")
        if original:
            if size > MAX_ORIGINAL:
                _fail("original-json-limit")
        elif len(value) > 4096:
            _fail("string-limit")
    elif isinstance(value, dict):
        for key, child in value.items():
            _strings(key)
            _strings(child, (*path, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _strings(child, (*path, index))


def _load(text, *, original=False):
    _depth(text)
    try:
        value = json.loads(text, object_pairs_hook=_pairs, parse_int=NumberToken,
                           parse_float=NumberToken, parse_constant=_constant)
    except (json.JSONDecodeError, RecursionError):
        _fail("malformed-json")
    # Original JSON has no envelope-specific large-string exemption.
    _strings(value, ("original",) if original else ())
    return value


def _closed(value, fields):
    if type(value) is not dict or set(value) != set(fields.split()):
        _fail("invalid-object-shape")


def _text(value):
    if type(value) is not str:
        _fail("string-required")
    return value


def _uuid(value):
    if type(value) is not str:
        return False
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return False
    return parsed.int != 0 and str(parsed) == value


def _context(value):
    _closed(value, "workspaceId homeId")
    if not all(_uuid(item) for item in value.values()):
        _fail("invalid-context")


def _partition(value):
    _closed(value, "sourceInstanceId collectionId")
    if not _uuid(value["sourceInstanceId"]):
        _fail("invalid-source-instance")
    if not 1 <= len(_text(value["collectionId"])) <= 4096:
        _fail("invalid-collection-text")


def _profile(value):
    _closed(value, "owner resourceKind dialect providerVersion")
    for item in value.values():
        _text(item)


def _timestamp(value):
    value = _text(value)
    match = STAMP.fullmatch(value) if value.isascii() and len(value) <= 64 else None
    if match is None:
        _fail("invalid-timestamp")
    year, month, day, hour, minute, second, _sign, offhour, offminute = match.groups()
    try:
        date(int(year), int(month), int(day))
    except ValueError:
        _fail("invalid-timestamp")
    # RFC3339 leap seconds are retained lexically, never converted to datetime.
    if (int(hour) > 23 or int(minute) > 59 or int(second) > 60
            or (offhour is not None and (int(offhour) > 23 or int(offminute) > 59))):
        _fail("invalid-timestamp")


def _quantity(value):
    # bool, JSON strings, -0, decimals and exponents never enter integer decoding.
    if (type(value) is not NumberToken or len(value) > 16
            or re.fullmatch(r"0|[1-9][0-9]*", value) is None):
        return None
    integer = int(value)
    return integer if integer <= MAX_QUANTITY else None


def _native_shape(value, kind="entity"):
    if type(value) is not dict or not set(value) <= set(NATIVE_KEYS[kind].split()):
        _fail("unknown-native-property-or-shape")
    for key, child in value.items():
        link = NATIVE_LINKS.get(kind, {}).get(key)
        if child is None:
            continue
        if key in ("updatedAt", "createdAt", "updated_at", "created_at"):
            _timestamp(child)
        if link is not None:
            child_kind, many = link
            if many:
                if type(child) is not list:
                    _fail("invalid-native-array")
                for item in child:
                    _native_shape(item, child_kind)
            else:
                _native_shape(child, child_kind)
        elif isinstance(child, (dict, list)):
            _fail("invalid-native-scalar")


def _validate(data):
    _closed(data, "format contractVersion context partition sourceProfile observationSource rows observations")
    if data["format"] != "houseatlas-homebox-quantity-seed-input/1":
        _fail("unsupported-input-format")
    _text(data["contractVersion"])
    _context(data["context"])
    _partition(data["partition"])
    _profile(data["sourceProfile"])
    source = data["observationSource"]
    _closed(source, "context partition sourceProfile")
    _context(source["context"])
    _partition(source["partition"])
    _profile(source["sourceProfile"])
    for field in ["rows", "observations"]:
        if type(data[field]) is not list or len(data[field]) > MAX_ROWS:
            _fail("array-limit-or-type")
    seen = set()
    for row in data["rows"]:
        _closed(row, "rowId resourceId expected desired")
        row_id = _text(row["rowId"])
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", row_id) is None:
            _fail("invalid-row-id")
        if row_id in seen:
            _fail("duplicate-row-id")
        seen.add(row_id)
        _text(row["resourceId"])
        _closed(row["expected"], "updatedAt quantity")
        _timestamp(row["expected"]["updatedAt"])
        _closed(row["desired"], "quantity")
    originals = []
    for observation in data["observations"]:
        _closed(observation, "resourceId originalJsonUtf8 observedAt")
        _text(observation["resourceId"])
        _timestamp(observation["observedAt"])
        raw = _text(observation["originalJsonUtf8"])
        native = _load(raw, original=True)
        _native_shape(native)
        originals.append(native)
    return originals


def _json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False,
                       separators=(",", ":")) + "\n").encode("ascii")


def build_report(input_bytes):
    """Return a complete bounded report as bytes, or raise InputError.

    The caller retains input_bytes unchanged beside this report. Hashes correlate
    documentary data only; they are neither identity matches nor authority.
    """
    if type(input_bytes) is not bytes or len(input_bytes) > MAX_INPUT:
        _fail("input-byte-limit-or-type")
    try:
        text = input_bytes.decode("utf-8", errors="strict")
    except UnicodeError:
        _fail("invalid-utf8")
    data = _load(text)
    originals = _validate(data)
    source = data["observationSource"]
    declaration = {key: data[key] for key in ["context", "partition", "sourceProfile"]}
    global_reasons = []
    if source != declaration:
        global_reasons.append("observation-source-mismatch")
    if (data["sourceProfile"] != PROFILE or source["sourceProfile"] != PROFILE
            or data["contractVersion"] != CONTRACT):
        global_reasons.append("unsupported-source-profile")
    counts = Counter(row["resourceId"] for row in data["rows"])
    results = []
    for row in data["rows"]:
        # The observation batch declaration participates in matching: an ID in a
        # different batch scope cannot become a same-scope candidate.
        indexes = [i for i, obs in enumerate(data["observations"])
                   if source == declaration and obs["resourceId"] == row["resourceId"]]
        target = {"context": data["context"], "authority": "homebox",
                  **data["partition"], "resourceKind": "entity", "resourceId": row["resourceId"]}
        result = {"rowId": row["rowId"], "target": target, "outcome": "blocked",
                  "reasons": list(global_reasons), "observationIndexes": indexes, "proposal": None}
        reasons = result["reasons"]
        if not _uuid(data["partition"]["collectionId"]) or not _uuid(row["resourceId"]):
            reasons.append("unsupported-target")
        if counts[row["resourceId"]] > 1:
            reasons.append("duplicate-manifest-target")
        if len(indexes) > 1:
            reasons.append("ambiguous-observation")
        elif not indexes and not global_reasons:
            reasons.append("missing-observation")
        expected = _quantity(row["expected"]["quantity"])
        desired = _quantity(row["desired"]["quantity"])
        if expected is None or desired is None:
            reasons.append("unsupported-quantity")
        if len(indexes) == 1:
            native = originals[indexes[0]]
            if not _uuid(native.get("id")) or native.get("id") != row["resourceId"]:
                reasons.append("observation-identity-mismatch")
            try:
                _timestamp(native.get("updatedAt"))
            except InputError:
                reasons.append("unsupported-observation-timestamp")
            quantity = _quantity(native.get("quantity"))
            if quantity is None:
                reasons.append("unsupported-observation-quantity")
            if not reasons:
                if (native["updatedAt"] != row["expected"]["updatedAt"] or quantity != expected):
                    reasons.append("baseline-conflict")
                elif quantity == desired:
                    result["outcome"] = "unchanged"
                else:
                    result["outcome"] = "proposed-update"
                    result["proposal"] = {"operation": OPERATION, "target": target,
                                          "desired": {"quantity": desired}}
        results.append(result)
    report = {"format": "houseatlas-homebox-quantity-seed-report/1",
              "inputDigest": hashlib.sha256(input_bytes).hexdigest(),
              "execution": "report-only", "rows": results}
    report["reportDigest"] = hashlib.sha256(_json_bytes(report)).hexdigest()
    encoded = _json_bytes(report)
    if len(encoded) > MAX_REPORT:
        _fail("report-byte-limit")
    return encoded
