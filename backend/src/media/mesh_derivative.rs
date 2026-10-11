//! Immutable revision-six authored mesh bytes. Closed shape, full ordered chains
//! and decimal matrix products are checked without binary64 conversion. This
//! verifies submitted profile consistency/lineage, not execution of usdcat.
use super::geometry_original::UsdzLayer;
use super::types::sha256;
use super::{MediaError, MediaResult, WorkBudget};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

pub const MIME: &str = "application/vnd.houseatlas.magicplan-authored-mesh+json";
pub const PROFILE: &str = "houseatlas.magicplan-authored-mesh.v1";
pub const MAX_MESH_BYTES: usize = 8 * 1024 * 1024;
pub const SCHEMA_SHA256: &str = "7d069a1e37a0584aa6c1883d8500753e0f4105d60e5d0c8de3650f5955aa5863";
pub const CONVERTER_SHA256: &str =
    "c9bf5c49ceba9b8dcace64102dc9e7d714731952dae4ca3c2f704ad1569caeb3";
pub const PROFILE_SHA256: &str = "3deec596c1fedef079c4e353432f7848ae4d5d403b9e1bec92fad2907ca18aff";
fn invalid() -> MediaError {
    MediaError::Unsupported
}
fn need(ok: bool) -> MediaResult<()> {
    if ok { Ok(()) } else { Err(invalid()) }
}
fn text(v: &Value) -> MediaResult<&str> {
    v.as_str().ok_or_else(invalid)
}
fn list(v: &Value) -> MediaResult<&Vec<Value>> {
    v.as_array().ok_or_else(invalid)
}
fn integer(v: &Value, max: u64) -> MediaResult<u64> {
    v.as_u64().filter(|n| *n <= max).ok_or_else(invalid)
}

/// Measured metadata, never access authority or a conversion attestation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeshLineage {
    pub floor_label: String,
    pub original_sha256: String,
    pub original_bytes: u64,
    pub primary_layer: UsdzLayer,
}
/// Only this module constructs the qualification after checking all bytes and
/// the actually retained original archive's measured primary layer.
pub struct QualifiedMesh<'a> {
    bytes: &'a [u8],
    lineage: MeshLineage,
}
impl<'a> QualifiedMesh<'a> {
    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }
    pub fn lineage(&self) -> &MeshLineage {
        &self.lineage
    }
}
pub fn qualify<'a>(
    bytes: &'a [u8],
    original: &[u8],
    budget: &WorkBudget,
) -> MediaResult<QualifiedMesh<'a>> {
    let lineage = validate(bytes, budget)?;
    need(
        lineage.original_sha256 == sha256(original)
            && lineage.original_bytes == original.len() as u64
            && lineage.primary_layer == super::geometry_original::inspect_usdz(original, budget)?,
    )?;
    Ok(QualifiedMesh { bytes, lineage })
}

