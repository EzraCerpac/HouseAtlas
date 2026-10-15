"""Conservative IFC4 STEP identity projection for publication preparation.

This is not a general IFC parser. It admits only explicit occurrence Psets and
relations needed to prove HouseAtlas identity, and rejects unsupported syntax.
Geometry conversion remains the converter's separate responsibility.
"""

from __future__ import annotations

import re
from typing import Any

REF = re.compile(r"#[1-9][0-9]*\Z")
ENTITY = re.compile(r"#([1-9][0-9]*)=([A-Z][A-Z0-9_]*)\((.*)\)\Z", re.S)
GLOBAL_ID = re.compile(r"[0-3][0-9A-Za-z_$]{21}\Z")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")


class IdentityExtractionError(ValueError):
    pass


def need(ok: bool, message: str) -> None:
    if not ok:
        raise IdentityExtractionError(message)


def step_string(token: str) -> str:
    need(len(token) >= 2 and token[0] == token[-1] == "'", "STEP string")
    value = token[1:-1].replace("''", "'")
    need("'" not in value and "\\" not in value and value.isascii(), "unsupported STEP string")
    return value


def split_args(value: str) -> list[str]:
    result: list[str] = []
    depth = 0; quoted = False; start = 0; i = 0
    while i < len(value):
        char = value[i]
        if char == "'":
            if quoted and i + 1 < len(value) and value[i + 1] == "'":
                i += 2; continue
            quoted = not quoted
        elif not quoted:
            if char == "(": depth += 1
            elif char == ")":
                depth -= 1; need(depth >= 0, "STEP nesting")
            elif char == "," and depth == 0:
                result.append(value[start:i].strip()); start = i + 1
        i += 1
    need(not quoted and depth == 0, "STEP argument termination")
    result.append(value[start:].strip())
    return result


def statements(data: str) -> list[str]:
    start = data.find("DATA;")
    need(start >= 0 and data.find("ENDSEC;", start) >= 0, "IFC DATA section")
    data = data[start + 5:data.find("ENDSEC;", start)]
    result: list[str] = []; quoted = False; begin = 0; i = 0
    while i < len(data):
        char = data[i]
        if char == "'":
            if quoted and i + 1 < len(data) and data[i + 1] == "'":
                i += 2; continue
            quoted = not quoted
        elif char == ";" and not quoted:
            value = data[begin:i].strip()
            if value: result.append(value)
            begin = i + 1
        i += 1
    need(not quoted and not data[begin:].strip(), "STEP statement termination")
    return result


def refs(token: str) -> list[str]:
    need(token.startswith("(") and token.endswith(")"), "STEP reference list")
    inner = token[1:-1]
    rows = split_args(inner) if inner else []
    need(all(REF.fullmatch(row) for row in rows), "STEP reference")
    return rows


def entity_map(data: bytes) -> dict[str, tuple[str, list[str]]]:
    try: text = data.decode("utf-8")
    except UnicodeDecodeError as error: raise IdentityExtractionError("IFC UTF-8") from error
    need(len(data) <= 10 * 1024 * 1024, "IFC byte limit")
    result = {}
    for statement in statements(text):
        match = ENTITY.fullmatch(statement)
        need(match is not None, "unsupported STEP statement")
        key = "#" + match[1]
        need(key not in result, "duplicate STEP number")
        result[key] = (match[2], split_args(match[3]))
    return result


def get(table: dict, ref: str, kind: str) -> list[str]:
    need(REF.fullmatch(ref) is not None and ref in table and table[ref][0] == kind,
         f"expected {kind}")
    return table[ref][1]


def global_id(token: str) -> str:
    value = step_string(token)
    need(GLOBAL_ID.fullmatch(value) is not None, "IFC GlobalId")
    return value


def property_value(token: str, type_name: str) -> str:
    prefix = type_name + "("
    need(token.startswith(prefix) and token.endswith(")"), "IFC property type")
    return step_string(token[len(prefix):-1])


def identity_pset(table: dict, ref: str) -> dict[str, Any] | None:
    if ref not in table or table[ref][0] != "IFCPROPERTYSET": return None
    args = table[ref][1]
    need(len(args) >= 5, "IfcPropertySet shape")
    if step_string(args[2]) != "HouseAtlas_Identity": return None
    values = {}
    for item in refs(args[4]):
        prop = get(table, item, "IFCPROPERTYSINGLEVALUE")
        need(len(prop) >= 3, "IfcPropertySingleValue shape")
        name = step_string(prop[0])
        need(name in ("EntityId", "SchemaVersion") and name not in values,
             "identity property name")
        values[name] = prop[2]
    need(set(values) == {"EntityId", "SchemaVersion"}, "identity properties")
    entity_id = property_value(values["EntityId"], "IFCIDENTIFIER")
    need(UUID.fullmatch(entity_id) is not None, "identity app UUID")
    need(values["SchemaVersion"] == "IFCINTEGER(1)", "identity schema version")
    return {"name":"HouseAtlas_Identity", "occurrenceGlobalId":global_id(args[0]),
            "EntityId":entity_id, "SchemaVersion":1}


