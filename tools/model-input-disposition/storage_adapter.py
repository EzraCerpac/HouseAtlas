"""Prospective storage protocol v2. No built-in transport, clock, lock or effect.

All trust is scoped to injected owner ports. Nothing upgrades disposition v1's
unverified authority. This module is not an installer or an operational caller.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Protocol

import disposition as v1

PROFILE = "publication-input-storage-v2"
EVIDENCE_PROFILE = "publication-input-storage-evidence-v2"
PROPOSED_INTENT_NS = 300 * 1_000_000_000
PROPOSED_OBSERVATION_NS = 3600 * 1_000_000_000
MAX_BYTES = 256 * 1024
MAX_LEDGER_BYTES = 4 * MAX_BYTES
MAX_RECORDS = 256
MAX_PORT_CALLS = 1024
MAX_BODY = 64 * 1024 * 1024
NS = 1_000_000_000
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
STAMP = re.compile(r"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{9})Z\Z")
PHASES = {"intent", "dispatch", "complete", "failed", "interrupted", "unknown", "observation", "reconcile"}


class AdapterError(ValueError):
    """Fixed diagnostics exclude private bytes, paths and injected exceptions."""


def need(ok, code):
    if not ok:
        raise AdapterError(code)


def token(value):
    need(type(value) is str and v1.TOKEN.fullmatch(value), "token")


def digest(value):
    need(type(value) is str and v1.HASH.fullmatch(value), "hash")


def keys(value, fields):
    need(type(value) is dict and set(value) == set(fields.split()), "fields")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def sha(raw):
    need(type(raw) is bytes, "bytes")
    return hashlib.sha256(raw).hexdigest()


def parse_ns(value):
    need(type(value) is str, "precision")
    match = STAMP.fullmatch(value)
    need(match is not None, "precision")
    try:
        stamp = datetime.strptime(match[1], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        delta = stamp - EPOCH
        result = (delta.days * 86400 + delta.seconds) * NS + int(match[2])
    except ValueError:
        raise AdapterError("timestamp") from None
    need(result >= 0, "timestamp")
    return result


def format_ns(value):
    need(type(value) is int and value >= 0, "clock")
    seconds, fraction = divmod(value, NS)
    try:
        stamp = EPOCH + timedelta(seconds=seconds)
    except OverflowError:
        raise AdapterError("clock") from None
    # strftime's year padding is platform-dependent before year 1000.
    return f"{stamp.year:04}-{stamp.month:02}-{stamp.day:02}T{stamp.hour:02}:{stamp.minute:02}:{stamp.second:02}.{fraction:09}Z"


def _pairs(pairs):
    result = {}
    for name, value in pairs:
        need(name not in result, "duplicate-key")
        result[name] = value
    return result


def decode(raw):
    need(type(raw) is bytes and len(raw) <= MAX_BYTES, "input-limit")
    try:
        text = raw.decode("utf-8")
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
                need(depth <= 12, "depth")
            elif char in "]}":
                depth -= 1
        return json.loads(text, object_pairs_hook=_pairs,
                          parse_constant=lambda _: need(False, "number"))
    except (UnicodeError, ValueError, RecursionError) as error:
        if isinstance(error, AdapterError):
            raise
        raise AdapterError("json") from None


@dataclass(frozen=True)
class ClockSample:
    wall_ns: int
    monotonic_ns: int
    source: str


@dataclass(frozen=True)
class Horizons:
    """Caller must explicitly select values; proposals are not operational policy."""
    intent_ns: int
    observation_ns: int

    def __post_init__(self):
        for value in (self.intent_ns, self.observation_ns):
            need(type(value) is int and 0 < value <= 86400 * NS, "horizon")


@dataclass(frozen=True)
class PinnedSource:
    """Immutable original bytes; opaque names are reviewed registry tokens."""
    manifest: bytes
    payloads: tuple

    def identity_object(self):
        need(type(self.manifest) is bytes and 0 < len(self.manifest) <= MAX_BODY, "manifest")
        need(type(self.payloads) is tuple and 1 <= len(self.payloads) <= 128, "payloads")
        need(sum(len(pair[1]) for pair in self.payloads
                 if type(pair) is tuple and len(pair) == 2 and type(pair[1]) is bytes) + len(self.manifest) <= MAX_BODY,
             "source-limit")
        rows = []
        for pair in self.payloads:
            need(type(pair) is tuple and len(pair) == 2, "payload")
            name, raw = pair
            token(name)
            need(type(raw) is bytes and len(raw) <= MAX_BODY, "payload")
            rows.append({"name": name, "sha256": sha(raw), "bytes": len(raw)})
        source = {"manifest": {"sha256": sha(self.manifest), "bytes": len(self.manifest)}, "payloads": rows}
        # The original manifest bytes are hashed unchanged, never reserialized.
        v1.identity(source)
        return source


@dataclass(frozen=True)
class StreamLimits:
    """Explicit reviewed resource admission; no operational defaults."""
    max_payload_bytes: int
    max_source_bytes: int
    chunk_bytes: int
    max_chunks: int

    def __post_init__(self):
        for value, ceiling in ((self.max_payload_bytes, 64 * 1024**3),
                               (self.max_source_bytes, 128 * 1024**3),
                               (self.chunk_bytes, 1024**2), (self.max_chunks, 1024**2)):
            need(type(value) is int and 0 < value <= ceiling, "stream-admission")
        need(self.max_payload_bytes <= self.max_source_bytes, "stream-admission")


@dataclass(frozen=True)
class StreamPayload:
    name: str
    handle: str
    bytes: int
    sha256: str
    state_sha256: str


@dataclass(frozen=True)
class StreamingSource:
    manifest: bytes
    payloads: tuple

    def identity_object(self):
        """Declared projection only. Adapter verifies every actual streamed byte."""
        need(type(self.manifest) is bytes and 0 < len(self.manifest) <= MAX_BYTES, "manifest")
        need(type(self.payloads) is tuple and 1 <= len(self.payloads) <= 128, "payloads")
        rows = []
        handles = set()
        for pin in self.payloads:
            need(type(pin) is StreamPayload, "stream-pin")
            token(pin.name)
            token(pin.handle)
            digest(pin.sha256)
            digest(pin.state_sha256)
            need(type(pin.bytes) is int and 0 <= pin.bytes <= v1.MAX_COUNT, "count")
            need(pin.handle not in handles, "stream-alias")
            handles.add(pin.handle)
            rows.append(dict(name=pin.name, sha256=pin.sha256, bytes=pin.bytes))
        source = dict(manifest=dict(sha256=sha(self.manifest), bytes=len(self.manifest)), payloads=rows)
        v1.identity(source)
        return source


@dataclass(frozen=True)
class StreamState:
    sha256: str
    route: str
    durable: bool
    independent: bool


class StreamReader(Protocol):
    state: StreamState
    def read_chunk(self, *, max_bytes: int, budget_ns: int) -> bytes: ...
    def close(self) -> None: ...


@dataclass(frozen=True)
class FrozenExport:
    original: PinnedSource | StreamingSource
    release: PinnedSource | StreamingSource | None
    label: str
    provenance: str
    retained: bool


@dataclass(frozen=True)
class ResolvedReference:
    raw: bytes
    route: str
    durable: bool
    independent: bool


@dataclass(frozen=True)
class LedgerSnapshot:
    records: tuple
    tail: str | None
    complete: bool
    provenance: str


@dataclass(frozen=True)
class WriteAck:
    route: str
    durable: bool


@dataclass(frozen=True)
class Readback:
    raw: bytes
    route: str
    durable: bool
    independent: bool


@dataclass(frozen=True)
class ProcessAdmissionReadback:
    """V3: exact provisional disk bytes plus an uninterrupted owner capability.

    confirmed is sampled AFTER marker fsync and independent readback. It is
    deliberately not embedded in those earlier immutable bytes. The qualified
    owner must bind this capability to the current process epoch and all three
    hashes; disk bytes alone cannot construct it after restart.
    """
    raw: bytes
    route: str
    durable: bool
    independent: bool
    epoch: str
    process_epoch: str
    confirmed: ClockSample
    document_sha256: str
    verification_sha256: str
    admission_sha256: str


@dataclass(frozen=True)
class Fence:
    """Local cooperating-writer sequence; not a distributed exclusion claim."""
    generation: int
    claim: str
    application: str
    selection: str
    policy: str
    independent_actor: bool

    def object(self):
        need(type(self.generation) is int and 0 <= self.generation <= v1.MAX_COUNT, "fence")
        token(self.claim)
        for value in (self.application, self.selection, self.policy):
            digest(value)
        need(type(self.independent_actor) is bool, "fence")
        return dict(generation=self.generation, claim=self.claim,
                    application=self.application, selection=self.selection,
                    policy=self.policy, independent_actor=self.independent_actor)


class Lease(Protocol):
    def snapshot(self) -> Fence: ...
    def close(self) -> None: ...


class OwnerPorts(Protocol):
    """Only the established operational owner implements these trusted ports.

    append is exclusive create + fsync with atomic expected-tail comparison;
    independent_read uses a separate qualified read route. No implementation here.
    """
    def now(self, *, budget_ns: int) -> ClockSample: ...
    def authorize(self, scope: str, operation: str, kind: str, mode: str, *, budget_ns: int) -> bool: ...
    def try_acquire(self, scope: str, operation: str, *, budget_ns: int) -> Lease | None: ...
    def frozen_export(self, scope: str, *, budget_ns: int) -> FrozenExport: ...
    def stream_state(self, scope: str, handle: str, *, budget_ns: int) -> StreamState: ...
    def open_stream(self, scope: str, handle: str, *, expected_state: str,
                    max_bytes: int, max_chunks: int, budget_ns: int) -> StreamReader: ...
    def ledger(self, scope: str, *, max_records: int, max_bytes: int, budget_ns: int) -> LedgerSnapshot: ...
    def resolve(self, scope: str, reference: str, *, max_bytes: int, budget_ns: int) -> list[ResolvedReference]: ...
    def append(self, scope: str, key: str, raw: bytes, expected_tail: str | None, *, budget_ns: int) -> WriteAck: ...
    def independent_read(self, scope: str, key: str, *, max_bytes: int, budget_ns: int) -> Readback: ...
    def append_verification(self, scope: str, key: str, raw: bytes, *, budget_ns: int) -> WriteAck: ...
    def independent_verification_read(self, scope: str, key: str, *, max_bytes: int, budget_ns: int) -> Readback: ...
    def commit_admission(self, scope: str, key: str, proposal: bytes, *, budget_ns: int) -> WriteAck: ...
    def independent_admission_read(self, scope: str, key: str, *, max_bytes: int, budget_ns: int) -> Readback: ...
    def independent_dispatch_boundary(self, scope: str, operation: str, *, max_bytes: int, budget_ns: int) -> Readback: ...
    def dispatch_under_fence(self, scope: str, operation: str, *, fence: dict,
                             intent_deadline_ns: int, elapsed_deadline_ns: int,
                             clock_source: str, registry_sha256: str,
                             dispatch_sha256: str, stream_seals: dict, predecessor_proofs: dict, effect, budget_ns: int): ...


@dataclass(frozen=True)
class OwnerConfig:
    scope: str
    owner: str
    clock_source: str
    registry_provenance: str
    write_route: str
    read_route: str
    reference_routes: tuple
    kinds: tuple
    horizons: Horizons
    callback_budget_ns: int
    stream_limits: StreamLimits | None = None

    def __post_init__(self):
        for value in (self.scope, self.owner, self.clock_source, self.registry_provenance,
                      self.write_route, self.read_route):
            token(value)
        need(self.write_route != self.read_route, "independent-route")
        need(type(self.reference_routes) is tuple and len(self.reference_routes) > 0, "routes")
        for route in self.reference_routes:
            token(route)
        need(type(self.kinds) is tuple and 0 < len(self.kinds) <= 4, "kinds")
        need(all(type(kind) is str and kind in v1.STATES for kind in self.kinds), "kinds")
        need(type(self.horizons) is Horizons, "horizon")
        need(self.stream_limits is None or type(self.stream_limits) is StreamLimits, "stream-admission")
        need(type(self.callback_budget_ns) is int and 0 < self.callback_budget_ns <= 60 * NS, "callback-budget")


def admit_request(raw):
    # Raw v1 admission is mandatory. No generic JSON decoder precedes it.
    document = v1.parse(raw)
    need(document["events"] == [], "historical-request")
    return document


def parse_record(raw):
    record = decode(raw)
    keys(record, "profile id operation request scope owner kind state phase recorded captured expires clock_source monotonic_ns fence registry_sha256 predecessors reconciles evidence mode prerequisite_proofs")
    need(record["profile"] == PROFILE, "profile")
    for name in ("id", "operation", "scope", "owner", "clock_source"):
        token(record[name])
    need(type(record["request"]) is str, "request")
    admit_request(record["request"].encode("utf-8"))
    kind = record["kind"]
    need(type(kind) is str and kind in v1.STATES, "kind")
    need(type(record["state"]) is str and record["state"] in v1.STATES[kind], "state")
    need(type(record["phase"]) is str and record["phase"] in PHASES, "phase")
    need(record["mode"] in ("mutation", "observation"), "mode")
    recorded, captured, expires = (parse_ns(record[name]) for name in ("recorded", "captured", "expires"))
    need(recorded <= captured and recorded < expires, "chronology")
    need(type(record["monotonic_ns"]) is str and re.fullmatch(r"0|[1-9][0-9]{0,18}", record["monotonic_ns"])
         and int(record["monotonic_ns"]) < 2**63, "clock")
    need(record["mode"] == ("observation" if record["phase"] in ("observation", "reconcile") else "mutation"), "mode")
    fence = record["fence"]
    keys(fence, "generation claim application selection policy independent_actor")
    Fence(**fence).object()
    digest(record["registry_sha256"])
    need(type(record["prerequisite_proofs"]) is dict and len(record["prerequisite_proofs"]) <= MAX_RECORDS, "proof-limit")
    for event_id, proof in record["prerequisite_proofs"].items():
        token(event_id)
        keys(proof, "record verification admission")
        for value in proof.values():
            digest(value)
    for name in ("predecessors", "reconciles"):
        values = record[name]
        need(type(values) is list and len(values) <= MAX_RECORDS, "history")
        for value in values:
            digest(value)
        need(values == sorted(set(values)), "history")
    refs = record["evidence"]
    need(type(refs) is list and len(refs) <= 8, "references")
    seen = set()
    for ref in refs:
        keys(ref, "id sha256 binding role")
        token(ref["id"])
        digest(ref["sha256"])
        digest(ref["binding"])
        need(ref["role"] in ("outcome", "persistence", "readback"), "role")
        need(ref["id"] not in seen, "duplicate-reference")
        seen.add(ref["id"])
    return record


class _BoundedPorts:
    def __init__(self, ports, budget):
        self.ports, self.budget, self.calls = ports, budget, 0

    def begin(self):
        self.calls = 0

    def __getattr__(self, name):
        callback = getattr(self.ports, name)
        def bounded(*args, **kwargs):
            self.calls += 1
            need(self.calls <= MAX_PORT_CALLS, "port-call-limit")
            # Synchronous Python cannot cancel a blocking injected call. The
            # qualified owner must enforce this budget inside every port.
            try:
                return callback(*args, budget_ns=self.budget, **kwargs)
            except Exception:
                raise AdapterError("owner-port-" + name) from None
        return bounded


class StorageAdapter:
    def __init__(self, config: OwnerConfig, ports: OwnerPorts):
        self.config, self.ports = config, _BoundedPorts(ports, config.callback_budget_ns)
        self._begin()

    def _begin(self):
        self.ports.begin()
        self._stream_cache = {}
        self._stream_bytes = self._stream_chunks = 0
        self._admission_floor = (0, 0)

    def _stream_state(self, handle, expected):
        state = self.ports.stream_state(self.config.scope, handle)
        need(type(state) is StreamState and state.sha256 == expected and
             state.route == self.config.read_route and state.durable is True and
             state.independent is True, "stream-state")
        return state

    def _source_object(self, source):
        need(type(source) in (PinnedSource, StreamingSource), "source")
        declared = source.identity_object()
        if type(source) is PinnedSource:
            return declared
        limits = self.config.stream_limits
        need(limits is not None, "stream-admission")
        need(sum(pin.bytes for pin in source.payloads) + len(source.manifest) <= limits.max_source_bytes,
             "stream-admission")
        for pin in source.payloads:
            need(pin.bytes <= limits.max_payload_bytes, "stream-admission")
            state = self._stream_state(pin.handle, pin.state_sha256)
            descriptor = dict(name=pin.name, bytes=pin.bytes, sha256=pin.sha256,
                              state_sha256=pin.state_sha256, route=state.route)
            if pin.handle in self._stream_cache:
                need(self._stream_cache[pin.handle] == descriptor, "stream-alias")
                continue
            # Aggregate byte/chunk budgets cover original + release across all
            # streaming reads within this call, including explicit EOF reads.
            need(self._stream_bytes + pin.bytes <= limits.max_source_bytes, "stream-admission")
            stream = self.ports.open_stream(self.config.scope, pin.handle, expected_state=pin.state_sha256,
                                            max_bytes=pin.bytes, max_chunks=limits.max_chunks-self._stream_chunks)
            try:
                try:
                    opened_state = stream.state
                except Exception:
                    raise AdapterError("stream-state") from None
                need(opened_state == state, "stream-state")
                hasher, size = hashlib.sha256(), 0
                while True:
                    need(self._stream_chunks < limits.max_chunks, "stream-chunks")
                    requested = min(limits.chunk_bytes, pin.bytes-size+1)
                    try:
                        chunk = stream.read_chunk(max_bytes=requested, budget_ns=self.config.callback_budget_ns)
                    except Exception:
                        raise AdapterError("stream-read") from None
                    self._stream_chunks += 1
                    need(type(chunk) is bytes and len(chunk) <= requested, "stream-chunk")
                    if not chunk:
                        break
                    size += len(chunk)
                    self._stream_bytes += len(chunk)
                    need(size <= pin.bytes and self._stream_bytes <= limits.max_source_bytes, "stream-size")
                    hasher.update(chunk)
                need(size == pin.bytes and hasher.hexdigest() == pin.sha256, "stream-pin-changed")
            finally:
                try:
                    stream.close()
                except Exception:
                    raise AdapterError("stream-close") from None
            need(self._stream_state(pin.handle, pin.state_sha256) == state, "stream-state")
            self._stream_cache[pin.handle] = descriptor
        return declared

    def resolve_reference(self, reference, raw_record):
        """Read-only admission uses raw v2 bytes and the injected current clock."""
        self._begin()
        record = parse_record(raw_record)
        self._request(record["request"].encode(), record["operation"], record["kind"], record["state"], record["mode"])
        return self._resolve_reference(reference, record, self._clock(self._ledger()).wall_ns)

    def _resolve_reference(self, reference, record, now_ns):
        keys(reference, "id sha256 binding role")
        token(reference["id"])
        digest(reference["sha256"])
        digest(reference["binding"])
        need(reference["role"] in ("outcome", "persistence", "readback"), "role")
        need(record["scope"] == self.config.scope and record["owner"] == self.config.owner and
             record["kind"] in self.config.kinds, "reference-scope")
        matches = self.ports.resolve(self.config.scope, reference["id"], max_bytes=MAX_BYTES)
        need(type(matches) is list and len(matches) == 1, "reference-ambiguous")
        resolved = matches[0]
        need(type(resolved) is ResolvedReference and resolved.route in self.config.reference_routes
             and resolved.durable is True, "reference-route")
        need(sha(resolved.raw) == reference["sha256"], "reference-changed")
        body = decode(resolved.raw)
        keys(body, "profile scope owner operation kind state binding role recorded clock_source provenance origin cloud_status carriers")
        need(body["profile"] == EVIDENCE_PROFILE and body["origin"] == "prospective", "historical-evidence")
        for name in ("scope", "owner", "operation", "kind", "state"):
            need(body[name] == record[name], "reference-binding")
        need(body["clock_source"] == self.config.clock_source, "reference-clock")
        token(body["provenance"])
        need(body["provenance"] == self.config.registry_provenance, "reference-provenance")
        doc = admit_request(record["request"].encode("utf-8"))
        source = doc["original"] if record["kind"] in ("disposition", "recovery") else doc["release"]
        need(source is not None, "release-required")
        binding = v1.identity(source)
        if record["kind"] in ("qualification", "selection"):
            need(binding != v1.identity(doc["original"]), "release-original-alias")
        need(body["binding"] == binding == reference["binding"] and
             body["role"] == reference["role"], "reference-binding")
        observed = parse_ns(body["recorded"])
        need(observed <= now_ns and now_ns < observed + self.config.horizons.observation_ns, "reference-expired")
        if reference["role"] == "readback":
            need(resolved.independent is True, "reference-independent")
        need(type(body["carriers"]) is list and len(body["carriers"]) <= 128, "carriers")
        for carrier in body["carriers"]:
            digest(carrier)
        need(body["cloud_status"] in ("not_applicable", "uploaded", "pending", "error", "conflict"), "cloud-status")
        if record["kind"] == "recovery" and record["state"] == "recoverable":
            need(body["cloud_status"] == "uploaded" and body["carriers"], "cloud-unconfirmed")
        return {"id": reference["id"], "sha256": sha(resolved.raw), "bytes": len(resolved.raw),
                "route": resolved.route, "binding": binding, "role": reference["role"],
                "recorded": body["recorded"], "provenance": body["provenance"]}

    def _request(self, raw, operation, kind, state, mode):
        doc = admit_request(raw)
        token(operation)
        need(kind in self.config.kinds and type(state) is str and state in v1.STATES[kind], "scope-kind")
        need(self.ports.authorize(self.config.scope, operation, kind, mode) is True, "authorization")
        export = self.ports.frozen_export(self.config.scope)
        need(type(export) is FrozenExport and export.retained is True and
             export.provenance == self.config.registry_provenance, "registry")
        need(export.label == doc["label"] and self._source_object(export.original) == doc["original"], "original-changed")
        release = None if export.release is None else self._source_object(export.release)
        need(release == doc["release"], "release-changed")
        if kind in ("qualification", "selection"):
            need(release is not None and v1.identity(release) != v1.identity(doc["original"]), "release-required")
        registry = sha(canonical({"label": export.label, "original": doc["original"],
                                  "release": release, "provenance": export.provenance, "streams": self._stream_cache}))
        return doc, registry

    def _ledger(self):
        snapshot = self.ports.ledger(self.config.scope, max_records=MAX_RECORDS, max_bytes=MAX_LEDGER_BYTES)
        need(type(snapshot) is LedgerSnapshot and snapshot.complete is True and
             snapshot.provenance == self.config.registry_provenance, "history-incomplete")
        raws = snapshot.records
        need(type(raws) is tuple and len(raws) <= MAX_RECORDS and
             all(type(raw) is bytes for raw in raws) and sum(map(len, raws)) <= MAX_LEDGER_BYTES, "ledger-limit")
        events, ids, operations, refs, labels = [], {}, {}, {}, {}
        originals = set()
        tail = None
        for raw in raws:
            event = parse_record(raw)
            need(event["scope"] == self.config.scope and event["owner"] == self.config.owner and
                 event["clock_source"] == self.config.clock_source, "ledger-scope")
            need(event["predecessors"] == ([] if tail is None else [tail]), "ledger-chain")
            need(event["id"] not in ids, "ledger-duplicate")
            retained_hashes = {e["id"]: h for h, e, _ in events}
            need(all(event_id in retained_hashes and proof["record"] == retained_hashes[event_id]
                     for event_id, proof in event["prerequisite_proofs"].items()), "prerequisite-history")
            if event["phase"] in ("intent", "dispatch"):
                active = self._active_history([(h, e, r) for h, e, r in events if e["kind"] == event["kind"]])
                need(set(event["prerequisite_proofs"]) == {e["id"] for _, e, _ in active}, "prerequisite-history")
            doc = admit_request(event["request"].encode("utf-8"))
            original = v1.identity(doc["original"])
            originals.add(original)
            need(len(originals) == 1, "history-source")
            need(doc["label"] not in labels or labels[doc["label"]] == original, "label-conflict")
            labels[doc["label"]] = original
            binding = (original, event["kind"], None if event["kind"] in ("disposition", "recovery")
                       else v1.identity(doc["release"]) if doc["release"] is not None else None)
            need(event["operation"] not in operations or operations[event["operation"]] == binding, "operation-rebound")
            operations[event["operation"]] = binding
            for ref in event["evidence"]:
                need(ref["id"] not in refs or refs[ref["id"]] == ref, "reference-rebound")
                refs[ref["id"]] = ref
            if events:
                previous = events[-1][1]
                need(event["clock_source"] == previous["clock_source"] and
                     parse_ns(event["captured"]) >= parse_ns(previous["captured"]) and
                     int(event["monotonic_ns"]) >= int(previous["monotonic_ns"]), "clock-reversal")
            need(all(h in {item[0] for item in events} for h in event["reconciles"]), "reconciliation-history")
            previous_operation = [e for _, e, _ in events if e["operation"] == event["operation"]]
            if event["phase"] in ("complete", "observation", "reconcile"):
                need({r["role"] for r in event["evidence"]} == {"outcome", "persistence", "readback"}, "missing-evidence")
            if event["phase"] == "intent":
                need(event["recorded"] == event["captured"] and not event["evidence"] and
                     parse_ns(event["expires"]) == parse_ns(event["recorded"]) + self.config.horizons.intent_ns,
                     "intent-horizon")
                need(not previous_operation, "operation-exists")
            elif event["phase"] == "dispatch":
                need(len(previous_operation) == 1 and previous_operation[0]["phase"] == "intent", "dispatch-once")
                previous_dimension = [e for _, e, _ in events if e["kind"] == event["kind"]]
                need(previous_dimension and previous_dimension[-1]["id"] == previous_operation[0]["id"],
                     "intent-superseded")
                need(event["expires"] == previous_operation[0]["expires"] and not event["evidence"] and
                     event["recorded"] == event["captured"] and
                     parse_ns(previous_operation[0]["recorded"]) < parse_ns(event["recorded"]) <
                     parse_ns(previous_operation[0]["expires"]), "intent-expired")
            elif event["phase"] in ("complete", "failed", "interrupted", "unknown"):
                need(len(previous_operation) == 2 and [e["phase"] for e in previous_operation] ==
                     ["intent", "dispatch"], "outcome-state")
                if event["phase"] == "complete":
                    previous_dimension = [e for _, e, _ in events if e["kind"] == event["kind"]]
                    need(previous_dimension and previous_dimension[-1]["operation"] == event["operation"] and
                         previous_dimension[-1]["phase"] == "dispatch", "outcome-superseded")
                    self._post_dispatch(parse_ns(event["recorded"]), int(event["monotonic_ns"]),
                        [(h, e, r) for h, e, r in events if e["operation"] == event["operation"]], "unresolved-dispatch")
                    need(parse_ns(event["recorded"]) > parse_ns(previous_operation[-1]["recorded"]) and
                         event["state"] == previous_operation[0]["state"] and
                         event["fence"] == previous_operation[0]["fence"], "unresolved-intent")
                    need(parse_ns(event["captured"]) < parse_ns(previous_operation[0]["expires"]) and
                         int(event["monotonic_ns"]) < int(previous_operation[0]["monotonic_ns"]) +
                         self.config.horizons.intent_ns, "intent-expired")
            elif event["phase"] == "observation":
                need(not previous_operation, "operation-exists")
            elif event["phase"] == "reconcile":
                relevant_hashes = sorted(h for h, e, _ in events if e["kind"] == event["kind"])
                need(previous_operation and event["reconciles"] == relevant_hashes, "reconciliation-history")
                covered = [e for _, e, _ in events if e["kind"] == event["kind"]]
                need(all(parse_ns(event["recorded"]) > max(parse_ns(e["recorded"]), parse_ns(e["captured"]))
                         for e in covered), "reconciliation-stale")
                self._post_dispatch(parse_ns(event["recorded"]), int(event["monotonic_ns"]),
                    [(h, e, r) for h, e, r in events if e["kind"] == event["kind"]], "reconciliation-dispatch-cut")
                need(all(ref["id"] not in {r["id"] for e in covered for r in e["evidence"]}
                         for ref in event["evidence"]), "reconciliation-readback")
            if event["phase"] not in ("intent", "dispatch"):
                need(parse_ns(event["expires"]) == parse_ns(event["recorded"]) + self.config.horizons.observation_ns,
                     "observation-horizon")
            tail = sha(raw)
            ids[event["id"]] = event
            events.append((tail, event, raw))
        need(snapshot.tail == tail, "history-frontier")
        return events

    def _clock(self, events):
        sample = self.ports.now()
        need(type(sample) is ClockSample and sample.source == self.config.clock_source, "clock-provenance")
        format_ns(sample.wall_ns)
        need(sample.wall_ns >= self._admission_floor[0] and sample.monotonic_ns >= self._admission_floor[1],
             "clock-reversal")
        need(type(sample.monotonic_ns) is int and 0 <= sample.monotonic_ns < 2**63, "clock")
        if events:
            old = events[-1][1]
            need(old["clock_source"] == sample.source and sample.wall_ns >= parse_ns(old["captured"])
                 and sample.monotonic_ns >= int(old["monotonic_ns"]), "clock-reversal")
        return sample

    def _fence(self, lease):
        need(lease is not None, "lock-busy")
        try:
            fence = lease.snapshot()
        except Exception:
            raise AdapterError("fence-unavailable") from None
        need(type(fence) is Fence, "fence")
        obj = fence.object()
        need(not obj["independent_actor"], "unfenced-actor")
        return obj

    @staticmethod
    def _close(lease):
        try:
            lease.close()
        except Exception:
            raise AdapterError("lease-release-uncertain") from None

    def _durable(self, raw, ack, read):
        need(type(ack) is WriteAck and ack.route == self.config.write_route and ack.durable is True, "persistence")
        need(type(read) is Readback and read.route == self.config.read_route and read.durable is True
             and read.independent is True and read.raw == raw and sha(read.raw) == sha(raw), "readback")

    def _read_record(self, raw, events=None):
        event = parse_record(raw)
        need(event["scope"] == self.config.scope and event["owner"] == self.config.owner, "ledger-scope")
        need(any(saved == raw for _, _, saved in (self._ledger() if events is None else events)), "record-not-retained")
        read = self.ports.independent_read(self.config.scope, event["id"], max_bytes=MAX_BYTES)
        need(type(read) is Readback and read.route == self.config.read_route and read.durable is True
             and read.independent is True and read.raw == raw, "readback")
        return {"sha256": sha(raw), "bytes": len(raw), "write_route": self.config.write_route,
                "read_route": read.route, "independent": True}

    def verify_durable_readback(self, raw):
        """Read-only: requires both a retained event and its separate artifact."""
        self._begin()
        artifact = self._existing(raw)
        self._clock(self._ledger())
        return decode(artifact)["document"]

    def _existing(self, raw, events=None, verify_prerequisites=True, proof_cache=None):
        event = parse_record(raw)
        document = self._read_record(raw, events=events)
        read = self.ports.independent_verification_read(self.config.scope, event["id"], max_bytes=MAX_BYTES)
        need(type(read) is Readback and read.route == self.config.read_route and read.durable is True
             and read.independent is True, "verification-missing")
        artifact = decode(read.raw)
        keys(artifact, "profile event operation scope owner authority document original registry_sha256 fence recorded captured clock_source references streams limits")
        need(artifact["authority"] == "injected-owner-evidence" and
             artifact["original"] == v1.identity(admit_request(event["request"].encode())["original"]) and
             artifact["profile"] == "publication-input-storage-verification-v2" and
             artifact["event"] == event["id"] and artifact["operation"] == event["operation"] and
             artifact["scope"] == self.config.scope and artifact["owner"] == self.config.owner and
             artifact["document"] == document and artifact["registry_sha256"] == event["registry_sha256"] and
             artifact["fence"] == event["fence"] and artifact["recorded"] == event["recorded"] and
             artifact["captured"] == event["captured"] and artifact["clock_source"] == self.config.clock_source,
             "verification-changed")
        need(type(artifact["streams"]) is dict and len(artifact["streams"]) <= 256, "verification-changed")
        for handle, descriptor in artifact["streams"].items():
            token(handle)
            keys(descriptor, "name bytes sha256 state_sha256 route")
            token(descriptor["name"])
            digest(descriptor["sha256"])
            digest(descriptor["state_sha256"])
            need(type(descriptor["bytes"]) is int and 0 <= descriptor["bytes"] <= v1.MAX_COUNT and
                 descriptor["route"] == self.config.read_route, "verification-changed")
        request = admit_request(event["request"].encode())
        need(sha(canonical({"label": request["label"], "original": request["original"],
                            "release": request["release"], "provenance": self.config.registry_provenance,
                            "streams": artifact["streams"]})) == event["registry_sha256"], "verification-changed")
        expected_limits = ["injected-routes-only", "cooperating-writers-only", "no-operational-adoption"]
        need(artifact["limits"] == expected_limits and type(artifact["references"]) is list and
             len(artifact["references"]) == (len(event["evidence"]) if event["phase"] in
                 ("complete", "observation", "reconcile") else 0), "verification-changed")
        refs = {ref["id"]: ref for ref in event["evidence"]}
        seen = set()
        for ref in artifact["references"]:
            keys(ref, "id sha256 bytes route binding role recorded provenance")
            token(ref["id"])
            need(ref["id"] not in seen and ref["id"] in refs, "verification-changed")
            seen.add(ref["id"])
            need(all(ref[name] == refs[ref["id"]][name] for name in ("sha256", "binding", "role")) and
                 ref["route"] in self.config.reference_routes and ref["provenance"] == self.config.registry_provenance and
                 type(ref["bytes"]) is int and 0 <= ref["bytes"] <= MAX_BYTES and
                 parse_ns(ref["recorded"]) <= parse_ns(event["captured"]), "verification-changed")
        admission = self._admission(event, raw, read.raw, events=events)
        if proof_cache is not None:
            for field, body in (("record", raw), ("verification", read.raw), ("admission", admission)):
                self._cache_proof(proof_cache, event["id"], field, body)
        # Exact predecessor bytes were frozen in the identity-bound event,
        # not freshly adopted from mutable sidecar lookups at dispatch time.
        for event_id, proof in (event["prerequisite_proofs"].items() if verify_prerequisites else ()):
            for field, method in (("record", self.ports.independent_read),
                                  ("verification", self.ports.independent_verification_read),
                                  ("admission", self.ports.independent_admission_read)):
                if proof_cache is not None and (event_id, field) in proof_cache:
                    need(sha(proof_cache[event_id, field]) == proof[field], "prerequisite-proof-changed")
                    continue
                retained = method(self.config.scope, event_id, max_bytes=MAX_BYTES)
                need(type(retained) is Readback and retained.route == self.config.read_route and
                     retained.durable is True and retained.independent is True and
                     sha(retained.raw) == proof[field], "prerequisite-proof-changed")
                if proof_cache is not None:
                    self._cache_proof(proof_cache, event_id, field, retained.raw)
        return read.raw

    def _deadlines(self, event, events):
        wall = parse_ns(event["expires"])
        elapsed = int(event["monotonic_ns"]) + wall - parse_ns(event["captured"])
        if event["phase"] == "complete":
            intent = next(e for _, e, _ in events if e["operation"] == event["operation"] and e["phase"] == "intent")
            wall = min(wall, parse_ns(intent["expires"]))
            elapsed = min(elapsed, int(intent["monotonic_ns"]) + self.config.horizons.intent_ns)
        return wall, elapsed

    @staticmethod
    def _decimal_ns(value):
        need(type(value) is str and re.fullmatch(r"0|[1-9][0-9]{0,19}", value) and int(value) < 2**64, "clock")
        return int(value)

    def _admission(self, event, raw, verification, expected=None, events=None):
        read = self.ports.independent_admission_read(self.config.scope, event["id"], max_bytes=MAX_BYTES)
        if type(read) is ProcessAdmissionReadback:
            return self._process_admission(read, event, raw, verification, expected, events)
        need(type(read) is Readback and read.route == self.config.read_route and read.durable is True
             and read.independent is True, "admission-readback")
        marker = decode(read.raw)
        need(canonical(marker) == read.raw, "admission-byte-identity")
        keys(marker, "profile event operation scope owner kind mode document_sha256 verification_sha256 registry_sha256 fence stream_seals clock_source validated validated_monotonic_ns wall_deadline elapsed_deadline_ns committed committed_monotonic_ns")
        need(marker["profile"] == "publication-input-storage-admission-v2", "admission-profile")
        for name in ("operation", "scope", "owner", "kind", "mode", "registry_sha256", "fence", "clock_source"):
            need(marker[name] == event[name], "admission-binding")
        artifact = decode(verification)
        need(marker["event"] == event["id"] and marker["document_sha256"] == sha(raw) and
             marker["verification_sha256"] == sha(verification) and marker["stream_seals"] == artifact["streams"],
             "admission-binding")
        if expected is not None:
            need({k:v for k,v in marker.items() if k not in ("committed", "committed_monotonic_ns")} == expected,
                 "admission-binding")
        wall_deadline, elapsed_deadline = self._deadlines(event, self._ledger() if events is None else events)
        validated, committed = parse_ns(marker["validated"]), parse_ns(marker["committed"])
        validated_mono, committed_mono = (self._decimal_ns(marker[k]) for k in
                                          ("validated_monotonic_ns", "committed_monotonic_ns"))
        need(marker["wall_deadline"] == format_ns(wall_deadline) and
             self._decimal_ns(marker["elapsed_deadline_ns"]) == elapsed_deadline and
             parse_ns(event["captured"]) <= validated <= committed < wall_deadline and
             int(event["monotonic_ns"]) <= validated_mono <= committed_mono < elapsed_deadline,
             "admission-expired")
        self._admission_floor = (max(self._admission_floor[0], committed),
                                 max(self._admission_floor[1], committed_mono))
        return read.raw

    def _process_admission(self, read, event, raw, verification, expected, events):
        need(read.route == self.config.read_route and read.durable is True and
             read.independent is True and read.epoch == self.config.clock_source,
             "process-admission-route")
        token(read.process_epoch)
        marker = decode(read.raw)
        need(canonical(marker) == read.raw, "admission-byte-identity")
        keys(marker, "profile event operation scope owner kind mode document_sha256 verification_sha256 registry_sha256 fence stream_seals clock_source validated validated_monotonic_ns wall_deadline elapsed_deadline_ns prepared prepared_monotonic_ns")
        need(marker["profile"] == "publication-input-observation-admission-v3" and
             event["kind"] == "disposition" and event["state"] == "present" and
             event["phase"] == "observation" and event["mode"] == "observation",
             "process-admission-scope")
        for name in ("operation", "scope", "owner", "kind", "mode", "registry_sha256", "fence", "clock_source"):
            need(marker[name] == event[name], "admission-binding")
        need(marker["event"] == event["id"] and marker["document_sha256"] == read.document_sha256 == sha(raw) and
             marker["verification_sha256"] == read.verification_sha256 == sha(verification) and
             read.admission_sha256 == sha(read.raw) and
             marker["stream_seals"] == decode(verification)["streams"], "admission-binding")
        if expected is not None:
            proposal = {k:v for k,v in marker.items() if k not in ("prepared", "prepared_monotonic_ns")}
            proposal["profile"] = "publication-input-storage-admission-v2"
            need(proposal == expected, "admission-binding")
        wall, elapsed = self._deadlines(event, self._ledger() if events is None else events)
        confirmed = read.confirmed
        need(type(confirmed) is ClockSample and confirmed.source == read.epoch and
             type(confirmed.monotonic_ns) is int and 0 <= confirmed.monotonic_ns < 2**63,
             "process-admission-clock")
        format_ns(confirmed.wall_ns)
        need(marker["wall_deadline"] == format_ns(wall) and
             self._decimal_ns(marker["elapsed_deadline_ns"]) == elapsed and
             parse_ns(event["captured"]) <= parse_ns(marker["validated"]) <=
             parse_ns(marker["prepared"]) <= confirmed.wall_ns < wall and
             int(event["monotonic_ns"]) <= self._decimal_ns(marker["validated_monotonic_ns"]) <=
             self._decimal_ns(marker["prepared_monotonic_ns"]) <= confirmed.monotonic_ns < elapsed,
             "process-admission-expired")
        self._admission_floor = (max(self._admission_floor[0], confirmed.wall_ns),
                                 max(self._admission_floor[1], confirmed.monotonic_ns))
        return read.raw

    @staticmethod
    def _cache_proof(cache, event_id, field, raw):
        key = (event_id, field)
        need(key not in cache or cache[key] == raw, "prerequisite-proof-changed")
        if key not in cache:
            need(len(cache) < 3 * MAX_RECORDS and
                 sum(map(len, cache.values())) + len(raw) <= 3 * MAX_LEDGER_BYTES, "proof-cache-limit")
            cache[key] = raw

    def _proofs(self, events):
        # One bounded snapshot per verification pass, never retained across I/O
        # persistence stages. Already verified predecessor bytes are checked
        # against frozen hashes without re-reading the same blobs quadratically.
        proofs, cache = {}, {}
        for _, event, raw in self._active_history(events):
            verification = self._existing(raw, events=events, proof_cache=cache)
            admission = cache[event["id"], "admission"]
            proofs[event["id"]] = {"record": sha(raw), "verification": sha(verification),
                                    "admission": sha(admission)}
        return proofs

    def _dispatch_cut(self, events):
        # Admission precedes invocation: it is NOT proof that an effect settled.
        # The qualified owner supplies an independently retained boundary only
        # after the attempt is settled/quiescent under its real exclusion.
        cut, elapsed = -1, -1
        for _, event, raw in events:
            if event["phase"] != "dispatch":
                continue
            # Chronology checks this dispatch's own bound proof; the active
            # admission/projection walk separately verifies frozen predecessors.
            verification = self._existing(raw, events=events, verify_prerequisites=False)
            admission = decode(self._admission(event, raw, verification, events=events))
            read = self.ports.independent_dispatch_boundary(self.config.scope, event["operation"], max_bytes=MAX_BYTES)
            need(type(read) is Readback and read.route == self.config.read_route and
                 read.durable is True and read.independent is True, "dispatch-boundary")
            proof = decode(read.raw)
            need(canonical(proof) == read.raw, "dispatch-boundary-byte-identity")
            keys(proof, "profile scope owner operation kind dispatch_sha256 registry_sha256 fence clock_source settled settled_monotonic_ns status")
            need(proof["profile"] == "publication-input-storage-dispatch-boundary-v2" and
                 proof["status"] == "settled" and proof["dispatch_sha256"] == sha(raw) and
                 all(proof[k] == event[k] for k in ("scope", "owner", "operation", "kind", "registry_sha256", "fence", "clock_source")),
                 "dispatch-boundary")
            settled = parse_ns(proof["settled"])
            need(settled >= parse_ns(admission["committed"]) and
                 self._decimal_ns(proof["settled_monotonic_ns"]) >= self._decimal_ns(admission["committed_monotonic_ns"]),
                 "dispatch-boundary")
            settled_mono = self._decimal_ns(proof["settled_monotonic_ns"])
            cut, elapsed = max(cut, settled), max(elapsed, settled_mono)
            self._admission_floor = (max(self._admission_floor[0], settled),
                                     max(self._admission_floor[1], settled_mono))
        return cut, elapsed

    def _post_dispatch(self, recorded, monotonic, events, code):
        wall_cut, elapsed_cut = self._dispatch_cut(events)
        need(monotonic >= elapsed_cut, "clock-reversal")
        need(recorded > wall_cut, code)

    def _active_history(self, events):
        cut = max((i for i, (_, e, _) in enumerate(events) if e["phase"] == "reconcile"), default=0)
        return events[cut:]

    def _fresh(self, event, sample, events=()):
        need(sample.wall_ns < parse_ns(event["expires"]) and sample.monotonic_ns <
             int(event["monotonic_ns"]) + parse_ns(event["expires"]) - parse_ns(event["captured"]),
             "observation-expired")
        if event["phase"] == "complete":
            intent = next(e for _, e, _ in events if e["operation"] == event["operation"] and e["phase"] == "intent")
            need(sample.wall_ns < parse_ns(intent["expires"]) and
                 sample.monotonic_ns < int(intent["monotonic_ns"]) + self.config.horizons.intent_ns,
                 "intent-expired")

    def _persist(self, event, events, verified, lease):
        raw = canonical(event)
        parse_record(raw)
        need(sum(len(r) for _, _, r in events) + len(raw) <= MAX_LEDGER_BYTES, "ledger-limit")
        prior_refs = {ref["id"]: ref for _, old, _ in events for ref in old["evidence"]}
        need(event["id"] not in {old["id"] for _, old, _ in events}, "event-rebound")
        need(all(ref["id"] not in prior_refs or prior_refs[ref["id"]] == ref for ref in event["evidence"]),
             "reference-rebound")
        # Exclusive append must compare this exact authoritative frontier atomically.
        need([h for h, _, _ in self._ledger()] == [h for h, _, _ in events], "history-frontier")
        ack = self.ports.append(self.config.scope, event["id"], raw, events[-1][0] if events else None)
        read = self.ports.independent_read(self.config.scope, event["id"], max_bytes=MAX_BYTES)
        self._durable(raw, ack, read)
        durable = {"sha256": sha(raw), "bytes": len(raw), "write_route": ack.route,
                   "read_route": read.route, "independent": True}
        self._fresh(event, self._clock(self._ledger()), events)
        need(self._fence(lease) == event["fence"], "fence-changed")
        _doc, registry = self._request(event["request"].encode(), event["operation"], event["kind"], event["state"], event["mode"])
        need(registry == event["registry_sha256"], "registry-changed")
        artifact = {"profile": "publication-input-storage-verification-v2", "event": event["id"],
                    "operation": event["operation"], "scope": self.config.scope, "owner": self.config.owner,
                    "authority": "injected-owner-evidence", "document": durable,
                    "original": v1.identity(admit_request(event["request"].encode())["original"]),
                    "registry_sha256": event["registry_sha256"], "fence": event["fence"],
                    "recorded": event["recorded"], "captured": event["captured"],
                    "clock_source": event["clock_source"], "references": verified,
                    "streams": self._stream_cache,
                    "limits": ["injected-routes-only", "cooperating-writers-only", "no-operational-adoption"]}
        encoded = canonical(artifact)
        need(len(encoded) <= MAX_BYTES, "artifact-limit")
        ack = self.ports.append_verification(self.config.scope, event["id"], encoded)
        read = self.ports.independent_verification_read(self.config.scope, event["id"], max_bytes=MAX_BYTES)
        self._durable(encoded, ack, read)
        final_clock = self._clock(self._ledger())
        self._fresh(event, final_clock, events)
        need(self._fence(lease) == event["fence"], "fence-changed")
        _doc, registry = self._request(event["request"].encode(), event["operation"], event["kind"], event["state"], event["mode"])
        need(registry == event["registry_sha256"], "registry-changed")
        wall_deadline, elapsed_deadline = self._deadlines(event, events)
        proposal = {"profile":"publication-input-storage-admission-v2", "event":event["id"],
                    "operation":event["operation"], "scope":self.config.scope, "owner":self.config.owner,
                    "kind":event["kind"], "mode":event["mode"], "document_sha256":sha(raw),
                    "verification_sha256":sha(encoded), "registry_sha256":registry, "fence":event["fence"],
                    "stream_seals":dict(self._stream_cache), "clock_source":self.config.clock_source,
                    "validated":format_ns(final_clock.wall_ns), "validated_monotonic_ns":str(final_clock.monotonic_ns),
                    "wall_deadline":format_ns(wall_deadline), "elapsed_deadline_ns":str(elapsed_deadline)}
        proposal_bytes = canonical(proposal)
        need(len(proposal_bytes) <= MAX_BYTES, "admission-limit")
        ack = self.ports.commit_admission(self.config.scope, event["id"], proposal_bytes)
        need(type(ack) is WriteAck and ack.route == self.config.write_route and ack.durable is True, "admission-persistence")
        # The qualified owner atomically validates actual commit-time deadlines,
        # fence/frontier/seals and durable prerequisites before admitting. Never
        # reject a committed admission afterward merely because reply time is late.
        admission = self._admission(event, raw, encoded, expected=proposal)
        return {"record": raw, "verification": encoded, "admission": admission}

    def _run(self, raw, operation, event_id, kind, state, phase, references=(), reconciles=()):
        self._begin()
        need(type(references) is tuple and len(references) <= 8 and
             type(reconciles) is tuple and len(reconciles) <= MAX_RECORDS, "input-limit")
        for reference in references:
            keys(reference, "id sha256 binding role")
            token(reference["id"])
            digest(reference["sha256"])
            digest(reference["binding"])
            need(reference["role"] in ("outcome", "persistence", "readback"), "role")
        for value in reconciles:
            digest(value)
        references = tuple(dict(reference) for reference in references)
        mode = "observation" if phase in ("observation", "reconcile") else "mutation"
        _doc, registry = self._request(raw, operation, kind, state, mode)
        token(event_id)
        lease = self.ports.try_acquire(self.config.scope, operation)
        need(lease is not None, "lock-busy")
        try:
            fence = self._fence(lease)
            events = self._ledger()
            need(all(v1.identity(admit_request(e["request"].encode())["original"]) == v1.identity(_doc["original"])
                     for _, e, _ in events), "history-source")
            prior = [e for _, e, _ in events if e["operation"] == operation]
            existing = next((r for _, e, r in events if e["id"] == event_id), None)
            if existing is not None:
                old = parse_record(existing)
                need(all(old[k] == v for k, v in {"request": raw.decode(), "operation": operation,
                     "kind": kind, "state": state, "phase": phase, "registry_sha256": registry,
                     "evidence": list(references), "reconciles": sorted(reconciles)}.items()), "event-rebound")
                verification = self._existing(existing)
                return {"record": existing, "verification": verification,
                        "admission": self._admission(old, existing, verification)}
            need(len(events) < MAX_RECORDS, "ledger-limit")
            now = self._clock(events)
            relevant = [(h, e, r) for h, e, r in events if e["kind"] == kind]
            prepared_proofs = {}
            if phase in ("intent", "observation"):
                need(not prior, "operation-exists")
                prepared_proofs = self._proofs(relevant)
                if relevant and relevant[-1][1]["phase"] in ("complete", "observation", "reconcile"):
                    latest = relevant[-1][1]
                    for ref in latest["evidence"]:
                        self._resolve_reference(ref, latest, now.wall_ns)
                view = self._project(relevant, now.wall_ns, now.monotonic_ns)
                if phase == "intent" and relevant:
                    need(all(relevant[-1][1]["fence"][key] == fence[key] for key in
                             ("application", "selection", "policy")), "pinned-state-changed")
                need(not relevant or view["status"] == "supported-observation", "reconcile-first")
            else:
                need(prior and all(e["request"] == raw.decode() and e["kind"] == kind
                                   and e["registry_sha256"] == registry for e in prior), "operation-rebound")
            if phase in ("complete", "failed", "interrupted", "unknown"):
                need((phase != "complete" or state == prior[0]["state"]) and any(e["phase"] == "dispatch" for e in prior) and
                     not any(e["phase"] in ("complete", "failed", "interrupted", "unknown", "reconcile") for e in prior), "outcome-state")
            if phase == "reconcile":
                need(sorted(reconciles) == sorted(h for h, _, _ in relevant) and relevant, "reconciliation-history")
            else:
                need(not reconciles, "reconciliation-history")
            recorded = now.wall_ns
            event = dict(profile=PROFILE, id=event_id, operation=operation, request=raw.decode(),
                         scope=self.config.scope, owner=self.config.owner, kind=kind, state=state, phase=phase,
                         recorded=format_ns(recorded), captured=format_ns(now.wall_ns),
                         expires=format_ns(recorded + (self.config.horizons.intent_ns if phase == "intent"
                                                    else self.config.horizons.observation_ns)),
                         clock_source=now.source, monotonic_ns=str(now.monotonic_ns), fence=fence,
                         registry_sha256=registry, predecessors=[] if not events else [events[-1][0]],
                         reconciles=sorted(reconciles), evidence=list(references), mode=mode,
                         prerequisite_proofs=prepared_proofs if phase == "intent" else {})
            verified = []
            if phase in ("complete", "observation", "reconcile"):
                need({r["role"] for r in references} == {"outcome", "persistence", "readback"}, "missing-evidence")
                parse_record(canonical(event))
                verified = [self._resolve_reference(r, event, now.wall_ns) for r in references]
                recorded = parse_ns(next(r["recorded"] for r in verified if r["role"] == "outcome"))
                need(all(parse_ns(r["recorded"]) >= recorded for r in verified), "evidence-order")
                if phase == "reconcile":
                    need(all(recorded > max(parse_ns(e["recorded"]), parse_ns(e["captured"]))
                             for _, e, _ in relevant), "reconciliation-stale")
                    self._post_dispatch(recorded, now.monotonic_ns, relevant, "reconciliation-dispatch-cut")
                    old_ids = {r["id"] for _, e, _ in relevant for r in e["evidence"]}
                    need(all(r["id"] not in old_ids for r in references), "reconciliation-readback")
                if phase == "complete":
                    need(relevant and relevant[-1][1]["operation"] == operation and
                         relevant[-1][1]["phase"] == "dispatch", "outcome-superseded")
                    intent = next(e for e in prior if e["phase"] == "intent")
                    dispatch = next(e for e in prior if e["phase"] == "dispatch")
                    self._post_dispatch(recorded, now.monotonic_ns,
                        [(h, e, r) for h, e, r in relevant if e["operation"] == operation], "unresolved-dispatch")
                    need(recorded > parse_ns(intent["recorded"]) and
                         recorded > parse_ns(dispatch["recorded"]), "unresolved-intent")
                    # An operation outliving its intent needs explicit read-only
                    # reconciliation, not a rewritten completion lease.
                    need(fence == intent["fence"], "pinned-state-changed")
                    need(now.wall_ns < parse_ns(intent["expires"]) and
                         now.monotonic_ns < int(intent["monotonic_ns"]) + self.config.horizons.intent_ns,
                         "intent-expired")
                event["recorded"] = format_ns(recorded)
                event["expires"] = format_ns(recorded + self.config.horizons.observation_ns)
            need(self._fence(lease) == fence, "fence-changed")
            self._request(raw, operation, kind, state, mode)
            return self._persist(event, events, verified, lease)
        finally:
            self._close(lease)

    def capture_intent(self, raw, *, operation, event_id, kind, state):
        return self._run(raw, operation, event_id, kind, state, "intent")

    def record_outcome(self, raw, *, operation, event_id, kind, state, phase, references=()):
        need(phase in ("complete", "failed", "interrupted", "unknown"), "phase")
        return self._run(raw, operation, event_id, kind, state, phase, references)

    def record_observation(self, raw, *, operation, event_id, kind, state, references):
        return self._run(raw, operation, event_id, kind, state, "observation", references)

    def reconcile_operation(self, raw, *, operation, event_id, kind, state, references, reconciles):
        return self._run(raw, operation, event_id, kind, state, "reconcile", references, reconciles)

    def dispatch(self, raw, *, operation, event_id, kind, state, effect):
        """At most one dispatch per operation, durably journaled BEFORE invocation.

        Any exception after dispatch persistence is uncertain. There is no retry
        command; reconciliation is read-only and a future cycle needs a new ID.
        """
        self._begin()
        self._request(raw, operation, kind, state, "mutation")
        need(callable(effect), "effect")
        token(event_id)
        lease = self.ports.try_acquire(self.config.scope, operation)
        need(lease is not None, "lock-busy")
        try:
            fence = self._fence(lease)
            events = self._ledger()
            prior = [e for _, e, _ in events if e["operation"] == operation]
            need(len(prior) == 1 and prior[0]["phase"] == "intent", "dispatch-once")
            intent = prior[0]
            relevant = [e for _, e, _ in events if e["kind"] == kind]
            need(relevant and relevant[-1]["id"] == intent["id"], "intent-superseded")
            need(intent["request"] == raw.decode() and intent["kind"] == kind and
                 intent["state"] == state and intent["fence"] == fence, "pinned-state-changed")
            now = self._clock(events)
            need(parse_ns(intent["recorded"]) < now.wall_ns < parse_ns(intent["expires"]), "intent-expired")
            intent_raw = next(r for _, e, r in events if e["id"] == intent["id"])
            frozen_proofs = self._proofs([(h, e, r) for h, e, r in events if e["kind"] == kind])
            # Persist a distinct dispatch marker while retaining the intent.
            event = dict(intent, id=event_id, phase="dispatch", recorded=format_ns(now.wall_ns),
                         captured=format_ns(now.wall_ns), monotonic_ns=str(now.monotonic_ns),
                         predecessors=[events[-1][0]], prerequisite_proofs=frozen_proofs)
            need(len(events) < MAX_RECORDS and event_id not in {e["id"] for _, e, _ in events}, "dispatch-id")
            self._persist(event, events, [], lease)
            need(self._fence(lease) == fence, "fence-changed")
            _doc, registry = self._request(raw, operation, kind, state, "mutation")
            need(registry == intent["registry_sha256"], "registry-changed")
            retained = self._ledger()
            predecessor_proofs = self._proofs([(h, e, r) for h, e, r in retained if e["kind"] == kind])
            final_clock = self._clock(retained)
            elapsed_deadline = int(intent["monotonic_ns"]) + self.config.horizons.intent_ns
            need(final_clock.wall_ns < parse_ns(intent["expires"]) and
                 final_clock.monotonic_ns < elapsed_deadline, "intent-expired")
            try:
                # The qualified owner must recheck these conditions under its
                # real exclusion/conditional-write semantics while dispatching.
                return self.ports.dispatch_under_fence(
                    self.config.scope, operation, fence=dict(fence),
                    intent_deadline_ns=parse_ns(intent["expires"]), elapsed_deadline_ns=elapsed_deadline,
                    clock_source=self.config.clock_source, registry_sha256=registry,
                    dispatch_sha256=sha(canonical(event)), stream_seals=dict(self._stream_cache),
                    predecessor_proofs=predecessor_proofs, effect=effect)
            except Exception:
                raise AdapterError("uncertain-effect") from None
        finally:
            self._close(lease)

    def _project(self, events, now_ns, monotonic_ns):
        if not events:
            return {"status": "unknown", "reason": "no-observation", "history": [], "conflicts": []}
        last = events[-1][1]
        history = [h for h, _, _ in events]
        reconciled_at = max((i for i, (_, e, _) in enumerate(events) if e["phase"] == "reconcile"), default=-1)
        active = events[reconciled_at:] if reconciled_at >= 0 else events
        completed_operations = {e["operation"] for _, e, _ in active if e["phase"] == "complete"}
        conflicts = [h for h, e, _ in active if e["phase"] in ("failed", "interrupted", "unknown")
                     or (e["phase"] == "dispatch" and e["operation"] not in completed_operations)]
        terminals = [e for _, e, _ in active if e["phase"] in ("complete", "observation", "reconcile")]
        opposed = len({(e["state"], v1.identity(admit_request(e["request"].encode())["release"])
                        if e["kind"] in ("qualification", "selection") else None) for e in terminals}) > 1
        supported = last["phase"] in ("complete", "observation", "reconcile")
        if last["phase"] == "reconcile":
            supported = last["reconciles"] == sorted(history[:-1])
        elif last["phase"] == "complete":
            # A completed own dispatch is supported, but no older failure or
            # opposed cycle is silently erased.
            completed_operations = {e["operation"] for _, e, _ in active if e["phase"] == "complete"}
            conflicts = [h for h, e, _ in active if e["phase"] in ("failed", "interrupted", "unknown")
                         or (e["phase"] == "dispatch" and e["operation"] not in completed_operations)]
            supported = supported and not conflicts and not opposed
        else:
            supported = supported and not conflicts and not opposed
        supported = supported and parse_ns(last["recorded"]) <= now_ns < parse_ns(last["expires"]) and (
            monotonic_ns < int(last["monotonic_ns"]) + parse_ns(last["expires"]) - parse_ns(last["captured"]))
        return {"status": "supported-observation" if supported else "unknown",
                "state": last["state"] if supported else None, "history": history,
                "conflicts": [h for h, e, _ in events if e["phase"] in ("failed", "interrupted", "unknown")],
                "active_conflicts": conflicts,
                "covered_history": history[:reconciled_at] if reconciled_at >= 0 else [],
                "history_authority": "retained-not-reverified", "reconciles": last["reconciles"],
                "authority": "injected-owner-evidence", "limits": ["not-global-exclusion", "not-operational-adoption"]}

    def project_current(self, *, kind):
        self._begin()
        need(kind in self.config.kinds, "scope-kind")
        lease = self.ports.try_acquire(self.config.scope, "read_projection")
        need(lease is not None, "lock-busy")
        try:
            fence = self._fence(lease)
            events = self._ledger()
            sample = self._clock(events)
            relevant = [(h, e, r) for h, e, r in events if e["kind"] == kind]
            frozen_view_proofs = self._proofs(relevant)
            current_view = self._project(relevant, sample.wall_ns, sample.monotonic_ns)
            if current_view["status"] == "supported-observation":
                event = relevant[-1][1]
                _doc, registry = self._request(event["request"].encode(), event["operation"], kind, event["state"], event["mode"])
                need(registry == event["registry_sha256"] and fence == event["fence"], "pinned-state-changed")
                need({r["role"] for r in event["evidence"]} == {"outcome", "persistence", "readback"}, "missing-evidence")
                for ref in event["evidence"]:
                    self._resolve_reference(ref, event, sample.wall_ns)
            need([h for h, _, _ in self._ledger()] == [h for h, _, _ in events], "history-frontier")
            need(self._fence(lease) == fence, "fence-changed")
            need(self._proofs(relevant) == frozen_view_proofs, "prerequisite-proof-changed")
            final_clock = self._clock(events)
            return self._project(relevant, final_clock.wall_ns, final_clock.monotonic_ns)
        finally:
            self._close(lease)

    @staticmethod
    def diagnose_v1(raw, *, as_of):
        """Explicit whole-second v1 diagnostic only; never converts v2 events."""
        return v1.classify([v1.parse(raw)], as_of=as_of)
