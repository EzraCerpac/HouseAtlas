//! Explicit serve-only INPUT selection. Default disabled; no image/state issuer,
//! migration, source grant or current occurrence authority is supplied here.
use crate::{
    config::server::{ServerConfig, read_selected_file},
    contracts::measurement_assertions as wire,
};
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Arc,
};

pub const STATE_RECEIPT: &str = "server-measurements-state.json";
pub const PROFILE: &str = "measurements-v1";
const MAX_SELECTION: u64 = 256 * 1024;
const MAX_INPUT: u64 = 1_048_576;
const MAX_INPUT_SET: usize = 8 * 1_048_576;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublicationFile {
    pub path: PathBuf,
    pub sha256: String,
}
#[derive(Clone)]
pub(crate) enum CapturedPublicationOwner {
    Current,
    RetainedPublication {
        overview: PublicationFile,
        scene: PublicationFile,
    },
}
#[derive(Clone)]
pub struct CapturedOccurrenceInput {
    bytes: Option<Arc<[u8]>>,
    sha256: String,
    owner: CapturedPublicationOwner,
}
impl CapturedOccurrenceInput {
    pub fn bytes(&self) -> Option<&[u8]> {
        self.bytes.as_deref()
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    pub(crate) fn owner(&self) -> &CapturedPublicationOwner {
        &self.owner
    }
}
#[derive(Clone)]
pub struct SelectedMeasurements {
    state_receipt_sha256: String,
    input_set_sha256: String,
    inputs: Vec<CapturedOccurrenceInput>,
}
impl SelectedMeasurements {
    pub fn state_receipt_sha256(&self) -> &str {
        &self.state_receipt_sha256
    }
    pub fn input_set_sha256(&self) -> &str {
        &self.input_set_sha256
    }
    pub fn inputs(&self) -> &[CapturedOccurrenceInput] {
        &self.inputs
    }
    pub fn validate_config(&self, config: &ServerConfig) -> Result<(), String> {
        config.validate()
    }
}
#[derive(Clone, Default)]
pub enum ServerMeasurementSelection {
    #[default]
    Disabled,
    MeasurementsV1(SelectedMeasurements),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectionDocument {
    format: String,
    profile: String,
    state_receipt_sha256: String,
    exports: Vec<InputFile>,
}
#[derive(Deserialize)]
#[serde(tag = "owner", rename_all = "kebab-case", deny_unknown_fields)]
enum InputFile {
    Current {
        export: PublicationFile,
    },
    RetainedPublication {
        export: PublicationFile,
        overview: PublicationFile,
        scene: PublicationFile,
    },
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl ServerMeasurementSelection {
    /// Only these two explicit options are removed. Absence stays DISABLED.
    pub fn from_arguments(arguments: &[String]) -> Result<(Vec<String>, Self), String> {
        let mut remaining = Vec::new();
        let mut path = None;
        let mut digest = None;
        let mut args = arguments.iter();
        while let Some(argument) = args.next() {
            let slot = match argument.as_str() {
                "--measurements-config" => Some(&mut path),
                "--measurements-config-sha256" => Some(&mut digest),
                _ => None,
            };
            if let Some(slot) = slot {
                if arguments.first().map(String::as_str) != Some("serve") || slot.is_some() {
                    return Err(
                        "Measurement selection requires unique explicit serve options".into(),
                    );
                }
                *slot = Some(
                    args.next()
                        .filter(|v| !v.starts_with("--"))
                        .ok_or("Missing measurement selection value")?
                        .clone(),
                );
            } else {
                remaining.push(argument.clone());
            }
        }
        let selection = match (path, digest) {
            (None, None) => Self::Disabled,
            (Some(path), Some(digest)) => Self::read_pinned(Path::new(&path), &digest)?,
            _ => {
                return Err(
                    "Measurement selection requires its exact separate custody digest".into(),
                );
            }
        };
        Ok((remaining, selection))
    }
    pub fn read_pinned(path: &Path, expected_sha256: &str) -> Result<Self, String> {
        if !hash(expected_sha256) {
            return Err("Invalid measurement selection SHA256".into());
        }
        let bytes = read_selected_file(path, MAX_SELECTION, true)?;
        if crate::media::types::sha256(&bytes) != expected_sha256 {
            return Err("Measurement selection bytes changed".into());
        }
        let value = crate::contracts::v2::parse_value(&bytes)
            .map_err(|_| "Invalid closed measurement selection")?;
        let document: SelectionDocument =
            serde_json::from_value(value).map_err(|_| "Invalid closed measurement selection")?;
        if document.format != "houseatlas.measurements-runtime-selection.v1"
            || document.profile != PROFILE
            || !hash(&document.state_receipt_sha256)
            || document.exports.is_empty()
            || document.exports.len() > 64
        {
            return Err("Unsupported measurement selection".into());
        }
        let mut inputs = Vec::new();
        let mut pins = Vec::new();
        let mut seen = BTreeSet::new();
        let mut total = 0usize;
        let mut current_count = 0usize;
        let mut retained_count = 0usize;
        for input in document.exports {
            let (export, owner, pin) = match input {
                InputFile::Current { export } => {
                    current_count += 1;
                    let pin = serde_json::json!({"owner":"current","exportSha256":export.sha256});
                    (export, CapturedPublicationOwner::Current, pin)
                }
                InputFile::RetainedPublication {
                    export,
                    overview,
                    scene,
                } => {
                    retained_count += 1;
                    if retained_count > 8 || !hash(&overview.sha256) || !hash(&scene.sha256) {
                        return Err("Invalid or excessive retained publication descriptors".into());
                    }
                    // Paths are bounded, canonical-form configuration only.
                    // No filesystem presence or producer authority is inferred.
                    for file in [&overview, &scene] {
                        crate::config::server::absolute_path(&file.path)?;
                        if file.path.as_os_str().len() > 4096 {
                            return Err("Retained publication path exceeds bound".into());
                        }
                    }
                    let pin = serde_json::json!({"owner":"retained-publication","exportSha256":export.sha256,"overviewManifestSha256":overview.sha256,"semanticsSha256":scene.sha256});
                    (
                        export,
                        CapturedPublicationOwner::RetainedPublication { overview, scene },
                        pin,
                    )
                }
            };
            if !hash(&export.sha256)
                || !seen.insert(export.sha256.clone())
                || export.path.as_os_str().len() > 4096
            {
                return Err("Repeated or invalid measurement input pin".into());
            }
            crate::config::server::absolute_path(&export.path)?;
            let read = read_selected_file(&export.path, MAX_INPUT, true).and_then(|bytes| {
                if crate::media::types::sha256(&bytes) != export.sha256 {
                    return Err("Measurement input pin changed".into());
                }
                Ok(bytes)
            });
            // Current input failure refuses startup. Explicitly retained input
            // failure only removes that optional owner; stored values still
            // undergo mandatory inventory/native/Document/media validation.
            let bytes = match read {
                Ok(bytes) => Some(bytes),
                Err(e) => {
                    if matches!(owner, CapturedPublicationOwner::Current) {
                        return Err(e);
                    } else {
                        None
                    }
                }
            };
            if let Some(bytes) = &bytes {
                total = total
                    .checked_add(bytes.len())
                    .ok_or("Measurement input set too large")?;
            }
            if total > MAX_INPUT_SET {
                return Err("Measurement input set too large".into());
            }
            pins.push(pin);
            inputs.push(CapturedOccurrenceInput {
                bytes: bytes.map(Arc::from),
                sha256: export.sha256,
                owner,
            });
        }
        if current_count == 0 {
            return Err("At least one explicit current owner input is required".into());
        }
        // Non-circular: ordered declared owner roles + exact content pins ONLY.
        // Paths, captured sizes/availability and state receipt digest excluded.
        // An unavailable optional old producer cannot rewrite this binding.
        let input_set_sha256=wire::digest(&serde_json::json!({"domain":"houseatlas.measurement-configured-inputs/1","profile":PROFILE,"exports":pins})).map_err(|_|"Measurement input digest unavailable")?;
        Ok(Self::MeasurementsV1(SelectedMeasurements {
            state_receipt_sha256: document.state_receipt_sha256,
            input_set_sha256,
            inputs,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // FROZEN/UNREGISTERED/UNEXECUTED. No input file or runtime is selected.
    #[test]
    fn absent_measurement_selection_stays_disabled() {
        let args = vec![
            "serve".to_owned(),
            "--server-config".to_owned(),
            "/generated/config.json".to_owned(),
        ];
        let (remaining, selection) = ServerMeasurementSelection::from_arguments(&args).unwrap();
        assert_eq!(remaining, args);
        assert!(matches!(selection, ServerMeasurementSelection::Disabled));
        assert!(matches!(
            ServerMeasurementSelection::default(),
            ServerMeasurementSelection::Disabled
        ));
    }
}
