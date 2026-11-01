"""Versioned, documentary publication-input claims. Pure functions; no I/O.

Successful validation establishes shape only. No function verifies authority,
filesystem presence, custody, persistence, recovery or consumer behavior.
"""

from datetime import datetime, timezone
import hashlib
import json
import re

MAX_BYTES = 256 * 1024
MAX_EVENTS = 256
MAX_PAYLOADS = 128
MAX_COUNT = 9_007_199_254_740_991
TOKEN = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
STAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\Z")
STATES = {
    "disposition": {"present", "removed"},
    "recovery": {"recoverable", "unavailable"},
    "qualification": {"qualified", "unqualified"},
    "selection": {"selected", "unselected"},
}
PHASES = {"intent", "complete", "failed", "interrupted", "unknown"}


class InputError(ValueError):
    """Fixed diagnostics deliberately exclude caller-supplied content."""


def _require(condition, code):
    if not condition:
        raise InputError(code)


def _keys(value, keys):
    _require(type(value) is dict and set(value) == set(keys.split()), "fields")


def _token(value):
    _require(type(value) is str and TOKEN.fullmatch(value), "token")


def _hash(value):
    _require(type(value) is str and HASH.fullmatch(value), "sha256")


def _stamp(value):
    _require(type(value) is str and STAMP.fullmatch(value), "timestamp")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise InputError("timestamp") from None


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def identity(value):
    """Content identity for a validated manifest+payload identity, not its label."""
    _source(value)
    return hashlib.sha256(_canonical(value).encode("ascii")).hexdigest()


def _blob(value):
    _keys(value, "sha256 bytes")
    _hash(value["sha256"])
    _require(type(value["bytes"]) is int and 0 <= value["bytes"] <= MAX_COUNT, "count")


def _source(value):
    _keys(value, "manifest payloads")
    _blob(value["manifest"])
    payloads = value["payloads"]
    _require(type(payloads) is list and 1 <= len(payloads) <= MAX_PAYLOADS, "payload-limit")
    names = set()
    for payload in payloads:
        _keys(payload, "name sha256 bytes")
        _token(payload["name"])
        _require(payload["name"] not in names, "ambiguous-payload")
        names.add(payload["name"])
        _blob({key: payload[key] for key in ("sha256", "bytes")})
    # One canonical ordering prevents equivalent lists acquiring different identities.
    _require([p["name"] for p in payloads] == sorted(names), "payload-order")


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate-key")
        result[key] = value
    return result


def _constant(_value):
    raise InputError("number")


def parse(raw):
    """Accept bounded UTF-8 JSON bytes only; reject duplicates before decoding."""
    _require(type(raw) is bytes and len(raw) <= MAX_BYTES, "input-limit")
    try:
        text = raw.decode("utf-8")
        # Bound nesting before the recursive JSON decoder; braces in strings do
        # not contribute. The contract's deepest valid object is below this limit.
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
                _require(depth <= 12, "nesting-limit")
            elif char in "]}":
                depth -= 1
        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        if isinstance(error, InputError):
            raise
        raise InputError("json") from None
    return validate(value)


def validate(value):
    """Return a detached validated snapshot; callers retain their own history."""
    # All public object entry points use the same byte and duplicate/type rules.
    try:
        encoded = _canonical(value).encode("ascii")
    except (TypeError, ValueError, RecursionError):
        raise InputError("json") from None
    _require(len(encoded) <= MAX_BYTES, "input-limit")
    _keys(value, "version profile label original release events")
    _require(type(value["version"]) is int and value["version"] == 1, "version")
    _require(value["profile"] == "publication-input-claims-v1", "profile")
    _token(value["label"])
    original = identity(value["original"])
    release = value["release"]
    if release is not None:
        _source(release)
    events = value["events"]
    _require(type(events) is list and len(events) <= MAX_EVENTS, "event-limit")
    seen = {}
    for event in events:
        _keys(event, "id operation original kind state phase recorded expires persistence evidence")
        for key in ("id", "operation"):
            _token(event[key])
        _hash(event["original"])
        _require(event["original"] == original, "original-binding")
        kind = event["kind"]
        _require(type(kind) is str and kind in STATES, "kind")
        _require(type(event["state"]) is str and event["state"] in STATES[kind], "state")
        _require(type(event["phase"]) is str and event["phase"] in PHASES, "phase")
        recorded, expires = _stamp(event["recorded"]), _stamp(event["expires"])
        _require(recorded < expires, "time-order")
        _require(type(event["persistence"]) is str and event["persistence"] in
                 {"unknown", "failed", "stored-readback"}, "persistence")
        evidence = event["evidence"]
        _require(type(evidence) is list and len(evidence) <= 8, "evidence-limit")
        refs = {}
        for ref in evidence:
            _keys(ref, "id sha256 binding role")
            _token(ref["id"])
            _hash(ref["sha256"])
            _hash(ref["binding"])
            _require(type(ref["role"]) is str and ref["role"] in
                     {"outcome", "persistence", "readback"}, "evidence-role")
            expected = original if kind in {"disposition", "recovery"} else (
                identity(release) if release is not None else None)
            _require(ref["binding"] == expected, "evidence-binding")
            _require(ref["id"] not in refs or refs[ref["id"]] == ref, "conflicting-reference")
            refs[ref["id"]] = ref
        _require(event["id"] not in seen or seen[event["id"]] == event, "conflicting-event")
        seen[event["id"]] = event
    # A reference label must never be rebound, even across events.
    refs = {}
    for event in events:
        for ref in event["evidence"]:
            _require(ref["id"] not in refs or refs[ref["id"]] == ref, "conflicting-reference")
            refs[ref["id"]] = ref
    return json.loads(encoded)


