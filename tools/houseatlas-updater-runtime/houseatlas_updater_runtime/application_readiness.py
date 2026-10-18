"""Typed fixed-route reads over the concrete established-session transport.

Raw documents are trusted owner inputs already admitted by the compiled native
configuration loaders. Matching their hashes does not establish that admission.
Construction/import installs nothing; read() alone performs the fixed GETs.
"""

import base64
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
import hashlib
import json
import re

from houseatlas_updater.model import UpdateError
from .established_native_http import EstablishedNativeReadTransport, FixedRead
from .runtime import ApplicationExpectations, NativeReadiness, ReadinessRequest


_SHA = re.compile(r"[0-9a-f]{64}")
_UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
_OPAQUE = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
_STATUS = ("fresh", "stale", "error", "empty", "access-revoked")
_GEOMETRY = ("frame", "buildings", "levels", "rooms", "occurrences", "meshBindings",
             "plans", "overlayBindings", "coverage")
_LIMITS = (128 * 1024, 12 * 1024 * 1024, 1024 * 1024)


def _need(value):
    if not value:
        raise UpdateError("health-failed")


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def _digest(sha):
    return "sha-256=:" + base64.b64encode(bytes.fromhex(sha)).decode("ascii") + ":"


def _text(value):
    _need(type(value) is str and len(value) <= 2 * 1024 * 1024 and
          not any(0xD800 <= ord(c) <= 0xDFFF for c in value))


def _match(pattern):
    def validate(value):
        _need(type(value) is str and pattern.fullmatch(value) is not None)
    return validate


_uuid, _sha, _opaque = _match(_UUID), _match(_SHA), _match(_OPAQUE)


def _bool(value):
    _need(type(value) is bool)


def _integer(value):
    _need(type(value) is int and 0 <= value <= 2**64 - 1)


def _number(value):
    _need(type(value) in (int, Decimal))
    magnitude = value.copy_abs() if type(value) is Decimal else abs(value)
    _need(magnitude <= 1_000_000)


def _one(*values):
    return lambda value: _need(any(type(value) is type(item) and value == item for item in values))


def _nullable(check):
    return lambda value: None if value is None else check(value)


def _object(value, fields):
    _need(type(value) is dict and value.keys() == fields.keys())
    for key, check in fields.items():
        check(value[key])


def _record(**fields):
    return lambda value: _object(value, fields)


def _list(check, maximum=16384):
    def validate(value):
        _need(type(value) is list and len(value) <= maximum)
        for item in value:
            check(item)
    return validate


def _tuple(check, length):
    def validate(value):
        _list(check, length)(value)
        _need(len(value) == length)
    return validate


_scope = _record(workspaceId=_uuid, homeId=_uuid)
_source = _record(sourceInstanceId=_text, collectionId=_text,
                  sourceKind=_one("homebox-entity"), externalId=_text)
_bounds = _record(min=_tuple(_number, 3), max=_tuple(_number, 3))
_null_text, _null_uuid = _nullable(_text), _nullable(_uuid)


def _quantity(value, *, integral=False):
    if value is None:
        return
    _need(type(value) is str and len(value) <= 4096)
    match = re.fullmatch(r"-?(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?)([0-9]+))?", value)
    _need(match is not None)
    exponent = int((match[4] or "0").lstrip("0") or "0") if len((match[4] or "").lstrip("0")) <= 4 else 4097
    _need(exponent <= 4096)
    if match[3] == "-":
        exponent = -exponent
    shift = exponent - len(match[2] or "")
    _need(abs(shift) <= 4096)
    if integral:
        digits = match[1] + (match[2] or "")
        zero = not digits.strip("0")
        trailing = len(digits) - len(digits.rstrip("0"))
        _need(zero or (not value.startswith("-") and (shift >= 0 or trailing >= -shift)))


