"""Build an immutable, source-bound IFC publication from a pinned converter.

The converter interface is intentionally small: --ifc, --config, --glb, and
--floorplan. It must write a closed IFC-derived GLB and floorplan JSON. This
publisher validates and repeats the conversion before publishing any bytes.
It never selects a publication for live use.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
import uuid
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape, quoteattr

from extract_identity import extract, storey_elevations, IdentityExtractionError

PROFILE = "houseatlas.ifc-publication.v1"
GLB_PROFILE = "houseatlas.ifc-derived-glb.v1"
PLAN_PROFILE = "houseatlas.ifc-floorplan.v1"
SVG_PROFILE = "houseatlas.ifc-floorplan-svg.v1"
SEMANTIC_PROFILE = "houseatlas.ifc-semantics.v1"
PROFILE_V2 = "houseatlas.ifc-publication.v2"
PLAN_PROFILE_V2 = "houseatlas.ifc-floorplan.v2"
SVG_PROFILE_V2 = "houseatlas.ifc-floorplan-svg.v2"
SEMANTIC_PROFILE_V2 = "houseatlas.ifc-semantics.v2"
MAX_IFC = 10 * 1024 * 1024
MAX_GLB = 8 * 1024 * 1024
MAX_PLAN = 2 * 1024 * 1024
SHA = re.compile(r"[0-9a-f]{64}\Z")
GLOBAL_ID = re.compile(r"[0-3][0-9A-Za-z_$]{21}\Z")


class PublicationError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PublicationError(message)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def strict_load(data: bytes) -> Any:
    def pairs(rows: list[tuple[str, Any]]) -> dict:
        result = {}
        for key, value in rows:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(
                          PublicationError("non-finite JSON number")))


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                       allow_nan=False) + "\n").encode("utf-8")


def source_jcs(value: dict) -> bytes:
    # SourceRevision has only string, integer and null leaves, with fixed ASCII
    # property names. This is the serde_jcs byte form used by the source ledger.
    def has_float(item: Any) -> bool:
        if isinstance(item, dict): return any(has_float(v) for v in item.values())
        if isinstance(item, list): return any(has_float(v) for v in item)
        return type(item) is float
    require(not has_float(value), "source JCS numbers")
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def object_keys(value: Any, required: set[str], optional: set[str] = frozenset()) -> dict:
    require(isinstance(value, dict) and required <= value.keys()
            and value.keys() <= required | optional, "unexpected object shape")
    return value


def id_string(value: Any) -> str:
    require(isinstance(value, str), "UUID must be a string")
    parsed = uuid.UUID(value)
    require(str(parsed) == value, "UUID must be canonical")
    return value


def file_hash(path: Path, max_bytes: int) -> tuple[bytes, str]:
    require(path.is_file() and not path.is_symlink(), "missing or linked input")
    require(0 < path.stat().st_size <= max_bytes, "input exceeds byte budget")
    data = path.read_bytes()
    return data, sha(data)


def check_source(source: dict, ifc: bytes, ifc_hash: str) -> None:
    object_keys(source, {"profile", "scope", "sourceId", "revisionId", "parentRevisionId",
                         "ifcAsset", "authoringTool", "declaredUnits", "declaredUpAxis",
                         "semanticMapRevisionId", "semanticMapSha256"})
    require(source["profile"] == "houseatlas.ifc-source-revision.v1", "source profile")
    scope = object_keys(source["scope"], {"workspaceId", "homeId", "buildingId"})
    for value in scope.values():
        id_string(value)
    for key in ("sourceId", "revisionId"):
        id_string(source[key])
    if source["parentRevisionId"] is not None:
        id_string(source["parentRevisionId"])
        require(source["parentRevisionId"] != source["revisionId"], "source self-parent")
    if source["semanticMapRevisionId"] is not None:
        id_string(source["semanticMapRevisionId"])
        require(isinstance(source["semanticMapSha256"], str)
                and SHA.fullmatch(source["semanticMapSha256"]) is not None,
                "semantic map source pin")
    else:
        require(source["semanticMapSha256"] is None, "unpaired semantic map pin")
    asset = object_keys(source["ifcAsset"], {"assetId", "sha256", "bytes"})
    id_string(asset["assetId"])
    require(asset["sha256"] == ifc_hash and asset["bytes"] == len(ifc), "IFC source mismatch")
    require(b"\0" not in ifc and ifc.decode("utf-8").strip().startswith("ISO-10303-21;")
            and ifc.decode("utf-8").strip().endswith("END-ISO-10303-21;")
            and b"FILE_SCHEMA(('IFC" in ifc, "IFC source syntax")
    tool = object_keys(source["authoringTool"], {"name", "version"})
    def valid_tool_text(value: Any) -> bool:
        return (isinstance(value, str) and 0 < len(value.encode("utf-8")) <= 128
                and not any(unicodedata.category(c) == "Cc" for c in value))
    require(valid_tool_text(tool["name"])
            and (tool["version"] is None or valid_tool_text(tool["version"])),
            "authoring tool shape/limits")
    require(source["declaredUnits"] == "mm" and source["declaredUpAxis"] == "Z",
            "current GLB profile requires declared mm/Z IFC")


def check_glb(glb: bytes, source: dict, config: dict) -> dict:
    require(28 <= len(glb) <= MAX_GLB and len(glb) % 4 == 0, "GLB byte budget")
    require(glb[:4] == b"glTF" and int.from_bytes(glb[4:8], "little") == 2
            and int.from_bytes(glb[8:12], "little") == len(glb), "GLB header")
    json_size = int.from_bytes(glb[12:16], "little")
    require(json_size % 4 == 0 and glb[16:20] == b"JSON", "GLB JSON chunk")
    end = 20 + json_size
    require(end + 8 <= len(glb) and glb[end+4:end+8] == b"BIN\0"
            and end + 8 + int.from_bytes(glb[end:end+4], "little") == len(glb),
            "GLB BIN chunk")
    doc = strict_load(glb[20:end]); asset = doc["asset"]
    receipt = asset["extras"]["houseatlasIfcDerivative"]
    object_keys(receipt, {"profile", "originalSha256", "originalBytes", "floorLabel",
                          "sourceUnits", "sourceUpAxis", "glbUnits", "glbUpAxis",
                          "sourceToGlb", "converter"})
    require(receipt["profile"] == GLB_PROFILE and receipt["originalSha256"]
            == source["ifcAsset"]["sha256"] and receipt["originalBytes"]
            == source["ifcAsset"]["bytes"], "GLB source lineage")
    require(receipt["floorLabel"] == config["floor"]["label"], "GLB floor label")
    require((receipt["sourceUnits"], receipt["sourceUpAxis"], receipt["glbUnits"],
             receipt["glbUpAxis"]) == ("mm", "Z", "m", "Y"), "GLB axes")
    require(receipt["sourceToGlb"] == {"axisMap": ["x", "z", "-y"], "scale": .001},
            "GLB axis transform")
    require(receipt["converter"] == {"name": config["converter"]["name"],
            "version": config["converter"]["version"],
            "configSha256": config["converterConfigSha256"]}, "GLB converter receipt")
    require(isinstance(doc.get("meshes"), list) and doc["meshes"]
            and isinstance(doc.get("buffers"), list) and len(doc["buffers"]) == 1,
            "GLB geometry missing")
    require(isinstance(doc.get("nodes"), list) and len(doc["nodes"]) == len(doc["meshes"]),
            "GLB mesh/node count")
    return doc


def check_plan(plan: dict, source: dict, map_id: str,
               known_ids: dict[str, tuple[str, str]],
               config: dict, glb_doc: dict) -> None:
    object_keys(plan, {"profile", "sourceRevisionId", "sourceIfcSha256",
                       "semanticMapRevisionId", "units", "upAxis", "floor", "spaces",
                       "meshBindings"})
    require(plan["profile"] == PLAN_PROFILE and plan["sourceRevisionId"]
            == source["revisionId"] and plan["sourceIfcSha256"]
            == source["ifcAsset"]["sha256"] and plan["semanticMapRevisionId"] == map_id,
            "floorplan source/map lineage")
    require(plan["units"] == "mm" and plan["upAxis"] == "Z", "floorplan axes")
    require(plan["floor"] == config["floor"], "floorplan floor identity")
    require(isinstance(plan["spaces"], list) and len(plan["spaces"]) <= 2048,
            "floorplan count")
    seen: set[str] = set()
    for space in plan["spaces"]:
        object_keys(space, {"entityId", "ifcGlobalId", "polygons"})
        eid = id_string(space["entityId"])
        require(eid in known_ids and eid not in seen, "floorplan entity mismatch")
        require((space["ifcGlobalId"], config["floor"]["floorId"]) == known_ids[eid],
                "floorplan IFC/floor identity mismatch")
        seen.add(eid)
        require(isinstance(space["ifcGlobalId"], str)
                and GLOBAL_ID.fullmatch(space["ifcGlobalId"]) is not None, "IFC GlobalId")
        polygons = space["polygons"]
        require(isinstance(polygons, list) and 1 <= len(polygons) <= 64, "polygon count")
        for polygon in polygons:
            require(isinstance(polygon, list) and 3 <= len(polygon) <= 4096, "polygon points")
            for point in polygon:
                require(isinstance(point, list) and len(point) == 2
                        and all(type(n) in (int, float) and math.isfinite(n)
                                and abs(n) <= 10_000_000 for n in point), "polygon coordinate")
    bindings = plan["meshBindings"]
    require(isinstance(bindings, list) and len(bindings) <= len(glb_doc["meshes"]),
            "mesh binding count")
    bound_meshes = set(); bound_entities = set()
    for binding in bindings:
        object_keys(binding, {"meshIndex", "nodeIndex", "entityType", "entityId",
                              "ifcGlobalId"})
        eid = id_string(binding["entityId"])
        require(binding["entityType"] == "room" and eid in seen
                and known_ids.get(eid) == (binding["ifcGlobalId"], config["floor"]["floorId"]),
                "mesh semantic identity")
        mi = binding["meshIndex"]; ni = binding["nodeIndex"]
        require(type(mi) is int and type(ni) is int and 0 <= mi < len(glb_doc["meshes"])
                and 0 <= ni < len(glb_doc["nodes"]), "mesh binding index")
        require(mi not in bound_meshes and eid not in bound_entities, "duplicate mesh binding")
        bound_meshes.add(mi); bound_entities.add(eid)
        require(glb_doc["nodes"][ni] == {"name": "ha-room/" + eid, "mesh": mi}
                and glb_doc["meshes"][mi]["name"] == "ha-room/" + eid,
                "GLB mesh/node semantic name")
    require(seen == {eid for eid, (_, floor_id) in known_ids.items()
                     if floor_id == config["floor"]["floorId"]},
            "partial or extra floorplan room coverage")


def check_semantics_v1(semantic_map: dict, source: dict, ifc_hash: str,
                       projection: dict) -> dict[str, tuple[str, str]]:
    object_keys(semantic_map, {"schema", "semanticMapRevisionId", "previousSemanticMapRevisionId",
                               "sourceRevisionId", "ifcOriginalSha256", "workspaceId", "homeId",
                               "buildingId", "floors", "rooms", "electricalGroups", "transitions"})
    require(semantic_map["schema"] == "houseatlas.ifc-semantic-map.v1"
            and semantic_map["sourceRevisionId"] == source["revisionId"]
            and semantic_map["ifcOriginalSha256"] == ifc_hash, "semantic source lineage")
    for key in ("workspaceId", "homeId", "buildingId"):
        require(semantic_map[key] == source["scope"][key], "semantic scope")
    map_id = id_string(semantic_map["semanticMapRevisionId"])
    require(source["semanticMapRevisionId"] == map_id, "source/map revision mismatch")
    entities = {row["globalId"]: row for row in projection["entities"]}
    pset_ids = set(); app_ids = set()
    for row in projection["entities"]:
        pset = row["identityPset"]
        require(pset["occurrenceGlobalId"] not in pset_ids
                and pset["EntityId"] not in app_ids, "duplicate/shared IFC identity")
        pset_ids.add(pset["occurrenceGlobalId"]); app_ids.add(pset["EntityId"])
    floors = semantic_map["floors"]
    require(isinstance(floors, list) and 1 <= len(floors) <= 128, "semantic floors")
    floor_ids: dict[str, str] = {}
    for floor in floors:
        object_keys(floor, {"floorId", "ifcBuildingStoreyGlobalId", "atlasPlaceId",
                            "displayName"})
        fid = id_string(floor["floorId"])
        gid = floor["ifcBuildingStoreyGlobalId"]
        row = entities.get(gid)
        require(row is not None and row["type"] == "IfcBuildingStorey"
                and row["identityPset"]["EntityId"] == fid,
                "IfcBuildingStorey map mismatch")
        require(fid not in floor_ids, "duplicate floor ID")
        floor_ids[fid] = gid
    known_ids: dict[str, tuple[str, str]] = {}
    all_app_ids: set[str] = set()
    rooms = semantic_map["rooms"]; groups = semantic_map["electricalGroups"]
    require(isinstance(rooms, list) and len(rooms) <= 4096
            and isinstance(groups, list) and len(groups) <= 4096, "semantic count")
    for room in rooms:
        object_keys(room, {"roomId", "floorId", "ifcSpaceGlobalId", "atlasPlaceId",
                           "packagePlace", "displayName"})
        rid = id_string(room["roomId"]); gid = room["ifcSpaceGlobalId"]
        fid = id_string(room["floorId"])
        require(fid in floor_ids, "room floor absent from map")
        row = entities.get(gid)
        require(row is not None and row["type"] == "IfcSpace"
                and row["identityPset"]["EntityId"] == rid, "IfcSpace map mismatch")
        require(rid not in all_app_ids, "duplicate app room identity")
        known_ids[rid] = (gid, fid)
        all_app_ids.add(rid)
    for group in groups:
        object_keys(group, {"groupId", "ifcCircuitGlobalId", "atlasCircuitId",
                            "displayName", "historicalLabels", "membershipStatus"})
        gid = group["ifcCircuitGlobalId"]; group_id = id_string(group["groupId"])
        require(group_id not in all_app_ids, "duplicate app group identity")
        all_app_ids.add(group_id)
        if gid is not None:
            row = entities.get(gid)
            require(row is not None and row["type"] == "IfcDistributionCircuit"
                    and row["identityPset"]["EntityId"] == group_id,
                    "IfcDistributionCircuit map mismatch")
        require(group["membershipStatus"] in ("unknown", "reviewed"), "group membership")
        if group["membershipStatus"] == "reviewed":
            require(gid is not None and group["atlasCircuitId"] is not None
                    and any(a["relatingGroupGlobalId"] == gid
                            for a in projection["groupAssignments"]),
                    "reviewed membership lacks IFC assignment")
    require(len(known_ids) == len(rooms), "semantic duplicate room identity")
    require({row["globalId"] for row in projection["entities"]
             if row["type"] == "IfcSpace"} == {gid for gid, _ in known_ids.values()},
            "unmapped IFC space")
    require({row["globalId"] for row in projection["entities"]
             if row["type"] == "IfcBuildingStorey"} == set(floor_ids.values()),
            "unmapped IFC storey")
    require({row["globalId"] for row in projection["entities"]
             if row["type"] == "IfcDistributionCircuit"}
            == {group["ifcCircuitGlobalId"] for group in groups
                if group["ifcCircuitGlobalId"] is not None},
            "unmapped IFC electrical circuit")
    relation = {}
    for aggregate in projection["spatialAggregates"]:
        storey_gid = aggregate["relatingStoreyGlobalId"]
        for room_gid in aggregate["relatedSpaceGlobalIds"]:
            require(room_gid not in relation, "space in multiple storeys")
            relation[room_gid] = storey_gid
    for gid, fid in known_ids.values():
        require(relation.get(gid) == floor_ids[fid], "room/storey IFC relation mismatch")
    return known_ids


def check_semantics_v2(semantic_map: dict, source: dict, ifc_hash: str,
                       projection: dict) -> dict[str, tuple[str, str, str]]:
    object_keys(semantic_map, {"schema", "semanticMapRevisionId", "previousSemanticMapRevisionId",
                               "sourceRevisionId", "ifcOriginalSha256", "workspaceId", "homeId",
                               "buildingId", "floors", "rooms", "electricalGroups", "transitions"})
    require(semantic_map["schema"] == "houseatlas.ifc-semantic-map.v2"
            and semantic_map["sourceRevisionId"] == source["revisionId"]
            and semantic_map["ifcOriginalSha256"] == ifc_hash
            and semantic_map["semanticMapRevisionId"] == source["semanticMapRevisionId"],
            "v2 semantic source lineage")
    for key in ("workspaceId", "homeId", "buildingId"):
        require(semantic_map[key] == source["scope"][key], "v2 semantic scope")
    entities = {row["globalId"]: row for row in projection["entities"]}
    floors = {row["floorId"]: row["ifcBuildingStoreyGlobalId"]
              for row in semantic_map["floors"]}
    occurrence_ids: dict[str, tuple[str, str, str]] = {}
    for room in semantic_map["rooms"]:
        rid = id_string(room["roomId"])
        for occurrence in room["occurrences"]:
            oid = occurrence["spaceOccurrenceId"]
            gid = occurrence["ifcSpaceGlobalId"]
            fid = id_string(occurrence["floorId"])
            require(oid not in occurrence_ids and fid in floors,
                    "duplicate/unknown space occurrence")
            row = entities.get(gid)
            require(row is not None and row["type"] == "IfcSpace"
                    and row["identityPset"]["EntityId"] == rid
                    and row["identityPset"]["spaceOccurrenceId"] == oid,
                    "v2 IFC space identity mismatch")
            occurrence_ids[oid] = (rid, gid, fid)
    require({row["globalId"] for row in projection["entities"]
             if row["type"] == "IfcSpace"}
            == {gid for _, gid, _ in occurrence_ids.values()},
            "unmapped v2 IFC space occurrence")
    require({row["globalId"] for row in projection["entities"]
             if row["type"] == "IfcDistributionCircuit"}
            == {group["ifcCircuitGlobalId"] for group in semantic_map["electricalGroups"]
                if group["ifcCircuitGlobalId"] is not None},
            "unmapped v2 IFC electrical circuit")
    return occurrence_ids


def check_plan_v2(plan: dict, source: dict, map_id: str,
                  occurrences: dict[str, tuple[str, str, str]],
                  config: dict, glb_doc: dict) -> None:
    object_keys(plan, {"profile", "sourceRevisionId", "sourceIfcSha256",
                       "semanticMapRevisionId", "units", "upAxis", "floor", "spaces",
                       "meshBindings"})
    require(plan["profile"] == PLAN_PROFILE_V2
            and plan["sourceRevisionId"] == source["revisionId"]
            and plan["sourceIfcSha256"] == source["ifcAsset"]["sha256"]
            and plan["semanticMapRevisionId"] == map_id
            and plan["units"] == "mm" and plan["upAxis"] == "Z"
            and plan["floor"] == config["floor"], "v2 plan lineage/axes/floor")
    spaces = plan["spaces"]
    require(isinstance(spaces, list) and 1 <= len(spaces) <= 4096,
            "v2 plan space count")
    seen = set()
    for space in spaces:
        object_keys(space, {"roomId", "spaceOccurrenceId", "ifcGlobalId", "polygons"})
        oid = space["spaceOccurrenceId"]
        require(isinstance(oid, str) and oid not in seen
                and occurrences.get(oid) == (space["roomId"], space["ifcGlobalId"],
                                             config["floor"]["floorId"]),
                "v2 plan occurrence identity")
        seen.add(oid)
        polygons = space["polygons"]
        require(isinstance(polygons, list) and 1 <= len(polygons) <= 64,
                "v2 polygon count")
        for polygon in polygons:
            require(isinstance(polygon, list) and 3 <= len(polygon) <= 4096,
                    "v2 polygon points")
            for point in polygon:
                require(isinstance(point, list) and len(point) == 2
                        and all(type(n) in (int, float) and math.isfinite(n)
                                and abs(n) <= 10_000_000 for n in point),
                        "v2 polygon coordinate")
    require(seen == {oid for oid, (_, _, fid) in occurrences.items()
                     if fid == config["floor"]["floorId"]},
            "partial v2 floor occurrence coverage")
    bindings = plan["meshBindings"]
    require(isinstance(bindings, list) and len(bindings) <= len(glb_doc["meshes"]),
            "v2 mesh binding count")
    bound_meshes = set(); bound_occurrences = set()
    for binding in bindings:
        object_keys(binding, {"meshIndex", "nodeIndex", "entityType", "roomId",
                              "spaceOccurrenceId", "ifcGlobalId"})
        oid = binding["spaceOccurrenceId"]
        require(binding["entityType"] == "spaceOccurrence" and oid in seen
                and occurrences.get(oid) == (binding["roomId"], binding["ifcGlobalId"],
                                             config["floor"]["floorId"]),
                "v2 mesh occurrence identity")
        mi = binding["meshIndex"]; ni = binding["nodeIndex"]
        require(type(mi) is int and type(ni) is int and 0 <= mi < len(glb_doc["meshes"])
                and 0 <= ni < len(glb_doc["nodes"])
                and mi not in bound_meshes and oid not in bound_occurrences,
                "v2 mesh binding indices/uniqueness")
        bound_meshes.add(mi); bound_occurrences.add(oid)
        name = "ha-space/" + binding["roomId"] + "/" + sha(oid.encode("utf-8"))
        require(glb_doc["nodes"][ni] == {"name": name, "mesh": mi}
                and glb_doc["meshes"][mi]["name"] == name,
                "v2 GLB mesh/node occurrence name")


def make_svg(plan: dict) -> bytes:
    points = [p for space in plan["spaces"] for polygon in space["polygons"] for p in polygon]
    require(bool(points), "empty floorplan")
    min_x = min(p[0] for p in points); max_x = max(p[0] for p in points)
    min_y = min(p[1] for p in points); max_y = max(p[1] for p in points)
    require(max_x > min_x and max_y > min_y, "degenerate floorplan extent")
    paths = []
    for space in sorted(plan["spaces"], key=lambda s: s["entityId"]):
        for poly in space["polygons"]:
            d = "M " + " L ".join(f"{p[0]:.3f},{-p[1]:.3f}" for p in poly) + " Z"
            paths.append(f'<path data-entity-id="{escape(space["entityId"])}" d="{d}"/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x:.3f} '
           f'{-max_y:.3f} {max_x-min_x:.3f} {max_y-min_y:.3f}">' + "".join(paths)
           + "</svg>\n")
    return svg.encode("utf-8")


def make_svg_v2(plan: dict) -> bytes:
    points = [p for space in plan["spaces"] for polygon in space["polygons"] for p in polygon]
    require(bool(points), "empty v2 floorplan")
    min_x = min(p[0] for p in points); max_x = max(p[0] for p in points)
    min_y = min(p[1] for p in points); max_y = max(p[1] for p in points)
    require(max_x > min_x and max_y > min_y, "degenerate v2 floorplan extent")
    paths = []
    for space in sorted(plan["spaces"], key=lambda s: s["spaceOccurrenceId"]):
        for poly in space["polygons"]:
            d = "M " + " L ".join(f"{p[0]:.3f},{-p[1]:.3f}" for p in poly) + " Z"
            paths.append(f'<path data-room-id={quoteattr(space["roomId"])} '
                         f'data-space-occurrence-id={quoteattr(space["spaceOccurrenceId"])} '
                         f'd="{d}"/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x:.3f} '
           f'{-max_y:.3f} {max_x-min_x:.3f} {max_y-min_y:.3f}">' + "".join(paths)
           + "</svg>\n")
    return svg.encode("utf-8")


def converter_run(executable: Path, ifc_path: Path, map_path: Path, config_path: Path,
                  output: Path) -> tuple[bytes, bytes]:
    output.mkdir()
    glb = output / "model.glb"; plan = output / "floorplan.json"
    result = subprocess.run([str(executable), "--ifc", str(ifc_path),
                             "--semantic-map", str(map_path), "--config",
                             str(config_path), "--glb", str(glb), "--floorplan", str(plan)],
                            check=False, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=180)
    require(result.returncode == 0, "converter failed")
    require(set(output.iterdir()) == {glb, plan}, "converter wrote unexpected files")
    glb_bytes, _ = file_hash(glb, MAX_GLB)
    plan_bytes, _ = file_hash(plan, MAX_PLAN)
    return glb_bytes, plan_bytes


def publish(source_path: Path, ifc_path: Path, map_path: Path, converter: Path,
            config_path: Path, publication_id: str, destination: Path,
            previous_map_path: Path | None = None) -> dict:
    require(not destination.exists() and not destination.is_symlink(),
            "publication destination exists")
    require(destination.parent.is_dir(), "publication parent absent")
    ifc, ifc_hash = file_hash(ifc_path, MAX_IFC)
    source_raw, source_hash = file_hash(source_path, 256_000)
    map_raw, map_hash = file_hash(map_path, 2_000_000)
    config_raw, _ = file_hash(config_path, 64_000)
    _, converter_hash = file_hash(converter, 100_000_000)
    require(os.access(converter, os.X_OK), "converter is not executable")
    source = strict_load(source_raw); semantic_map = strict_load(map_raw)
    config = strict_load(config_raw)
    check_source(source, ifc, ifc_hash)
    require(source["semanticMapSha256"] == map_hash, "source semantic map digest")
    version = {"houseatlas.ifc-semantic-map.v1": "v1",
               "houseatlas.ifc-semantic-map.v2": "v2"}.get(semantic_map.get("schema"))
    require(version is not None, "semantic map profile")
    try:
        projection = extract(ifc, profile=version)
    except IdentityExtractionError as error:
        raise PublicationError(str(error)) from error
    known_ids = (check_semantics_v1(semantic_map, source, ifc_hash, projection)
                 if version == "v1" else
                 check_semantics_v2(semantic_map, source, ifc_hash, projection))
    map_id = semantic_map["semanticMapRevisionId"]
    validator_dir = Path(__file__).resolve().parent
    validator = validator_dir / ("validate-cli.mjs" if version == "v1"
                                 else "validate-cli-v2.mjs")
    validator_module = validator_dir / ("semantic-map.mjs" if version == "v1"
                                        else "semantic-map-v2.mjs")
    validator_hash = sha(validator.read_bytes())
    validator_module_hash = sha(validator_module.read_bytes())
    previous_hash = None
    if previous_map_path is not None:
        previous_raw, previous_hash = file_hash(previous_map_path, 2_000_000)
        strict_load(previous_raw)
    require((semantic_map["previousSemanticMapRevisionId"] is None)
            == (previous_map_path is None), "semantic predecessor presence")
    with tempfile.TemporaryDirectory(prefix="houseatlas-ifc-identity-") as check_dir:
        projection_path = Path(check_dir) / "projection.json"
        projection_path.write_bytes(canonical(projection))
        command = ["node", str(validator), str(map_path), str(source_path),
                   str(projection_path)]
        if previous_map_path is not None: command.append(str(previous_map_path))
        result = subprocess.run(command, check=False, capture_output=True, timeout=30)
        require(result.returncode == 0, "semantic validator rejected source/map/projection")
        verdict = strict_load(result.stdout)
        require(verdict["semanticMapRevisionId"] == map_id
                and verdict["semanticMapSha256"] == map_hash,
                "semantic validator verdict mismatch")
        if version == "v2":
            require(verdict["spaceOccurrences"] == len(known_ids),
                    "semantic occurrence verdict mismatch")
    object_keys(config, {"floors", "converter"})
    floors = config["floors"]
    require(isinstance(floors, list) and 1 <= len(floors) <= 128,
            "publication floor count")
    elevations = storey_elevations(ifc)
    map_floors = {row["floorId"]: row["ifcBuildingStoreyGlobalId"]
                  for row in semantic_map["floors"]}
    require(len(floors) == len(map_floors), "partial floor publication")
    seen_floors = set(); seen_storeys = set()
    for floor in floors:
        object_keys(floor, {"floorId", "ifcBuildingStoreyGlobalId", "label",
                            "elevationMm", "floorToSource"})
        fid = id_string(floor["floorId"])
        gid = floor["ifcBuildingStoreyGlobalId"]
        require(fid not in seen_floors and gid not in seen_storeys
                and map_floors.get(fid) == gid and gid in elevations,
                "floor/storey identity mismatch")
        seen_floors.add(fid); seen_storeys.add(gid)
        require(isinstance(floor["label"], str) and 0 < len(floor["label"]) <= 128,
                "floor label")
        require(floor["elevationMm"] is None,
                "non-null elevation requires independently verified IFC units")
        require(floor["floorToSource"] is None,
                "floor transform requires separately validated IFC placement")
    require([floor["floorId"] for floor in floors]
            == sorted(floor["floorId"] for floor in floors),
            "publication floors must be sorted by stable ID")
    object_keys(config["converter"], {"name", "version", "sha256"})
    require(config["converter"]["sha256"] == converter_hash, "converter executable mismatch")
    id_string(publication_id)
    config_hash = sha(canonical(config))
    with tempfile.TemporaryDirectory(prefix="houseatlas-ifc-publication-") as tmp:
        temp = Path(tmp)
        stage = temp / "publication"; stage.mkdir()
        floor_receipts = []; all_bindings = []; covered = set()
        for floor in floors:
            fid = floor["floorId"]
            run_dir = temp / fid; run_dir.mkdir()
            converter_config_hash = sha(canonical({"floor": floor}))
            effective_config = {"floor": floor, "converter": config["converter"],
                                "converterConfigSha256": converter_config_hash,
                                "sourceRevisionId": source["revisionId"],
                                "sourceIfcSha256": ifc_hash,
                                "semanticMapRevisionId": map_id}
            effective_path = run_dir / "effective-config.json"
            effective_path.write_bytes(canonical(effective_config))
            first = converter_run(converter, ifc_path, map_path, effective_path,
                                  run_dir / "first")
            second = converter_run(converter, ifc_path, map_path, effective_path,
                                   run_dir / "second")
            require(first == second, "converter outputs are not reproducible")
            glb, plan_raw = first
            glb_doc = check_glb(glb, source, effective_config)
            plan = strict_load(plan_raw)
            if version == "v1":
                check_plan(plan, source, map_id, known_ids, effective_config, glb_doc)
                covered.update(space["entityId"] for space in plan["spaces"])
            else:
                check_plan_v2(plan, source, map_id, known_ids, effective_config, glb_doc)
                covered.update(space["spaceOccurrenceId"] for space in plan["spaces"])
            all_bindings.extend({"floorId": fid, **binding}
                                for binding in plan["meshBindings"])
            artifacts = {"glb": (glb, GLB_PROFILE, "model.glb"),
                         "floorplanFeatures": (canonical(plan),
                                               PLAN_PROFILE if version == "v1" else PLAN_PROFILE_V2,
                                               "floorplan.json"),
                         "floorplan2d": ((make_svg(plan) if version == "v1"
                                          else make_svg_v2(plan)),
                                         SVG_PROFILE if version == "v1" else SVG_PROFILE_V2,
                                         "floorplan.svg")}
            floor_stage = stage / "floors" / fid
            floor_stage.mkdir(parents=True)
            for data, _, name in artifacts.values():
                (floor_stage / name).write_bytes(data)
            floor_receipts.append({"floor": floor,
                                   "converterConfigSha256": converter_config_hash,
                                   "artifacts": {key: {"sha256": sha(data),
                                                       "bytes": len(data),
                                                       "profile": profile,
                                                       "path": f"floors/{fid}/{name}"}
                                                 for key, (data, profile, name)
                                                 in artifacts.items()}})
        require(covered == set(known_ids), "publication space coverage")
        semantic_profile = SEMANTIC_PROFILE if version == "v1" else SEMANTIC_PROFILE_V2
        semantics = canonical({"profile": semantic_profile,
                               "sourceRevisionId": source["revisionId"],
                               "sourceIfcSha256": ifc_hash,
                               "semanticMapRevisionId": map_id,
                               "semanticMapSha256": map_hash,
                               "floors": floors,
                               "meshBindings": all_bindings,
                               "semanticMap": semantic_map,
                               "ifcIdentityProjection": projection})
        (stage / "semantics.json").write_bytes(semantics)
        publication = {"profile": PROFILE if version == "v1" else PROFILE_V2,
                       "publicationId": publication_id,
                       "sourceRevisionId": source["revisionId"],
                       "sourceRevisionSha256": sha(source_jcs(source)),
                       "sourceRevisionRawFileSha256": source_hash,
                       "sourceIfcSha256": ifc_hash,
                       "semanticMapRevisionId": map_id,
                       "semanticMapSha256": map_hash,
                       "previousSemanticMapSha256": previous_hash,
                       "floors": floor_receipts,
                       "semanticArtifact": {"sha256": sha(semantics),
                                            "bytes": len(semantics),
                                            "profile": semantic_profile,
                                            "path": "semantics.json"},
                       "converter": {"name": config["converter"]["name"],
                                     "version": config["converter"]["version"],
                                     "executableSha256": converter_hash,
                                     "configSha256": config_hash},
                       "axes": {"sourceUnits": "mm", "sourceUpAxis": "Z",
                                "glbUnits": "m", "glbUpAxis": "Y",
                                "sourceToGlb": {"axisMap": ["x", "z", "-y"], "scale": .001}},
                       "validation": {"status": "syntactic-and-repeatable",
                                      "converterRuns": 2 * len(floors),
                                      "semanticValidatorSha256": validator_hash,
                                      "semanticValidatorModuleSha256": validator_module_hash,
                                      **({"spaceOccurrenceCount": len(known_ids)}
                                         if version == "v2" else {})}}
        (stage / "publication.json").write_bytes(canonical(publication))
        with tempfile.TemporaryDirectory(prefix=".houseatlas-ifc-publication-",
                                         dir=destination.parent) as delivery_tmp:
            ready = Path(delivery_tmp) / "ready"
            shutil.copytree(stage, ready)
            for path in [ready, *ready.rglob("*")]:
                path.chmod(0o700 if path.is_dir() else 0o600)
            require(not destination.exists() and not destination.is_symlink(),
                    "publication destination appeared")
            os.rename(ready, destination)
    return publication


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source-revision", "ifc", "semantic-map", "converter", "config",
                 "publication-id", "destination"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--previous-map")
    args = parser.parse_args()
    publication = publish(Path(args.source_revision), Path(args.ifc), Path(args.semantic_map),
                          Path(args.converter), Path(args.config), args.publication_id,
                          Path(args.destination),
                          Path(args.previous_map) if args.previous_map else None)
    print(sha(canonical(publication)))


if __name__ == "__main__":
    main()