def classify(documents, *, as_of):
    """Reconcile claims without choosing a winner, verifying or writing anything.

    Multiple snapshots preserve history. Same label/different original and
    operation rebinding are rejected; identical repeated events are idempotent.
    """
    now = _stamp(as_of)
    _require(type(documents) is list and 1 <= len(documents) <= 32, "document-limit")
    docs = [validate(document) for document in documents]
    _require(sum(len(_canonical(doc)) for doc in docs) <= MAX_BYTES, "input-limit")
    labels, originals, events, operations = {}, set(), {}, {}
    for doc in docs:
        source = identity(doc["original"])
        _require(doc["label"] not in labels or labels[doc["label"]] == source, "label-conflict")
        labels[doc["label"]] = source
        originals.add(source)
        release = identity(doc["release"]) if doc["release"] is not None else None
        for event in doc["events"]:
            key = event["id"]
            bound = (event, release if event["kind"] in {"qualification", "selection"} else None)
            _require(key not in events or events[key] == bound, "conflicting-event")
            events[key] = bound
            op_binding = (source, event["kind"], bound[1])
            _require(event["operation"] not in operations or
                     operations[event["operation"]] == op_binding, "operation-binding")
            operations[event["operation"]] = op_binding
    _require(len(originals) == 1, "ambiguous-original")
    _require(len(events) <= MAX_EVENTS, "event-limit")
    # Cross-snapshot reference conflicts must not escape per-document validation.
    refs = {}
    for event, _release in events.values():
        for ref in event["evidence"]:
            _require(ref["id"] not in refs or refs[ref["id"]] == ref, "conflicting-reference")
            refs[ref["id"]] = ref
    result = {"original": next(iter(originals)), "authority": "unverified",
              "original_identity": docs[0]["original"],
              "release_identities": {identity(doc["release"]): doc["release"]
                                     for doc in docs if doc["release"] is not None},
              "event_ids": sorted(events),
              "event_claims": [{"event": events[key][0], "release": events[key][1]}
                               for key in sorted(events)], "dimensions": {}}
    for kind in STATES:
        claims = [(event, release) for event, release in events.values() if event["kind"] == kind]
        states = {(event["state"], release) for event, release in claims}
        reasons = set()
        if len(states) > 1:
            reasons.add("conflicting-claims")
        completions = {}
        intents = []
        for event, _release in claims:
            if not (_stamp(event["recorded"]) <= now < _stamp(event["expires"])):
                reasons.add("outside-evidence-window")
            if event["phase"] in {"failed", "interrupted", "unknown"}:
                reasons.add(event["phase"])
            if event["persistence"] == "failed":
                reasons.add("persistence-failed")
            if event["phase"] == "intent":
                intents.append(event)
            if event["phase"] == "complete":
                roles = {ref["role"] for ref in event["evidence"]}
                if event["persistence"] != "stored-readback":
                    reasons.add("persistence-unconfirmed")
                if roles != {"outcome", "persistence", "readback"}:
                    reasons.add("missing-evidence")
                if (event["persistence"] == "stored-readback"
                        and roles == {"outcome", "persistence", "readback"}
                        and _stamp(event["recorded"]) <= now < _stamp(event["expires"])):
                    completions.setdefault(event["operation"], []).append(_stamp(event["recorded"]))
        if not completions:
            reasons.add("no-completion-evidence")
        # Completion is correlated to the operation and must follow each intent.
        # Equal timestamps cannot establish order at this contract's resolution.
        for intent in intents:
            if not any(stamp > _stamp(intent["recorded"])
                       for stamp in completions.get(intent["operation"], [])):
                reasons.add("unresolved-intent")
        result["dimensions"][kind] = {
            "status": "unknown" if reasons else "claimed-complete",
            "claims": [{"state": state, "release": release} for state, release in
                       sorted(states, key=lambda item: (item[0], item[1] or ""))],
            "reasons": sorted(reasons),
        }
    return result


def format_evidence(documents, *, as_of):
    """Deterministic evidence-only JSON; never emits an operational receipt."""
    return _canonical(classify(documents, as_of=as_of)) + "\n"