// Bound depth/values/strings and reject duplicate fields BEFORE Value allocation.
// These processing limits do not assert a fixed 32 MiB serde heap.
struct Scan<'a> {
    bytes: &'a [u8],
    at: usize,
    values: usize,
    budget: &'a WorkBudget,
}
impl Scan<'_> {
    fn space(&mut self) {
        while self
            .bytes
            .get(self.at)
            .is_some_and(|b| b" \r\n\t".contains(b))
        {
            self.at += 1;
        }
    }
    fn string(&mut self) -> MediaResult<String> {
        let start = self.at;
        need(self.bytes.get(self.at) == Some(&b'"'))?;
        self.at += 1;
        let mut escape = false;
        while let Some(b) = self.bytes.get(self.at).copied() {
            self.at += 1;
            need(self.at - start <= 4096 * 6 + 2)?;
            if !escape && b == b'"' {
                let value: String =
                    serde_json::from_slice(&self.bytes[start..self.at]).map_err(|_| invalid())?;
                need(value.chars().count() <= 4096)?;
                return Ok(value);
            }
            escape = !escape && b == b'\\';
        }
        Err(invalid())
    }
    fn value(&mut self, depth: usize) -> MediaResult<()> {
        self.budget.check()?;
        self.values += 1;
        need(depth <= 32 && self.values <= 750_000)?;
        self.space();
        match self.bytes.get(self.at) {
            Some(b'"') => {
                self.string()?;
            }
            Some(b'{') => {
                self.at += 1;
                self.space();
                let mut keys = BTreeSet::new();
                if self.bytes.get(self.at) == Some(&b'}') {
                    self.at += 1;
                    return Ok(());
                }
                loop {
                    self.space();
                    let key = self.string()?;
                    need(keys.insert(key))?;
                    self.space();
                    need(self.bytes.get(self.at) == Some(&b':'))?;
                    self.at += 1;
                    self.value(depth + 1)?;
                    self.space();
                    let end = self.bytes.get(self.at);
                    self.at += 1;
                    if end == Some(&b'}') {
                        break;
                    }
                    need(end == Some(&b','))?;
                }
            }
            Some(b'[') => {
                self.at += 1;
                self.space();
                if self.bytes.get(self.at) == Some(&b']') {
                    self.at += 1;
                    return Ok(());
                }
                loop {
                    self.value(depth + 1)?;
                    self.space();
                    let end = self.bytes.get(self.at);
                    self.at += 1;
                    if end == Some(&b']') {
                        break;
                    }
                    need(end == Some(&b','))?;
                }
            }
            Some(b't' | b'f' | b'n') => {
                let token: &[u8] = match self.bytes[self.at] {
                    b't' => b"true",
                    b'f' => b"false",
                    _ => b"null",
                };
                need(self.bytes.get(self.at..self.at + token.len()) == Some(token))?;
                self.at += token.len();
            }
            Some(_) => {
                let start = self.at;
                while self
                    .bytes
                    .get(self.at)
                    .is_some_and(|b| b"0123456789.eE+-".contains(b))
                {
                    self.at += 1;
                }
                need(self.at > start && self.at - start <= 64)?;
                let _: serde_json::Number =
                    serde_json::from_slice(&self.bytes[start..self.at]).map_err(|_| invalid())?;
            }
            None => return Err(invalid()),
        }
        Ok(())
    }
}