def _attachment(value):
    _need(type(value) is dict)
    common = dict(attachmentId=_text, title=_text)
    if value.get("kind") == "stored-file":
        _object(value, dict(common, kind=_one("stored-file"), contentType=_null_text,
                            byteSize=lambda v: _quantity(v, integral=True),
                            downloadHref=_null_text, previewHref=_null_text))
    else:
        _object(value, dict(common, kind=_one("external-link"), url=_null_text, archived=_bool))


def _entry(value, scope):
    entity = _record(id=_text, name=_text, description=_text,
                     entityType=_nullable(_record(id=_text, name=_text, isLocation=_bool)),
                     parent=_nullable(_record(id=_text)), archived=_bool, quantity=_quantity,
                     manufacturer=_null_text, modelNumber=_null_text, serialNumber=_null_text,
                     notes=_null_text)
    native = _record(kind=_one("homebox-native"), intent=_one("view", "edit", "maintenance"),
                     entity=_record(workspaceId=_uuid, homeId=_uuid, key=_source),
                     href=_text, verifiedRoute=_bool)
    _object(value, dict(schemaVersion=_one(1), workspaceId=_uuid, homeId=_uuid,
                        source=_source, sourceUpdatedAt=_null_text, retrievedAt=_text,
                        entity=entity, attachments=_list(_attachment),
                        maintenance=_list(_record(entryId=_text, name=_text, description=_text,
                                                  scheduledDate=_null_text, completedDate=_null_text,
                                                  cost=_quantity)), nativeLinks=_list(native), key=_text,
                        kind=_one("place", "item", "unknown"),
                        semanticKind=_one("unclassified", "site", "building", "floor", "room", "other"),
                        sourceState=_one("present", "archived", "unresolved", "confirmed-deleted", "unreviewed"),
                        cacheStatus=_one(*_STATUS), atlasId=_null_text, bindingId=_null_text,
                        aliases=_one([]), mobility=_one("unknown"), networkBound=_one(False),
                        networkStates=_one([]), networkRelations=_one([])))
    _need((value["workspaceId"], value["homeId"]) == scope)
    source = value["source"]
    key = json.dumps([source[k] for k in ("sourceInstanceId", "collectionId", "sourceKind", "externalId")],
                     ensure_ascii=False, separators=(",", ":"))
    _need(value["key"] == key and value["entity"]["id"] == source["externalId"])
    for link in value["nativeLinks"]:
        ref = link["entity"]
        _need((ref["workspaceId"], ref["homeId"]) == scope and ref["key"] == source)


def _cache(value, scope):
    _need(type(value) is dict)
    common = dict(owner=_nullable(_one("homebox", "network", "magicplan")),
                  status=_one(*_STATUS), displayStatus=_one(*_STATUS))
    if set(value) == set(common):
        _object(value, common)
        _need(value["status"] == value["displayStatus"] == "access-revoked")
        return
    _object(value, dict(common, schemaVersion=_one(1), workspaceId=_uuid, homeId=_uuid,
                        sourceInstanceId=_text, collectionId=_text,
                        lastSuccessfulFetchAt=_null_text, lastAttemptAt=_null_text,
                        generationId=_null_text, consistency=_text,
                        error=_nullable(_record(code=_text, at=_text))))
    _need((value["workspaceId"], value["homeId"]) == scope)


def _view(value, scope):
    _object(value, dict(status=_one("ready"), scope=_scope, homeLabel=_text, now=_text, canEdit=_bool,
                        homes=_list(_record(workspaceId=_uuid, homeId=_uuid, label=_text)),
                        entries=_list(lambda v: _entry(v, scope)),
                        caches=_list(lambda v: _cache(v, scope)),
                        sourceDocumentsService=_record(profile=_one("houseatlas.geodata-document-read.v2"),
                                                       available=_bool),
                        modelOverviewService=_record(profile=_one("houseatlas.model-overview-read.v1"),
                                                     available=_bool, publicationId=_null_uuid,
                                                     manifestSha256=_nullable(_sha))))
    _need((value["scope"]["workspaceId"], value["scope"]["homeId"]) == scope)
    homes = [(h["workspaceId"], h["homeId"]) for h in value["homes"]]
    _need(scope in homes and len(set(homes)) == len(homes))
    keys = [entry["key"] for entry in value["entries"]]
    _need(len(set(keys)) == len(keys))
    selected = value["modelOverviewService"]
    _need(selected["available"] == (selected["publicationId"] is not None) ==
          (selected["manifestSha256"] is not None))
    return selected