def extract(data: bytes) -> dict[str, Any]:
    table = entity_map(data)
    psets: dict[str, dict] = {}
    for ref, (kind, _) in table.items():
        if kind == "IFCPROPERTYSET":
            pset = identity_pset(table, ref)
            if pset is not None: psets[ref] = pset
    occurrence_psets: dict[str, list[dict]] = {}
    pset_occurrences: dict[str, list[str]] = {}
    for _, (kind, args) in table.items():
        if kind != "IFCRELDEFINESBYPROPERTIES": continue
        need(len(args) >= 6, "IfcRelDefinesByProperties shape")
        pset = psets.get(args[5])
        if pset is None: continue
        for ref in refs(args[4]):
            occurrence_psets.setdefault(ref, []).append(pset)
            pset_occurrences.setdefault(args[5], []).append(ref)
    need(all(len(rows) == 1 for rows in pset_occurrences.values()),
         "shared HouseAtlas identity Pset")
    entities = []; global_ids: dict[str, str] = {}
    for ref, (kind, args) in table.items():
        if kind not in ("IFCSPACE", "IFCDISTRIBUTIONCIRCUIT", "IFCBUILDINGSTOREY"): continue
        need(len(args) >= 1, "identity occurrence shape")
        identity = occurrence_psets.get(ref, [])
        need(len(identity) == 1, "missing/shared occurrence identity Pset")
        gid = global_id(args[0]); need(gid not in global_ids, "duplicate IFC GlobalId")
        global_ids[gid] = ref
        predefined = None
        if kind == "IFCDISTRIBUTIONCIRCUIT":
            need(args[-1] == ".ELECTRICAL.", "electrical predefined type")
            predefined = "ELECTRICAL"
        label = {"IFCSPACE":"IfcSpace", "IFCDISTRIBUTIONCIRCUIT":"IfcDistributionCircuit",
                 "IFCBUILDINGSTOREY":"IfcBuildingStorey"}[kind]
        entities.append({"type":label,
                         "globalId":gid,"predefinedType":predefined,
                         "identityPset":identity[0]})
    need(bool(entities), "no canonical IFC identities")
    assignments = []
    for _, (kind, args) in table.items():
        if kind != "IFCRELASSIGNSTOGROUP": continue
        need(len(args) >= 7, "IfcRelAssignsToGroup shape")
        group_ref = args[6]
        if group_ref not in table or table[group_ref][0] != "IFCDISTRIBUTIONCIRCUIT":
            continue
        members = refs(args[4])
        need(bool(members), "empty electrical assignment")
        assignments.append({"globalId":global_id(args[0]),
                            "relatingGroupGlobalId":global_id(table[group_ref][1][0]),
                            "relatedObjectGlobalIds": [global_id(table[r][1][0])
                                                       for r in members if r in table]})
        need(len(assignments[-1]["relatedObjectGlobalIds"]) == len(members),
             "unresolved group member")
    aggregates = []
    for _, (kind, args) in table.items():
        if kind != "IFCRELAGGREGATES": continue
        need(len(args) >= 6, "IfcRelAggregates shape")
        storey_ref = args[4]
        if storey_ref not in table or table[storey_ref][0] != "IFCBUILDINGSTOREY":
            continue
        spaces = [ref for ref in refs(args[5]) if ref in table and table[ref][0] == "IFCSPACE"]
        if not spaces: continue
        aggregates.append({"globalId":global_id(args[0]),
                           "relatingStoreyGlobalId":global_id(table[storey_ref][1][0]),
                           "relatedSpaceGlobalIds":[global_id(table[ref][1][0]) for ref in spaces]})
    return {"entities": sorted(entities, key=lambda row: row["globalId"]),
            "groupAssignments": sorted(assignments, key=lambda row: row["globalId"]),
            "spatialAggregates": sorted(aggregates, key=lambda row: row["globalId"])}


def storey_elevations(data: bytes) -> dict[str, float | None]:
    table = entity_map(data)
    result = {}
    for kind, args in table.values():
        if kind == "IFCBUILDINGSTOREY":
            need(bool(args), "IfcBuildingStorey shape")
            gid = global_id(args[0])
            need(gid not in result, "duplicate IfcBuildingStorey GlobalId")
            elevation = None
            if len(args) >= 10 and args[-1] not in ("$", "*"):
                try: elevation = float(args[-1])
                except ValueError as error:
                    raise IdentityExtractionError("IfcBuildingStorey elevation") from error
                need(elevation == elevation and abs(elevation) <= 10_000_000,
                     "IfcBuildingStorey elevation bounds")
            result[gid] = elevation
    return result


def space_storeys(data: bytes) -> dict[str, str]:
    """Direct IfcRelAggregates storey→space links; ambiguity fails closed."""
    table = entity_map(data)
    result = {}
    for kind, args in table.values():
        if kind != "IFCRELAGGREGATES": continue
        need(len(args) >= 6, "IfcRelAggregates shape")
        storey_ref = args[4]
        if storey_ref not in table or table[storey_ref][0] != "IFCBUILDINGSTOREY":
            continue
        storey_id = global_id(table[storey_ref][1][0])
        for ref in refs(args[5]):
            if ref not in table or table[ref][0] != "IFCSPACE": continue
            space_id = global_id(table[ref][1][0])
            need(space_id not in result, "space belongs to multiple storeys")
            result[space_id] = storey_id
    return result