/// Signed decimal coefficient and base-ten shift. All products and additions
/// are exact and bounded (8192 decimal digits/shift), with cooperative checks.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Decimal {
    negative: bool,
    digits: Vec<u8>,
    shift: i32,
}
impl Decimal {
    fn zero() -> Self {
        Self {
            negative: false,
            digits: vec![0],
            shift: 0,
        }
    }
    fn one() -> Self {
        Self {
            negative: false,
            digits: vec![1],
            shift: 0,
        }
    }
    fn reduce(mut self) -> MediaResult<Self> {
        while self.digits.len() > 1 && self.digits.last() == Some(&0) {
            self.digits.pop();
        }
        if self.digits == [0] {
            return Ok(Self::zero());
        }
        let zeros = self.digits.iter().take_while(|d| **d == 0).count();
        if zeros > 0 {
            self.digits.drain(..zeros);
            self.shift = self.shift.checked_add(zeros as i32).ok_or_else(invalid)?;
        }
        need(self.digits.len() <= 8192 && self.shift.unsigned_abs() <= 8192)?;
        Ok(self)
    }
    fn parse(token: &str) -> MediaResult<Self> {
        need(!token.is_empty() && token.len() <= 64)?;
        let b = token.as_bytes();
        let negative = b[0] == b'-';
        let start = usize::from(matches!(b[0], b'-' | b'+'));
        let exp_at = b
            .iter()
            .position(|c| matches!(*c, b'e' | b'E'))
            .unwrap_or(b.len());
        let exponent = if exp_at < b.len() {
            std::str::from_utf8(&b[exp_at + 1..])
                .map_err(|_| invalid())?
                .parse::<i32>()
                .map_err(|_| invalid())?
        } else {
            0
        };
        need(exponent.unsigned_abs() <= 100)?;
        let mut digits = Vec::new();
        let mut fraction = 0i32;
        let mut point = false;
        for c in b.get(start..exp_at).ok_or_else(invalid)? {
            if *c == b'.' {
                need(!point)?;
                point = true;
            } else {
                need(c.is_ascii_digit())?;
                digits.push(*c - b'0');
                if point {
                    fraction += 1;
                }
            }
        }
        need(!digits.is_empty())?;
        digits.reverse();
        let value = Self {
            negative,
            digits,
            shift: exponent - fraction,
        }
        .reduce()?;
        let order = value.digits.len() as i32 + value.shift;
        need(
            value == Self::zero()
                || order < 13
                || order == 13 && value.digits == [1] && value.shift == 12,
        )?;
        Ok(value)
    }
    fn add(&self, right: &Self, budget: &WorkBudget) -> MediaResult<Self> {
        if *self == Self::zero() {
            return Ok(right.clone());
        }
        if *right == Self::zero() {
            return Ok(self.clone());
        }
        let shift = self.shift.min(right.shift);
        let left_pad = (self.shift - shift) as usize;
        let right_pad = (right.shift - shift) as usize;
        let size = (self.digits.len() + left_pad).max(right.digits.len() + right_pad);
        need(size < 8192)?;
        budget.check()?;
        let mut left = vec![0; size];
        left[left_pad..left_pad + self.digits.len()].copy_from_slice(&self.digits);
        let mut rhs = vec![0; size];
        rhs[right_pad..right_pad + right.digits.len()].copy_from_slice(&right.digits);
        let mut negative = self.negative;
        let mut result = Vec::with_capacity(size + 1);
        if self.negative == right.negative {
            let mut carry = 0;
            for (a, b) in left.iter().zip(&rhs) {
                let sum = a + b + carry;
                result.push(sum % 10);
                carry = sum / 10;
            }
            if carry > 0 {
                result.push(carry);
            }
        } else {
            if left.iter().rev().cmp(rhs.iter().rev()).is_lt() {
                std::mem::swap(&mut left, &mut rhs);
                negative = right.negative;
            }
            let mut borrow = 0i16;
            for (a, b) in left.iter().zip(&rhs) {
                let value = i16::from(*a) - i16::from(*b) - borrow;
                if value < 0 {
                    result.push((value + 10) as u8);
                    borrow = 1;
                } else {
                    result.push(value as u8);
                    borrow = 0;
                }
            }
        }
        Self {
            negative,
            digits: result,
            shift,
        }
        .reduce()
    }
    fn product(&self, right: &Self, budget: &WorkBudget) -> MediaResult<Self> {
        if *self == Self::zero() || *right == Self::zero() {
            return Ok(Self::zero());
        }
        need(self.digits.len() + right.digits.len() <= 8192)?;
        let mut digits = vec![0u32; self.digits.len() + right.digits.len()];
        for (i, a) in self.digits.iter().enumerate() {
            budget.check()?;
            for (j, b) in right.digits.iter().enumerate() {
                digits[i + j] += u32::from(*a) * u32::from(*b);
            }
        }
        for i in 0..digits.len() - 1 {
            let carry = digits[i] / 10;
            digits[i] %= 10;
            digits[i + 1] += carry;
        }
        need(digits.last().is_some_and(|d| *d < 10))?;
        Self {
            negative: self.negative != right.negative,
            digits: digits.into_iter().map(|d| d as u8).collect(),
            shift: self.shift.checked_add(right.shift).ok_or_else(invalid)?,
        }
        .reduce()
    }
    fn index(&self, maximum: u64) -> MediaResult<u64> {
        need(!self.negative && self.shift >= 0 && self.digits.len() as i32 + self.shift <= 12)?;
        let mut value = 0u64;
        for d in self.digits.iter().rev() {
            value = value
                .checked_mul(10)
                .and_then(|v| v.checked_add(u64::from(*d)))
                .ok_or_else(invalid)?;
        }
        for _ in 0..self.shift {
            value = value.checked_mul(10).ok_or_else(invalid)?;
        }
        need(value <= maximum)?;
        Ok(value)
    }
}
fn identity() -> Vec<Decimal> {
    (0..16)
        .map(|i| {
            if i % 5 == 0 {
                Decimal::one()
            } else {
                Decimal::zero()
            }
        })
        .collect()
}
fn matrix(v: &Value) -> MediaResult<Vec<Decimal>> {
    let rows = list(v)?;
    need(rows.len() == 16)?;
    let parsed = rows
        .iter()
        .map(|v| Decimal::parse(text(v)?))
        .collect::<MediaResult<Vec<_>>>()?;
    need(
        parsed[3] == Decimal::zero()
            && parsed[7] == Decimal::zero()
            && parsed[11] == Decimal::zero()
            && parsed[15] == Decimal::one(),
    )?;
    Ok(parsed)
}
fn multiply(a: &[Decimal], b: &[Decimal], budget: &WorkBudget) -> MediaResult<Vec<Decimal>> {
    let mut out = vec![Decimal::zero(); 16];
    for r in 0..4 {
        for c in 0..4 {
            for k in 0..4 {
                out[r * 4 + c] =
                    out[r * 4 + c].add(&a[r * 4 + k].product(&b[k * 4 + c], budget)?, budget)?;
            }
        }
    }
    Ok(out)
}
struct Node {
    parent: Option<String>,
    reset: bool,
    kind: String,
    matrix: Vec<Decimal>,
}
pub fn validate(bytes: &[u8], budget: &WorkBudget) -> MediaResult<MeshLineage> {
    budget.check()?;
    need(!bytes.is_empty() && bytes.len() <= MAX_MESH_BYTES)?;
    let mut scan = Scan {
        bytes,
        at: 0,
        values: 0,
        budget,
    };
    scan.value(0)?;
    scan.space();
    need(scan.at == bytes.len())?;
    let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    static VALIDATOR: OnceLock<Result<jsonschema::Validator, ()>> = OnceLock::new();
    let validator = VALIDATOR
        .get_or_init(|| {
            if sha256(SCHEMA.as_bytes()) != SCHEMA_SHA256 {
                return Err(());
            }
            let schema: Value = serde_json::from_str(SCHEMA).map_err(|_| ())?;
            jsonschema::options()
                .with_draft(jsonschema::Draft::Draft202012)
                .build(&schema)
                .map_err(|_| ())
        })
        .as_ref()
        .map_err(|_| MediaError::Unavailable)?;
    need(validator.is_valid(&value))?;
    need(
        value["converter"]["schemaSHA256"] == SCHEMA_SHA256
            && value["converter"]["codeSHA256"] == CONVERTER_SHA256
            && value["converter"]["profileSHA256"] == PROFILE_SHA256,
    )?;
    let units = Decimal::parse(text(&value["authoredCoordinates"]["metersPerUnitToken"])?)?;
    need(!units.negative && units != Decimal::zero())?;
    need(
        value["authoredCoordinates"]["matrixConvention"]
            == "row-major storage; row vector p_local * M_mesh * M_parent * ..."
            && value["authoredCoordinates"]["numericTokenProvenance"]
                == "exact tokens from usdcat USDA serialization; original USDC has binary values, not text lexemes",
    )?;
    let mut table = BTreeMap::new();
    for v in list(&value["nodes"])? {
        budget.check()?;
        let path = text(&v["path"])?;
        let parent = path.rsplit_once('/').and_then(|(p, _)| {
            if p.is_empty() {
                None
            } else {
                Some(p.to_owned())
            }
        });
        need(v["parentPath"].as_str() == parent.as_deref())?;
        let order = if v["authoredOpOrder"].is_null() {
            None
        } else {
            Some(list(&v["authoredOpOrder"])?)
        };
        let reset = order.is_some_and(|o| o.first().is_some_and(|v| v == "!resetXformStack!"));
        let ordered = order
            .map(|o| o[usize::from(reset)..].to_vec())
            .unwrap_or_default();
        need(
            v["resetXformStack"].as_bool() == Some(reset)
                && (ordered.is_empty() || ordered == [Value::String("xformOp:transform".into())]),
        )?;
        if let Some(o) = order {
            let raw: Value =
                serde_json::from_str(text(&v["rawOpOrderLiteral"])?).map_err(|_| invalid())?;
            need(raw == Value::Array(o.clone()))?;
        } else {
            need(v["rawOpOrderLiteral"].is_null())?;
        }
        let operations = list(&v["operations"])?;
        need(operations.len() == ordered.len())?;
        let local = if let Some(op) = operations.first() {
            matrix(&op["matrixTokens"])?
        } else {
            identity()
        };
        let kind = text(&v["primType"])?;
        need(kind != "Scope" || order.is_none() && operations.is_empty())?;
        need(local == matrix(&v["localMatrixTokens"])?)?;
        need(
            table
                .insert(
                    path.to_owned(),
                    Node {
                        parent,
                        reset,
                        kind: kind.to_owned(),
                        matrix: local,
                    },
                )
                .is_none(),
        )?;
    }
    let mut ids = BTreeSet::new();
    let mut used = BTreeSet::new();
    let mut vertices = 0u64;
    let mut triangles = 0u64;
    for v in list(&value["meshes"])? {
        budget.check()?;
        let id = text(&v["sourceObjectId"])?;
        need(ids.insert(id.to_owned()) && table.get(id).is_some_and(|n| n.kind == "Mesh"))?;
        let orientation = &v["authoredOrientation"];
        need(if orientation.is_null() {
            v["resolvedOrientation"] == "rightHanded"
                && v["orientationQualification"] == "USD schema default; not physically verified"
        } else {
            v["resolvedOrientation"] == *orientation && v["orientationQualification"] == "authored"
        })?;
        let ds = &v["authoredDoubleSidedToken"];
        let expected = match ds.as_str() {
            Some("1" | "true") => Value::Bool(true),
            Some("0" | "false") => Value::Bool(false),
            None if ds.is_null() => Value::Null,
            _ => return Err(invalid()),
        };
        need(v["authoredDoubleSided"] == expected)?;
        let vc = integer(&v["vertexCount"], 150_000)?;
        let tc = integer(&v["triangleCount"], 50_000)?;
        let positions = list(&v["positionsLocalTokens"])?;
        let indices = list(&v["triangleIndicesTokens"])?;
        need(
            vc > 0
                && tc > 0
                && positions.len() as u64 == vc * 3
                && indices.len() as u64 == tc * 3
                && integer(&v["faceVertexCounts"]["count"], 50_000)? == tc,
        )?;
        vertices += vc;
        triangles += tc;
        need(vertices <= 150_000 && triangles <= 50_000)?;
        for p in positions {
            budget.check()?;
            Decimal::parse(text(p)?)?;
        }
        for i in indices {
            budget.check()?;
            let token = text(i)?;
            need(
                token
                    .bytes()
                    .enumerate()
                    .all(|(i, b)| b.is_ascii_digit() || i == 0 && matches!(b, b'+' | b'-')),
            )?;
            Decimal::parse(token)?.index(vc - 1)?;
        }
        let mut next = Some(id.to_owned());
        let mut composed = identity();
        let mut applied = Vec::new();
        let mut inherits = true;
        for raw in list(&v["ancestorChain"])? {
            let path = text(raw)?;
            need(next.as_deref() == Some(path))?;
            let node = table.get(path).ok_or_else(invalid)?;
            used.insert(path.to_owned());
            next = node.parent.clone();
            if inherits {
                applied.push(Value::String(path.to_owned()));
                composed = multiply(&composed, &node.matrix, budget)?;
            }
            if node.reset {
                inherits = false;
            }
        }
        need(
            next.is_none()
                && v["appliedChain"] == Value::Array(applied)
                && matrix(&v["composedLocalToStageMatrixTokens"])? == composed,
        )?;
    }
    need(
        used.len() == table.len()
            && table
                .iter()
                .all(|(path, n)| n.kind != "Mesh" || ids.contains(path)),
    )?;
    need(
        integer(&value["counts"]["nodes"], 2048)? == table.len() as u64
            && integer(&value["counts"]["meshes"], 512)? == ids.len() as u64
            && integer(&value["counts"]["vertices"], 150_000)? == vertices
            && integer(&value["counts"]["triangles"], 50_000)? == triangles,
    )?;
    budget.check()?;
    let source = &value["source"];
    Ok(MeshLineage {
        floor_label: text(&source["floorLabel"])?.to_owned(),
        original_sha256: text(&source["originalSHA256"])?.to_owned(),
        original_bytes: integer(&source["originalBytes"], 10 * 1024 * 1024)?,
        primary_layer: UsdzLayer {
            name: text(&source["primaryLayerName"])?.to_owned(),
            sha256: text(&source["primaryLayerSHA256"])?.to_owned(),
            byte_size: integer(&source["primaryLayerBytes"], 32 * 1024 * 1024)?,
        },
    })
}

