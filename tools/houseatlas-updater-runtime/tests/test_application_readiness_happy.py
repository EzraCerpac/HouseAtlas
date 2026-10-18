"""One finite generated successful application read; no real I/O or imports of fixtures."""

import base64
from datetime import datetime, timezone
import errno
import hashlib
import json
from pathlib import Path
import socket
import ssl
import struct
from types import SimpleNamespace
import unittest
from urllib.parse import urlsplit

from houseatlas_updater_runtime.application_readiness import (
    EstablishedApplicationReadiness, PinnedApplicationDocuments,
)
from houseatlas_updater_runtime.established_native_http import EstablishedNativeReadTransport
from houseatlas_updater_runtime.runtime import (
    ApplicationExpectations, HealthProbe, NativeReadiness, Process, ReadinessRequest,
)


def encoded(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(raw):
    return "sha-256=:" + base64.b64encode(hashlib.sha256(raw).digest()).decode() + ":"


class GeneratedClock:
    def __init__(self):
        self.value = 100.0

    def clock(self):
        self.value += 0.000001
        return self.value

    def wall(self):
        return 1_000_000.0 + self.value


class GeneratedStream:
    def __init__(self, body, content_type, extra):
        self.wire = ("HTTP/1.1 200 OK\r\nContent-Type: " + content_type +
                     "\r\nCache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\n" +
                     f"Content-Length: {len(body)}\r\n" +
                     "".join(f"{key}: {value}\r\n" for key, value in extra.items()) + "\r\n").encode() + body
        self.offset, self.sent, self.waits = 0, bytearray(), []
        self.closed, self.blocking = False, None
        self.handshakes, self.send_pending, self.read_pending = 0, True, True

    def setblocking(self, value):
        assert value is False
        self.blocking = value

    def connect_ex(self, endpoint):
        self.endpoint = endpoint
        return errno.EINPROGRESS

    def getsockopt(self, level, option):
        assert (level, option) == (socket.SOL_SOCKET, socket.SO_ERROR)
        return 0

    def do_handshake(self):
        self.handshakes += 1
        if self.handshakes == 1:
            raise ssl.SSLWantReadError()
        if self.handshakes == 2:
            raise ssl.SSLWantWriteError()

    def selected_alpn_protocol(self):
        return "http/1.1"

    def send(self, data):
        if self.send_pending:
            self.send_pending = False
            raise BlockingIOError(errno.EAGAIN, "generated ordinary writable progression")
        count = min(len(data), 31)
        self.sent.extend(data[:count])
        return count

    def recv(self, size):
        if self.read_pending:
            self.read_pending = False
            raise BlockingIOError(errno.EAGAIN, "generated ordinary readable progression")
        end = min(self.offset + size, self.offset + 97, len(self.wire))
        value, self.offset = self.wire[self.offset:end], end
        return value

    def close(self):
        self.closed = True


class ApplicationReadinessHappyPaths(unittest.TestCase):
    def test_established_scope_model_scene_and_room_links(self):
        workspace, home, actor, publication, native_place, package_place = [
            f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 7)]
        scope = dict(workspaceId=workspace, homeId=home)
        origin = "https://native.example.invalid:8443"
        revision, source_sha = "b" * 64, "c" * 64
        clock, expiry = GeneratedClock(), 1_001_000.0
        cookie, csrf = "__Host-houseatlas-session=generated_original_token_123456", "generated-original-csrf"

        def forbidden(*args, **kwargs):
            raise AssertionError("No exchange, login, session preparation, journal or logout")

        owner = SimpleNamespace(origin=origin, url=urlsplit(origin), cookie=cookie, csrf=csrf,
                                exchange=forbidden, login=forbidden, logout=forbidden)
        bridge = SimpleNamespace(owner=owner, actor=actor, scope=scope.copy(), csrf=csrf,
                                 session_expiry=expiry, session=forbidden, prepare_session=forbidden,
                                 close_session=forbidden, journal=SimpleNamespace(bind=forbidden))
        owner_before, bridge_before = vars(owner).copy(), vars(bridge).copy()
        scope_before = bridge.scope.copy()

        # Entirely generated minimal self-contained GLB v2. No native artifact,
        # household input, compiler, renderer or native admission is invoked.
        gltf = encoded(dict(asset={"version": "2.0"}, nodes=[], meshes=[],
                            scenes=[{"nodes": []}], scene=0, buffers=[{"byteLength": 1}],
                            bufferViews=[], accessors=[]))
        gltf += b" " * (-len(gltf) % 4)
        model = (b"glTF" + struct.pack("<II", 2, 20 + len(gltf) + 12) +
                 struct.pack("<II", len(gltf), 0x4E4F534A) + gltf +
                 struct.pack("<II", 4, 0x004E4942) + b"\x00" * 4)
        overview = dict(profile="houseatlas.model-overview-publication.v1", scope=scope,
                        publicationId=publication, label="Generated overview", qualification="provisional-overview",
                        frame=dict(linearUnit="m", upAxis="Y", placement="baked-in-asset", physicalRegistration=None),
                        components=[dict(id="building-1", kind="building", label="Generated building")],
                        sourceNote="Generated source; no physical registration",
                        original=dict(file="overview.glb", contentType="model/gltf-binary", sha256=sha(model), bytes=len(model)))
        semantics = dict(profile="houseatlas.unified-atlas-publication.v1", scope=scope,
                         publicationId=publication, sourceRevisionId="generated-source-1", sourceSha256=source_sha,
                         original=dict(sha256=sha(model), bytes=len(model)),
                         frame=dict(units="m", upAxis="Y", horizontalAxes=["X", "Z"],
                                    geometryPlacement="gltf-world-after-node-transforms-once", physicalRegistration=None),
                         buildings=[dict(buildingId="building-1", label="Generated building", nativePlaceId=None,
                                         bounds=dict(min=[0, 0, 0], max=[2, 2, 2]), levelIds=[])], levels=[],
                         rooms=[dict(roomId="room-1", buildingId="building-1", label="Generated documentary room",
                                     nativePlaceId=native_place,
                                     nativeBinding=dict(status="historical", receiptSha256=None), occurrenceIds=[])],
                         occurrences=[], meshBindings=[], plans=[], overlayBindings=[],
                         coverage=dict(selectableOccurrences=[], unselectableOccurrences=[], exclusions=[]))
        overview_raw, semantics_raw = encoded(overview), encoded(semantics)
        links = dict(profile="houseatlas.unified-atlas-room-links.v1", workspaceId=workspace, homeId=home,
                     publicationId=publication, semanticsSha256=sha(semantics_raw),
                     links=[dict(roomId="room-1", nativePlaceId=native_place, packagePlaceKey="generated-package-room",
                                 packagePlaceUuid=package_place)])
        links_raw = encoded(links)
        documents = PinnedApplicationDocuments(overview_raw, semantics_raw, links_raw)
        expected = ApplicationExpectations((workspace, home), True, True, True, publication, sha(overview_raw),
                                           sha(model), len(model), "generated-source-1", source_sha,
                                           sha(semantics_raw), sha(links_raw))
        process = Process(1234, b"generated-full-birth", Path("/generated/houseatlas"),
                          ("/generated/houseatlas", "serve"), b"generated-existing-job")
        nonce = object()
        request = ReadinessRequest(process, nonce, expected)

        source = dict(sourceInstanceId="generated-source", collectionId="generated-collection",
                      sourceKind="homebox-entity", externalId="item-1")
        entry = dict(schemaVersion=1, workspaceId=workspace, homeId=home, source=source,
                     sourceUpdatedAt=None, retrievedAt="2026-01-01T00:00:00Z",
                     entity=dict(id="item-1", name="Generated item", description="", entityType=None,
                                 parent=None, archived=False, quantity="1.2500e+0", manufacturer=None,
                                 modelNumber=None, serialNumber=None, notes=None),
                     attachments=[dict(kind="stored-file", attachmentId="generated-file", title="Generated attachment",
                                       contentType="image/png", byteSize="1.00e+2", downloadHref=None, previewHref=None),
                                  dict(kind="external-link", attachmentId="generated-link", title="Generated reference",
                                       url=None, archived=False)],
                     maintenance=[dict(entryId="generated-maintenance", name="Generated reminder", description="",
                                       scheduledDate=None, completedDate=None, cost="2.000")], nativeLinks=[],
                     key=json.dumps(list(source.values()), separators=(",", ":")), kind="unknown",
                     semanticKind="unclassified", sourceState="unreviewed", cacheStatus="stale", atlasId=None,
                     bindingId=None, aliases=[], mobility="unknown", networkBound=False, networkStates=[], networkRelations=[])
        view = dict(status="ready", scope=scope, homeLabel="Generated home", now="2026-01-02T00:00:00Z", canEdit=False,
                    homes=[dict(scope, label="Generated home")], entries=[entry],
                    caches=[dict(schemaVersion=1, workspaceId=workspace, homeId=home,
                                 sourceInstanceId=source["sourceInstanceId"], collectionId=source["collectionId"],
                                 status="stale", displayStatus="stale", lastSuccessfulFetchAt="2026-01-01T00:00:00Z",
                                 lastAttemptAt="2026-01-01T00:00:00Z", generationId="generated-generation",
                                 consistency="generated-retained", error=None, owner="homebox")],
                    sourceDocumentsService=dict(profile="houseatlas.geodata-document-read.v2", available=False),
                    modelOverviewService=dict(profile="houseatlas.model-overview-read.v1", available=True,
                                              publicationId=publication, manifestSha256=sha(overview_raw)))
        session = dict(schemaVersion=1, actorId=actor, csrfToken=csrf,
                       expiresAt=datetime.fromtimestamp(expiry, timezone.utc).isoformat().replace("+00:00", "Z"))
        base = f"/api/atlas/models/v1/workspaces/{workspace}/homes/{home}"
        overview_wire = {k: overview[k] for k in ("scope", "publicationId", "label", "qualification", "frame", "components", "sourceNote")}
        overview_wire.update(profile="houseatlas.model-overview-read.v1", manifestSha256=sha(overview_raw))
        overview_wire["original"] = {k: overview["original"][k] for k in ("contentType", "sha256", "bytes")}
        overview_wire["original"]["href"] = base + f"/overview/{publication}/original?expectedSha256={sha(model)}"
        scene_wire = {k: semantics[k] for k in ("frame", "buildings", "levels", "rooms", "occurrences", "meshBindings", "plans", "overlayBindings", "coverage")}
        model_path = base + f"/atlas/{publication}/artifacts/model?expectedSha256={sha(model)}&expectedSelectionRevision={revision}"
        scene_wire.update(profile="houseatlas.unified-atlas-scene.v1", scope=scope,
                          selection=dict(revision=revision, publicationId=publication),
                          publication=dict(publicationId=publication, sourceRevisionId="generated-source-1",
                                           sourceSha256=source_sha, semanticsSha256=sha(semantics_raw)),
                          artifacts=[dict(artifactId="model", role="model", contentType="model/gltf-binary",
                                          bytes=len(model), sha256=sha(model), href=model_path)])
        scene_path = base + "/atlas?expectedManifestSha256=" + sha(overview_raw)
        scene_headers = {"X-Atlas-Selection-Revision": revision,
                         "X-Atlas-Overview-Manifest-Sha256": sha(overview_raw),
                         "X-Atlas-Entry-Building-Id": "building-1"}
        sequence = [
            ("/api/atlas/auth/session", session, {}),
            (f"/api/atlas/v1/workspaces/{workspace}/homes/{home}/view", view, {}),
            (base + "/overview", overview_wire, {}),
            (scene_path, scene_wire, scene_headers),
            (model_path, model, {"Content-Digest": digest(model), "X-Atlas-Selection-Revision": revision}),
            (base + f"/atlas/{publication}/room-links?expectedSemanticsSha256={sha(semantics_raw)}&expectedSelectionRevision={revision}",
             links, {"Content-Digest": digest(links_raw), "X-Atlas-Selection-Revision": revision}),
            (scene_path, scene_wire, scene_headers),
            (base + "/overview", overview_wire, {}),
            (f"/api/atlas/v1/workspaces/{workspace}/homes/{home}/view", view, {}),
            ("/api/atlas/auth/session", session, {}),
        ]
        streams = [GeneratedStream(body if type(body) is bytes else encoded(body),
                                   "model/gltf-binary" if type(body) is bytes else "application/json", headers)
                   for _, body, headers in sequence]
        pending, timeouts, hostnames = iter(streams), [], []

        def socket_factory(family, kind):
            self.assertEqual((family, kind), (socket.AF_INET, socket.SOCK_STREAM))
            return next(pending)

        def wait(readers, writers, exceptional, timeout):
            self.assertGreater(timeout, 0)
            timeouts.append(timeout)
            (writers or readers)[0].waits.append("write" if writers else "read")
            clock.value += 0.0001
            return readers, writers, []

        def wrap(stream, *, server_hostname, do_handshake_on_connect, suppress_ragged_eofs):
            self.assertFalse(do_handshake_on_connect)
            self.assertFalse(suppress_ragged_eofs)
            hostnames.append(server_hostname)
            return stream

        # TLS policy object only; private wrap fixture performs no real TLS.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        transport = EstablishedNativeReadTransport(bridge, "192.0.2.2", context, _socket_factory=socket_factory,
                                                  _wait=wait, _monotonic=clock.clock, _wall=clock.wall, _wrap_socket=wrap)
        reader = EstablishedApplicationReadiness(bridge, transport, documents)
        self.assertTrue(all(not stream.sent for stream in streams))
        deadline = clock.clock() + 30
        evidence = reader.read(request, deadline)
        self.assertIs(type(evidence), NativeReadiness)
        self.assertIs(evidence.request, request)
        self.assertIs(evidence.request.nonce, nonce)
        self.assertIs(evidence.request.process, process)
        for name in vars(expected):
            self.assertEqual(getattr(evidence, name), getattr(expected, name))
        self.assertEqual(evidence.model_content_type, "model/gltf-binary")
        self.assertEqual(evidence.model_content_digest, digest(model))
        self.assertEqual((evidence.selection_revision, evidence.model_selection_revision,
                          evidence.source_selection_revision, evidence.room_links_selection_revision), (revision,) * 4)
        # Exercise the actual HealthProbe typed-evidence contract, without its
        # service/process/native verify operation or any platform operation.
        artifacts = [SimpleNamespace(sha256=sha(raw), byte_size=len(raw))
                     for raw in (overview_raw, model, semantics_raw, links_raw)]
        launcher = SimpleNamespace(operations=SimpleNamespace(readiness=reader.read),
                                   inspector=SimpleNamespace(policy=SimpleNamespace(artifacts=artifacts)))
        HealthProbe(launcher, expected)._application(evidence, request)
        for (path, body, _), stream in zip(sequence, streams):
            mime = "model/gltf-binary" if type(body) is bytes else "application/json"
            wanted = (f"GET {path} HTTP/1.1\r\nHost: native.example.invalid:8443\r\nAccept: {mime}\r\n"
                      f"Origin: {origin}\r\nReferer: {origin}/\r\nSec-Fetch-Site: same-origin\r\n"
                      f"Cache-Control: no-store\r\nAccept-Encoding: identity\r\nCookie: {cookie}\r\n\r\n").encode()
            self.assertEqual(bytes(stream.sent), wanted)
            self.assertEqual(stream.endpoint, ("192.0.2.2", 8443))
            self.assertEqual(stream.waits, ["write", "read", "write", "write", "read"])
            self.assertEqual(stream.offset, len(stream.wire))
            self.assertTrue(stream.closed)
        self.assertEqual(len(streams), 10)
        self.assertEqual(hostnames, ["native.example.invalid"] * 10)
        self.assertEqual(timeouts, sorted(timeouts, reverse=True))
        self.assertLess(clock.value, deadline)
        self.assertEqual(vars(owner), owner_before)
        self.assertEqual(vars(bridge), bridge_before)
        self.assertEqual(bridge.scope, scope_before)


if __name__ == "__main__":
    unittest.main()
