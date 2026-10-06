"""Static generic-policy/template consistency only; no scenario execution."""
import ast
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
policy = json.loads((root / "policy.json").read_text())
template = json.loads((root.parents[1] / "config/deployment.example.json").read_text())
assert policy["target"]["intendedHost"] is None
assert policy["target"]["readiness"] == "unknown-unqualified"
assert policy["access"]["proposedViewerAudience"] is None
assert policy["access"]["proposedEditorOperator"] is None
assert policy["recovery"]["proposedOwner"] is None
assert policy["recovery"]["offHostDestination"] is None
assert policy["gates"]["releasedByThisPackage"] == []
assert template["liveReady"] is False and template["host"] is None
for path in root.rglob("*.py"):
    ast.parse(path.read_text(), filename=str(path))
for path in root.rglob("*.json"):
    json.loads(path.read_text())
print("Generic policy/template and source syntax consistent; no scenarios executed")