// Exact independently supplied revision-six schema (sha above), not Atlas.
const SCHEMA: &str = r####"{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "profile",
    "source",
    "converter",
    "authoredCoordinates",
    "qualification",
    "nodes",
    "meshes",
    "counts"
  ],
  "properties": {
    "profile": {
      "const": "houseatlas.magicplan-authored-mesh.v1"
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "fileName",
        "floorLabel",
        "originalSHA256",
        "originalBytes",
        "primaryLayerName",
        "primaryLayerSHA256",
        "primaryLayerBytes",
        "serializedUSDASHA256",
        "serializedUSDABytes"
      ],
      "properties": {
        "fileName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "floorLabel": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "originalSHA256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "originalBytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10485760
        },
        "primaryLayerName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "primaryLayerSHA256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "primaryLayerBytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 33554432
        },
        "serializedUSDASHA256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "serializedUSDABytes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 33554432
        }
      }
    },
    "converter": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "codeSHA256",
        "schemaSHA256",
        "profileSHA256",
        "usdcatExecutableSHA256",
        "usdcatVersion",
        "invocation"
      ],
      "properties": {
        "codeSHA256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "schemaSHA256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "profileSHA256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "usdcatExecutableSHA256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "usdcatVersion": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "invocation": {
          "const": "usdcat local-primary.usdc -> private serialized.usda stdout; no flatten, composition or network"
        }
      }
    },
    "authoredCoordinates": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "upAxis",
        "metersPerUnitToken",
        "defaultPrim",
        "matrixConvention",
        "numericTokenProvenance"
      ],
      "properties": {
        "upAxis": {
          "enum": [
            "X",
            "Y",
            "Z"
          ]
        },
        "metersPerUnitToken": {
          "type": "string",
          "maxLength": 64,
          "pattern": "^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?$"
        },
        "defaultPrim": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "matrixConvention": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "numericTokenProvenance": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        }
      }
    },
    "qualification": {
      "const": {
        "physicalScale": "unknown",
        "floorAlignment": "unknown",
        "stageToHouseTransform": null,
        "semanticRoomObjects": 0
      }
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "path",
          "primType",
          "parentPath",
          "authoredOpOrder",
          "rawOpOrderLiteral",
          "resetXformStack",
          "operations",
          "localMatrixTokens"
        ],
        "properties": {
          "path": {
            "type": "string",
            "maxLength": 4096,
            "pattern": "^/[A-Za-z_0-9]+(?:/[A-Za-z_0-9]+)*$"
          },
          "primType": {
            "enum": [
              "Xform",
              "Scope",
              "Mesh"
            ]
          },
          "parentPath": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 4096,
                "pattern": "^/[A-Za-z_0-9]+(?:/[A-Za-z_0-9]+)*$"
              },
              {
                "type": "null"
              }
            ]
          },
          "authoredOpOrder": {
            "enum": [
              null,
              [],
              [
                "!resetXformStack!"
              ],
              [
                "xformOp:transform"
              ],
              [
                "!resetXformStack!",
                "xformOp:transform"
              ]
            ]
          },
          "rawOpOrderLiteral": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 256
              },
              {
                "type": "null"
              }
            ]
          },
          "resetXformStack": {
            "type": "boolean"
          },
          "operations": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "name",
                "type",
                "matrixTokens"
              ],
              "properties": {
                "name": {
                  "const": "xformOp:transform"
                },
                "type": {
                  "const": "matrix4d"
                },
                "matrixTokens": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "maxLength": 64,
                    "pattern": "^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?$"
                  },
                  "minItems": 16,
                  "maxItems": 16
                }
              }
            },
            "minItems": 0,
            "maxItems": 1
          },
          "localMatrixTokens": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 64,
              "pattern": "^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?$"
            },
            "minItems": 16,
            "maxItems": 16
          }
        }
      },
      "minItems": 1,
      "maxItems": 2048
    },
    "meshes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "sourceObjectId",
          "sourceName",
          "positionsLocalTokens",
          "triangleIndicesTokens",
          "faceVertexCounts",
          "ancestorChain",
          "appliedChain",
          "composedLocalToStageMatrixTokens",
          "authoredOrientation",
          "resolvedOrientation",
          "orientationQualification",
          "authoredDoubleSided",
          "vertexCount",
          "triangleCount",
          "authoredDoubleSidedToken"
        ],
        "properties": {
          "sourceObjectId": {
            "type": "string",
            "maxLength": 4096,
            "pattern": "^/[A-Za-z_0-9]+(?:/[A-Za-z_0-9]+)*$"
          },
          "sourceName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "positionsLocalTokens": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 64,
              "pattern": "^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?$"
            },
            "minItems": 3,
            "maxItems": 450000
          },
          "triangleIndicesTokens": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 12,
              "pattern": "^[-+]?\\d+$"
            },
            "minItems": 3,
            "maxItems": 150000
          },
          "faceVertexCounts": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "repeatedToken",
              "count"
            ],
            "properties": {
              "repeatedToken": {
                "const": "3"
              },
              "count": {
                "type": "integer",
                "minimum": 1,
                "maximum": 50000
              }
            }
          },
          "ancestorChain": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 4096,
              "pattern": "^/[A-Za-z_0-9]+(?:/[A-Za-z_0-9]+)*$"
            },
            "minItems": 1,
            "maxItems": 64
          },
          "appliedChain": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 4096,
              "pattern": "^/[A-Za-z_0-9]+(?:/[A-Za-z_0-9]+)*$"
            },
            "minItems": 1,
            "maxItems": 64
          },
          "composedLocalToStageMatrixTokens": {
            "type": "array",
            "items": {
              "type": "string",
              "maxLength": 64,
              "pattern": "^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?$"
            },
            "minItems": 16,
            "maxItems": 16
          },
          "authoredOrientation": {
            "enum": [
              null,
              "rightHanded",
              "leftHanded"
            ]
          },
          "resolvedOrientation": {
            "enum": [
              "rightHanded",
              "leftHanded"
            ]
          },
          "orientationQualification": {
            "enum": [
              "authored",
              "USD schema default; not physically verified"
            ]
          },
          "authoredDoubleSided": {
            "anyOf": [
              {
                "type": "boolean"
              },
              {
                "type": "null"
              }
            ]
          },
          "vertexCount": {
            "type": "integer",
            "minimum": 1,
            "maximum": 150000
          },
          "triangleCount": {
            "type": "integer",
            "minimum": 1,
            "maximum": 50000
          },
          "authoredDoubleSidedToken": {
            "enum": [
              null,
              "true",
              "false",
              "1",
              "0"
            ]
          }
        }
      },
      "minItems": 1,
      "maxItems": 512
    },
    "counts": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "meshes",
        "vertices",
        "triangles",
        "nodes"
      ],
      "properties": {
        "meshes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 512
        },
        "vertices": {
          "type": "integer",
          "minimum": 1,
          "maximum": 150000
        },
        "triangles": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50000
        },
        "nodes": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2048
        }
      }
    }
  },
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:houseatlas:private:magicplan-authored-mesh:v1",
  "title": "Private authored mesh derivative candidate; not a native contract"
}
"####;