def _geometry(value):
    """Check complete companion structure; native geometry admission stays compiled."""
    _record(units=_one("m"), upAxis=_one("Y"), horizontalAxes=_one(["X", "Z"]),
            geometryPlacement=_one("gltf-world-after-node-transforms-once"),
            physicalRegistration=_one(None))(value["frame"])
    _list(_record(buildingId=_opaque, label=_text, nativePlaceId=_null_uuid, bounds=_bounds,
                  levelIds=_list(_opaque, 64)), 128)(value["buildings"])
    _need(bool(value["buildings"]))
    _list(_record(levelId=_opaque, buildingId=_opaque, label=_text, nativePlaceId=_null_uuid,
                  sourceElevationM=_nullable(_number), elevationBasis=_null_text,
                  occurrenceIds=_list(_opaque, 4096), bounds=_bounds), 64)(value["levels"])
    _list(_record(roomId=_opaque, buildingId=_opaque, label=_text, nativePlaceId=_null_uuid,
                  nativeBinding=_record(status=_one("reviewed", "historical", "unmapped"),
                                        receiptSha256=_nullable(_sha)),
                  occurrenceIds=_list(_opaque, 4096)), 2048)(value["rooms"])
    _list(_record(spaceOccurrenceId=_opaque, roomId=_opaque, buildingId=_opaque, levelId=_opaque,
                  bounds=_bounds, planFeatureIds=_list(_opaque, 8192),
                  geometryBasis=_record(kind=_one("source-model", "owner-estimated-pick-proxy"),
                                        sourceRef=_null_text, note=_null_text)), 4096)(value["occurrences"])
    _list(_record(artifactId=_one("model"), nodeIndex=_integer, meshIndex=_integer,
                  primitiveIndices=_list(_integer, 8192), buildingId=_opaque,
                  levelIds=_list(_opaque, 64), spaceOccurrenceId=_nullable(_opaque),
                  role=_one("structure", "roof", "slab", "room-pick", "context")), 8192)(value["meshBindings"])
    polygon = _record(outer=_list(_tuple(_number, 2)), holes=_list(_list(_tuple(_number, 2))))
    feature = _record(featureId=_opaque, roomId=_nullable(_opaque), spaceOccurrenceId=_nullable(_opaque),
                      role=_text, polygons=_list(polygon))
    _list(_record(planId=_opaque, buildingId=_opaque, levelId=_opaque, coordinates=_text,
                  featureIds=_list(_opaque), features=_list(feature)), 64)(value["plans"])

    def anchor(v):
        _need(type(v) is dict)
        if v.get("kind") == "room-summary":
            _object(v, dict(kind=_one("room-summary")))
        else:
            _object(v, dict(kind=_one("source-position"), position=_tuple(_number, 3), basis=_text))
    _list(_record(publicationId=_uuid, kind=_text, sourceRevision=_text,
                  sourceUpdatedAt=_null_text, retrievedAt=_null_text, roomId=_opaque,
                  spaceOccurrenceId=_nullable(_opaque), nativePlaceId=_null_uuid,
                  recordIds=_list(_text), anchor=anchor), 8192)(value["overlayBindings"])
    _record(selectableOccurrences=_list(_opaque, 4096), unselectableOccurrences=_list(_opaque, 4096),
            exclusions=_list(_text))(value["coverage"])


@dataclass(frozen=True)
class PinnedApplicationDocuments:
    """Exact owner-qualified raw config documents, never caller protocol input."""
    overview: bytes | None
    semantics: bytes | None
    room_links: bytes | None


class EstablishedApplicationReadiness:
    def __init__(self, established_bridge, transport, documents: PinnedApplicationDocuments):
        try:
            _need(type(transport) is EstablishedNativeReadTransport and
                  transport._bridge is established_bridge and type(documents) is PinnedApplicationDocuments)
            for raw, limit in zip((documents.overview, documents.semantics, documents.room_links), _LIMITS):
                _need(raw is None or (type(raw) is bytes and 0 < len(raw) <= limit))
            _need(documents.semantics is None or documents.overview is not None)
            _need(documents.room_links is None or documents.semantics is not None)
            self._transport, self._documents = transport, documents
        except Exception:
            raise UpdateError("health-failed") from None

    def read(self, request: ReadinessRequest, deadline: float) -> NativeReadiness:
        try:
            _need(type(request) is ReadinessRequest and type(request.expected) is ApplicationExpectations)
            with self._transport.attempt(deadline=deadline) as attempt:
                result = self._read(request, attempt)
                attempt.guard()
                return result
        except Exception:
            raise UpdateError("health-failed") from None

    @staticmethod
    def _json(raw, attempt):
        attempt.guard()
        # Scan before the parser: strings/escapes are respected, nesting and
        # token counts bounded before recursive parsing/Decimal allocation.
        depth = nodes = 0
        quoted = escaped = False
        for index, byte in enumerate(raw):
            if index % 65536 == 0:
                attempt.guard()
            if quoted:
                if escaped:
                    escaped = False
                elif byte == 92:
                    escaped = True
                elif byte == 34:
                    quoted = False
            elif byte == 34:
                quoted = True
                nodes += 1
            elif byte in (91, 123):
                depth += 1
                nodes += 1
                _need(depth <= 48)
            elif byte in (93, 125):
                depth -= 1
                _need(depth >= 0)
            elif byte == 44:
                nodes += 1
            _need(nodes <= 500000)
        _need(depth == 0 and not quoted)

        def pairs(items):
            result = {}
            for key, value in items:
                _need(key not in result)
                result[key] = value
            return result

        def number(token):
            _need(len(token) <= 4096)
            value = Decimal(token)
            _need(value.is_finite() and abs(value.adjusted()) <= 4096)
            return value

        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_float=number,
                           parse_int=lambda t: int(t) if len(t) <= 20 else number(t),
                           parse_constant=lambda _: _need(False))
        attempt.guard()
        # Validate escaped Unicode too; UTF-8 decoding alone cannot reject
        # unpaired surrogate escapes. This also bounds comparison work.
        def walk(v):
            if type(v) is dict:
                for key, item in v.items():
                    _text(key)
                    walk(item)
            elif type(v) is list:
                for item in v:
                    walk(item)
            elif type(v) is str:
                _text(v)
        walk(value)
        attempt.guard()
        return value

    @staticmethod
    def _same(left, right, attempt):
        attempt.guard()
        if type(left) is dict and type(right) is dict:
            _need(left.keys() == right.keys())
            for key in left:
                EstablishedApplicationReadiness._same(left[key], right[key], attempt)
        elif type(left) is list and type(right) is list:
            _need(len(left) == len(right))
            for a, b in zip(left, right):
                EstablishedApplicationReadiness._same(a, b, attempt)
        else:
            numeric = type(left) in (int, Decimal) and type(right) in (int, Decimal)
            _need((numeric or type(left) is type(right)) and left == right)

    def _get(self, attempt, route, limit):
        with attempt.open(route) as response:
            raw = bytearray()
            while True:
                part = response.read(min(65536, limit + 1 - len(raw)))
                if not part:
                    break
                _need(len(raw) + len(part) <= limit)
                raw.extend(part)
            headers = dict(response.headers)
        attempt.guard()
        return self._json(bytes(raw), attempt), headers, bytes(raw)

    def _session(self, attempt):
        value, _, _ = self._get(attempt, FixedRead("session"), 16384)
        _object(value, dict(schemaVersion=_one(1), actorId=_uuid, csrfToken=_text, expiresAt=_text))
        _need(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})",
                           value["expiresAt"]) is not None)
        expiry = datetime.fromisoformat(value["expiresAt"].replace("Z", "+00:00")).timestamp()
        transport = self._transport
        _need(value["actorId"] == transport._actor and value["csrfToken"] == transport._csrf and
              expiry == transport._expiry)
        attempt.guard()
        return value

    def _pins(self, expected, attempt):
        documents = self._documents
        flags = tuple(raw is not None for raw in (documents.overview, documents.semantics, documents.room_links))
        _need(all(type(v) is bool for v in (expected.model_configured, expected.scene_configured,
                                          expected.room_links_configured)))
        _need(flags == (expected.model_configured, expected.scene_configured, expected.room_links_configured))
        _need(type(expected.scope) is tuple and len(expected.scope) == 2 and
              expected.scope == self._transport._scope)
        overview = semantics = links = None
        if documents.overview is not None:
            _need(_hash(documents.overview) == expected.overview_manifest_sha256)
            overview = self._json(documents.overview, attempt)
            _object(overview, dict(profile=_one("houseatlas.model-overview-publication.v1"), scope=_scope,
                                   publicationId=_uuid, label=_text, qualification=_one("provisional-overview"),
                                   frame=_record(linearUnit=_one("m"), upAxis=_one("Y"),
                                                 placement=_one("baked-in-asset"), physicalRegistration=_one(None)),
                                   components=_list(_record(id=_text, kind=_one("building", "plot", "context"),
                                                            label=_text), 256), sourceNote=_null_text,
                                   original=_record(file=_one("overview.glb"), contentType=_one("model/gltf-binary"),
                                                    sha256=_sha, bytes=_integer)))
            _need(overview["scope"] == dict(zip(("workspaceId", "homeId"), expected.scope)) and
                  overview["publicationId"] == expected.publication_id and
                  overview["original"]["sha256"] == expected.model_sha256 and
                  type(expected.model_bytes) is int and
                  overview["original"]["bytes"] == expected.model_bytes and 0 < expected.model_bytes <= 32 * 1024 * 1024)
        else:
            _need(all(v is None for v in (expected.publication_id, expected.overview_manifest_sha256,
                                         expected.model_sha256, expected.model_bytes)))
        if documents.semantics is not None:
            _need(_hash(documents.semantics) == expected.semantics_sha256)
            semantics = self._json(documents.semantics, attempt)
            fields = dict(profile=_one("houseatlas.unified-atlas-publication.v1"), scope=_scope,
                          publicationId=_uuid, sourceRevisionId=_opaque, sourceSha256=_sha,
                          original=_record(sha256=_sha, bytes=_integer))
            fields.update({key: lambda _: None for key in _GEOMETRY})
            _object(semantics, fields)
            _geometry(semantics)
            _need(semantics["scope"] == overview["scope"] and semantics["publicationId"] == overview["publicationId"] and
                  semantics["original"] == {k: overview["original"][k] for k in ("sha256", "bytes")} and
                  semantics["sourceRevisionId"] == expected.source_revision_id and
                  semantics["sourceSha256"] == expected.source_sha256)
        else:
            _need(all(v is None for v in (expected.semantics_sha256, expected.source_revision_id, expected.source_sha256)))
        if documents.room_links is not None:
            _need(_hash(documents.room_links) == expected.room_links_sha256)
            links = self._json(documents.room_links, attempt)
            _object(links, dict(profile=_one("houseatlas.unified-atlas-room-links.v1"), workspaceId=_uuid,
                               homeId=_uuid, publicationId=_uuid, semanticsSha256=_sha,
                               links=_list(_record(roomId=_opaque, nativePlaceId=_uuid, packagePlaceKey=_opaque,
                                                   packagePlaceUuid=_uuid), 2048)))
            _need((links["workspaceId"], links["homeId"]) == expected.scope and
                  links["publicationId"] == overview["publicationId"] and
                  links["semanticsSha256"] == _hash(documents.semantics))
            rooms, triples = set(), set()
            scene_rooms = {room["roomId"]: room["nativePlaceId"] for room in semantics["rooms"]}
            _need(len(scene_rooms) == len(semantics["rooms"]))
            for link in links["links"]:
                triple = tuple(link[k] for k in ("nativePlaceId", "packagePlaceKey", "packagePlaceUuid"))
                _need(link["roomId"] not in rooms and triple not in triples and
                      scene_rooms.get(link["roomId"]) == link["nativePlaceId"])
                rooms.add(link["roomId"])
                triples.add(triple)
        else:
            _need(expected.room_links_sha256 is None)
        attempt.guard()
        return overview, semantics, links

    def _read(self, request, attempt):
        expected, scope = request.expected, self._transport._scope
        overview, semantics, links = self._pins(expected, attempt)
        first_session = self._session(attempt)
        view, _, _ = self._get(attempt, FixedRead("view"), 2 * 1024 * 1024)
        availability = _view(view, scope)
        _need(availability["available"] == (overview is not None))
        observed_overview = observed_scene = None
        revision = model_revision = links_revision = content_type = content_digest = None
        model_sha = model_bytes = map_sha = None
        base = f"/api/atlas/models/v1/workspaces/{scope[0]}/homes/{scope[1]}"

        def read_overview():
            value, _, _ = self._get(attempt, FixedRead("overview"), _LIMITS[0])
            projection = {k: overview[k] for k in ("scope", "publicationId", "label", "qualification", "frame", "components", "sourceNote")}
            projection.update(profile="houseatlas.model-overview-read.v1", manifestSha256=_hash(self._documents.overview))
            projection["original"] = {k: overview["original"][k] for k in ("contentType", "sha256", "bytes")}
            projection["original"]["href"] = base + f"/overview/{overview['publicationId']}/original?expectedSha256={overview['original']['sha256']}"
            self._same(value, projection, attempt)
            return value

        def read_scene():
            value, headers, _ = self._get(attempt, FixedRead("scene", sha256=observed_overview["manifestSha256"]),
                                          _LIMITS[1] + 256 * 1024)
            token = headers.get("x-atlas-selection-revision")
            _sha(token)
            _need(headers.get("x-atlas-overview-manifest-sha256") == observed_overview["manifestSha256"])
            entry = headers.get("x-atlas-entry-building-id")
            _need(entry is None or any(b["buildingId"] == entry for b in semantics["buildings"]))
            projection = {k: semantics[k] for k in _GEOMETRY}
            projection.update(profile="houseatlas.unified-atlas-scene.v1", scope=semantics["scope"],
                              selection=dict(revision=token, publicationId=semantics["publicationId"]),
                              publication={k: semantics[k] for k in ("publicationId", "sourceRevisionId", "sourceSha256")})
            projection["publication"]["semanticsSha256"] = _hash(self._documents.semantics)
            original = overview["original"]
            projection["artifacts"] = [dict(artifactId="model", role="model", contentType=original["contentType"],
                                            bytes=original["bytes"], sha256=original["sha256"],
                                            href=base + f"/atlas/{overview['publicationId']}/artifacts/model?expectedSha256={original['sha256']}&expectedSelectionRevision={token}")]
            self._same(value, projection, attempt)
            return value, token, entry

        if overview is not None:
            observed_overview = read_overview()
            _need(availability["publicationId"] == observed_overview["publicationId"] and
                  availability["manifestSha256"] == observed_overview["manifestSha256"])
            if semantics is not None:
                observed_scene, revision, entry = read_scene()
            original = observed_overview["original"]
            route = FixedRead("scene-model" if semantics is not None else "overview-model",
                              observed_overview["publicationId"], original["sha256"], revision)
            with attempt.open(route) as response:
                headers = response.headers
                content_type, content_digest = headers.get("content-type"), headers.get("content-digest")
                _need(content_type == "model/gltf-binary" and headers.get("content-length") == str(original["bytes"]) and
                      content_digest == _digest(original["sha256"]))
                model_revision = headers.get("x-atlas-selection-revision")
                if semantics is not None:
                    _need(model_revision == revision)
                else:
                    _need(model_revision is None)
                    frame = dict(profile="houseatlas.model-overview-bytes.v1", scope=observed_overview["scope"],
                                 publicationId=observed_overview["publicationId"], manifestSha256=observed_overview["manifestSha256"],
                                 original={k: original[k] for k in ("contentType", "sha256", "bytes")})
                    # Only UUID/digest/MIME strings and a bounded integer occur
                    # here, so sorted compact UTF-8 is exactly this JCS subset.
                    canonical = json.dumps(frame, sort_keys=True, separators=(",", ":")).encode()
                    encoded = base64.urlsafe_b64encode(canonical).rstrip(b"=").decode("ascii")
                    _need(headers.get("x-atlas-model-frame") == encoded)
                sha, model_bytes = hashlib.sha256(), 0
                while True:
                    part = response.read(65536)
                    if not part:
                        break
                    sha.update(part)
                    model_bytes += len(part)
                    _need(model_bytes <= original["bytes"])
                    attempt.guard()
                model_sha = sha.hexdigest()
                _need(model_sha == original["sha256"] and model_bytes == original["bytes"])
            if links is not None:
                value, headers, raw = self._get(attempt, FixedRead("room-links", observed_overview["publicationId"],
                                                                 observed_scene["publication"]["semanticsSha256"], revision), _LIMITS[2])
                map_sha = _hash(raw)
                links_revision = headers.get("x-atlas-selection-revision")
                _need(raw == self._documents.room_links and map_sha == expected.room_links_sha256 and
                      links_revision == revision and headers.get("content-length") == str(len(raw)) and
                      headers.get("content-digest") == _digest(map_sha))
                self._same(value, links, attempt)
            if semantics is not None:
                after_scene, after_revision, after_entry = read_scene()
                _need(after_revision == revision and after_entry == entry)
                self._same(after_scene, observed_scene, attempt)
            self._same(read_overview(), observed_overview, attempt)
        after_view, _, _ = self._get(attempt, FixedRead("view"), 2 * 1024 * 1024)
        self._same(_view(after_view, scope), availability, attempt)
        self._same(self._session(attempt), first_session, attempt)
        attempt.guard()
        publication = observed_scene["publication"] if observed_scene is not None else None
        return NativeReadiness(
            request=request, scope=(view["scope"]["workspaceId"], view["scope"]["homeId"]),
            model_configured=availability["available"], scene_configured=observed_scene is not None,
            room_links_configured=map_sha is not None,
            publication_id=observed_overview["publicationId"] if observed_overview else None,
            overview_manifest_sha256=observed_overview["manifestSha256"] if observed_overview else None,
            model_sha256=model_sha, model_bytes=model_bytes, model_content_type=content_type,
            model_content_digest=content_digest,
            source_revision_id=publication["sourceRevisionId"] if publication else None,
            source_sha256=publication["sourceSha256"] if publication else None,
            semantics_sha256=publication["semanticsSha256"] if publication else None,
            room_links_sha256=map_sha, selection_revision=revision, model_selection_revision=model_revision,
            source_selection_revision=observed_scene["selection"]["revision"] if observed_scene else None,
            room_links_selection_revision=links_revision)
