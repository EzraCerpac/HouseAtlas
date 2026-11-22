//! Optional owner-reviewed radio station facts and the passive now-playing read.
//! The backend only reads the helper's snapshot file: no listener, poller,
//! write, playback control or helper demand. A reviewed placement names one
//! scene occurrence; it is never inferred from names, graph positions or depth.
use super::server::{absolute_path, read_selected_file};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const PROFILE_MAX_BYTES: u64 = 4 * 1024;
/// The snapshot is small (track text is cut at 256 characters); the cover is a sibling file.
pub(crate) const SNAPSHOT_MAX_BYTES: u64 = 8 * 1024;
const COVER_MAX_BYTES: u64 = 256 * 1024;
/// The operator's station file holds one small integer.
const STATION_MAX_BYTES: u64 = 256;
const TEXT_MAX_CHARS: usize = 256;
/// Readers treat a snapshot checked longer ago than this as unknown.
pub(crate) const FRESH_MS: i64 = 15_000;
/// A checkedAt this far ahead of the reader's clock is not believed.
const FUTURE_MS: i64 = 2_000;
/// The reader's wall clock (chrono is built without its clock feature).
pub(crate) fn wall_clock() -> chrono::DateTime<chrono::Utc> {
    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    chrono::DateTime::from_timestamp_millis(since.as_millis() as i64).unwrap_or_default()
}
/// Medium-wave broadcast band, inclusive.
const FREQUENCY_KHZ: std::ops::RangeInclusive<u32> = 520..=1710;

fn invalid() -> String {
    "Selected radio station profile is unavailable or inconsistent".into()
}
fn need(ok: bool) -> Result<(), String> {
    if ok { Ok(()) } else { Err(invalid()) }
}
/// A required field that may be null: absent is refused, unlike serde's Option default.
fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    de: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(de)
}
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok_and(|u| u.to_string() == s)
}
fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
}
fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// One reviewed occurrence of the selected scene publication.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Placement {
    pub publication_id: String,
    pub space_occurrence_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Profile {
    profile: String,
    workspace_id: String,
    home_id: String,
    station_path: PathBuf,
    snapshot_path: PathBuf,
    #[serde(deserialize_with = "nullable")]
    placement: Option<Placement>,
}

/// Explicit `serve` selection: an exact path and SHA-256, read once at startup.
pub struct RadioStationSelection {
    pub workspace_id: String,
    pub home_id: String,
    pub placement: Option<Placement>,
    station_path: PathBuf,
    snapshot_path: PathBuf,
}
impl RadioStationSelection {
    pub fn from_arguments(args: &[String]) -> Result<(Vec<String>, Option<Self>), String> {
        let (mut path, mut sha) = (None, None);
        let mut rest = Vec::new();
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let slot = match arg.as_str() {
                "--radio-station-profile" => Some(&mut path),
                "--radio-station-profile-sha256" => Some(&mut sha),
                _ => None,
            };
            if let Some(slot) = slot {
                need(args.first().map(String::as_str) == Some("serve") && slot.is_none())?;
                *slot = Some(
                    iter.next()
                        .filter(|v| !v.starts_with("--"))
                        .ok_or_else(invalid)?
                        .clone(),
                );
            } else {
                rest.push(arg.clone());
            }
        }
        let selected = match (path, sha) {
            (None, None) => None,
            (Some(path), Some(sha)) => Some(Self::read_pinned(Path::new(&path), &sha)?),
            _ => return Err(invalid()),
        };
        Ok((rest, selected))
    }
    pub fn read_pinned(path: &Path, sha: &str) -> Result<Self, String> {
        need(digest(sha))?;
        let bytes = read_selected_file(path, PROFILE_MAX_BYTES, true).map_err(|_| invalid())?;
        need(format!("{:x}", Sha256::digest(&bytes)) == sha)?;
        Self::parse(&bytes)
    }
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, String> {
        let value = crate::contracts::v2::parse_value(bytes).map_err(|_| invalid())?;
        // `nullable` makes the placement required: stated explicitly, null when unreviewed.
        let p: Profile = serde_json::from_value(value).map_err(|_| invalid())?;
        need(
            p.profile == "houseatlas.radio-station-profile.v1"
                && uuid(&p.workspace_id)
                && uuid(&p.home_id)
                && absolute_path(&p.station_path).is_ok()
                && p.station_path.as_os_str().len() <= 4096
                && absolute_path(&p.snapshot_path).is_ok()
                && p.snapshot_path.as_os_str().len() <= 4096
                && p.placement.as_ref().is_none_or(|placement| {
                    uuid(&placement.publication_id) && id(&placement.space_occurrence_id)
                }),
        )?;
        Ok(Self {
            workspace_id: p.workspace_id,
            home_id: p.home_id,
            placement: p.placement,
            station_path: p.station_path,
            snapshot_path: p.snapshot_path,
        })
    }
    /// The transmitter frequency the operator's private file states, read on
    /// every call and never written. None when the file is absent, unsafe,
    /// oversize or not exactly `{"frequencyKhz": <integer in the band>}`.
    pub(crate) fn frequency_khz(&self) -> Option<u32> {
        let bytes = read_selected_file(&self.station_path, STATION_MAX_BYTES, true).ok()?;
        let value = crate::contracts::v2::parse_value(&bytes).ok()?;
        if !keys(&value, &["frequencyKhz"], &[]) {
            return None;
        }
        u32::try_from(value["frequencyKhz"].as_u64()?)
            .ok()
            .filter(|khz| FREQUENCY_KHZ.contains(khz))
    }
    /// One passive read of the snapshot file at `now`.
    pub(crate) fn observe(&self, now: chrono::DateTime<chrono::Utc>) -> Observation {
        let snapshot = read_selected_file(&self.snapshot_path, SNAPSHOT_MAX_BYTES, true)
            .ok()
            .and_then(|bytes| Snapshot::decode(&bytes).ok());
        Observation::at(snapshot, now)
    }
    /// The cover a fresh snapshot names, from its content-addressed sibling file,
    /// served only after its digest and magic bytes match. None otherwise.
    pub(crate) fn cover(
        &self,
        sha256: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Option<(&'static str, Vec<u8>)> {
        let cover = self.observe(now).snapshot?.cover?;
        if cover.sha256 != sha256 {
            return None;
        }
        let (media_type, extension, magic) = cover.kind()?;
        let path = self
            .snapshot_path
            .parent()?
            .join(format!("cover-{}.{extension}", cover.sha256));
        let bytes = read_selected_file(&path, COVER_MAX_BYTES, true).ok()?;
        (format!("{:x}", Sha256::digest(&bytes)) == cover.sha256 && bytes.starts_with(magic))
            .then_some((media_type, bytes))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum State {
    Playing,
    Stopped,
    Unknown,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Track {
    #[serde(deserialize_with = "nullable")]
    title: Option<String>,
    #[serde(deserialize_with = "nullable")]
    artist: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Cover {
    media_type: String,
    sha256: String,
}
/// `houseatlas.now-playing.v1`, decoded closed.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Snapshot {
    schema: String,
    pub(crate) state: State,
    #[serde(deserialize_with = "nullable")]
    since: Option<String>,
    checked_at: String,
    #[serde(deserialize_with = "nullable")]
    track: Option<Track>,
    #[serde(deserialize_with = "nullable")]
    last_track: Option<Track>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cover: Option<Cover>,
}
fn date(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|at| at.with_timezone(&chrono::Utc))
}
fn track_ok(track: &Track) -> bool {
    [&track.title, &track.artist].into_iter().all(|text| {
        text.as_deref()
            .is_none_or(|s| s.chars().count() <= TEXT_MAX_CHARS && !s.chars().any(char::is_control))
    })
}
fn keys(value: &Value, required: &[&str], optional: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        required.iter().all(|key| object.contains_key(*key))
            && object
                .keys()
                .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str()))
    })
}
impl Snapshot {
    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, ()> {
        if bytes.len() as u64 > SNAPSHOT_MAX_BYTES {
            return Err(());
        }
        let value = crate::contracts::v2::parse_value(bytes).map_err(|_| ())?;
        // Unknown and missing keys are refused by the closed serde shapes; the
        // optional cover is either absent or an object, never null.
        if value.get("cover").is_some_and(Value::is_null) {
            return Err(());
        }
        let s: Self = serde_json::from_value(value).map_err(|_| ())?;
        let since_ok = match (s.state, &s.since) {
            (State::Unknown, None) => true,
            (State::Unknown, Some(_)) | (_, None) => false,
            (_, Some(at)) => date(at).is_some(),
        };
        let ok = s.schema == "houseatlas.now-playing.v1"
            && since_ok
            // The current track exists only while playing.
            && (s.state == State::Playing || s.track.is_none())
            && date(&s.checked_at).is_some()
            && s.track.as_ref().is_none_or(track_ok)
            && s.last_track.as_ref().is_none_or(track_ok)
            // The cover belongs to lastTrack.
            && s.cover.as_ref().is_none_or(|cover| {
                s.last_track.is_some() && digest(&cover.sha256) && cover.kind().is_some()
            });
        if ok { Ok(s) } else { Err(()) }
    }
}
impl Cover {
    /// Media type, file extension and the magic bytes its file must start with.
    fn kind(&self) -> Option<(&'static str, &'static str, &'static [u8])> {
        match self.media_type.as_str() {
            "image/jpeg" => Some(("image/jpeg", "jpg", &[0xff, 0xd8, 0xff][..])),
            "image/png" => Some(("image/png", "png", &b"\x89PNG\r\n\x1a\n"[..])),
            _ => None,
        }
    }
}

/// What one read established. `snapshot` is present only when it decoded and
/// was checked within the freshness window, and not ahead of the reader's clock.
pub(crate) struct Observation {
    pub(crate) read_at: String,
    pub(crate) snapshot: Option<Snapshot>,
}
impl Observation {
    pub(crate) fn at(snapshot: Option<Snapshot>, now: chrono::DateTime<chrono::Utc>) -> Self {
        let fresh = |s: &Snapshot| {
            date(&s.checked_at)
                .is_some_and(|at| (-FUTURE_MS..=FRESH_MS).contains(&(now - at).num_milliseconds()))
        };
        Self {
            read_at: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            snapshot: snapshot.filter(fresh),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(s: &str) -> chrono::DateTime<chrono::Utc> {
        date(s).unwrap()
    }
    pub(crate) fn snapshot(state: &str, checked_at: &str) -> Value {
        let playing = state == "playing";
        json!({"schema":"houseatlas.now-playing.v1","state":state,
            "since": if state == "unknown" { Value::Null } else { json!("2026-01-01T12:00:02.000Z") },
            "checkedAt":checked_at,
            "track": if playing { json!({"title":"Example title","artist":null}) } else { Value::Null },
            "lastTrack":{"title":"Example title","artist":"Example artist"}})
    }
    fn decode(value: &Value) -> Result<Snapshot, ()> {
        Snapshot::decode(value.to_string().as_bytes())
    }

    #[test]
    fn healthy_radio_snapshot_decodes_closed() {
        let base = snapshot("playing", "2026-01-01T12:00:10.000Z");
        assert!(decode(&base).is_ok());
        assert!(decode(&snapshot("stopped", "2026-01-01T12:00:10.000Z")).is_ok());
        assert!(decode(&snapshot("unknown", "2026-01-01T12:00:10.000Z")).is_ok());
        let mut covered = base.clone();
        covered["cover"] = json!({"mediaType":"image/png","sha256":"a".repeat(64)});
        assert!(decode(&covered).is_ok());
        let mutations: Vec<Box<dyn Fn(&mut Value)>> = vec![
            Box::new(|v| v["schema"] = json!("houseatlas.now-playing.v2")),
            Box::new(|v| v["state"] = json!("paused")),
            Box::new(|v| v["extra"] = json!(1)),
            Box::new(|v| {
                v.as_object_mut().unwrap().remove("since");
            }),
            Box::new(|v| {
                v.as_object_mut().unwrap().remove("lastTrack");
            }),
            Box::new(|v| v["since"] = Value::Null),
            Box::new(|v| v["state"] = json!("stopped")),
            Box::new(|v| v["checkedAt"] = json!("yesterday")),
            Box::new(|v| v["track"]["album"] = json!("x")),
            Box::new(|v| v["track"] = json!({"title":"x"})),
            Box::new(|v| v["track"]["title"] = json!("a\u{7}b")),
            Box::new(|v| v["lastTrack"]["artist"] = json!("x".repeat(257))),
            Box::new(|v| v["cover"] = Value::Null),
            Box::new(|v| v["cover"] = json!({"mediaType":"image/gif","sha256":"a".repeat(64)})),
            Box::new(|v| v["cover"] = json!({"mediaType":"image/png","sha256":"A".repeat(64)})),
            Box::new(|v| v["cover"] = json!({"mediaType":"image/png","sha256":"a".repeat(63)})),
            Box::new(|v| {
                v["cover"] = json!({"mediaType":"image/png","sha256":"a".repeat(64),"base64":""})
            }),
            Box::new(|v| {
                v["cover"] = json!({"mediaType":"image/png","sha256":"a".repeat(64)});
                v["lastTrack"] = Value::Null;
            }),
        ];
        for (index, mutate) in mutations.iter().enumerate() {
            let mut value = base.clone();
            mutate(&mut value);
            assert!(decode(&value).is_err(), "mutation {index}");
        }
        let mut unknown = snapshot("unknown", "2026-01-01T12:00:10.000Z");
        unknown["since"] = json!("2026-01-01T12:00:02.000Z");
        assert!(decode(&unknown).is_err(), "unknown carries no since");
        let mut idle = snapshot("stopped", "2026-01-01T12:00:10.000Z");
        idle["track"] = json!({"title":"x","artist":null});
        assert!(
            decode(&idle).is_err(),
            "only a playing snapshot carries a track"
        );
        let mut quiet = base.clone();
        quiet["track"] = Value::Null;
        assert!(decode(&quiet).is_ok(), "playing may have no current track");
        assert!(Snapshot::decode(br#"{"schema":"a","schema":"b"}"#).is_err());
        let oversize = vec![b' '; SNAPSHOT_MAX_BYTES as usize + 1];
        assert!(Snapshot::decode(&oversize).is_err());
    }

    #[test]
    fn healthy_radio_freshness_window_and_future_refusal() {
        let s = |checked: &str| decode(&snapshot("playing", checked)).ok();
        let now = at("2026-01-01T12:00:30.000Z");
        let fresh = Observation::at(s("2026-01-01T12:00:15.000Z"), now);
        assert!(fresh.snapshot.is_some());
        assert_eq!(fresh.read_at, "2026-01-01T12:00:30.000Z");
        let stale = Observation::at(s("2026-01-01T12:00:14.999Z"), now);
        assert!(stale.snapshot.is_none());
        let ahead = Observation::at(s("2026-01-01T12:00:32.001Z"), now);
        assert!(ahead.snapshot.is_none());
        assert!(
            Observation::at(s("2026-01-01T12:00:32.000Z"), now)
                .snapshot
                .is_some()
        );
        assert!(Observation::at(None, now).snapshot.is_none());
    }

    #[test]
    fn healthy_radio_profile_parses_closed() {
        let base = json!({"profile":"houseatlas.radio-station-profile.v1",
            "workspaceId":"00000000-0000-4000-8000-000000000002","homeId":"00000000-0000-4000-8000-000000000003",
            "stationPath":"/private/station.json","snapshotPath":"/private/now-playing.json",
            "placement":{"publicationId":"00000000-0000-4000-8000-000000000009","spaceOccurrenceId":"occ-hall"}});
        let parse = |v: &Value| RadioStationSelection::parse(v.to_string().as_bytes());
        let station = parse(&base).unwrap();
        assert_eq!(station.placement.unwrap().space_occurrence_id, "occ-hall");
        let mut unplaced = base.clone();
        unplaced["placement"] = Value::Null;
        assert!(parse(&unplaced).unwrap().placement.is_none());
        let mutations: Vec<Box<dyn Fn(&mut Value)>> = vec![
            Box::new(|v| {
                v.as_object_mut().unwrap().remove("placement");
            }),
            Box::new(|v| v["frequencyKhz"] = json!(1440)),
            Box::new(|v| {
                v.as_object_mut().unwrap().remove("stationPath");
            }),
            Box::new(|v| v["stationPath"] = json!("relative/station.json")),
            Box::new(|v| v["stationPath"] = json!("/private/../station.json")),
            Box::new(|v| v["snapshotPath"] = json!("relative/now-playing.json")),
            Box::new(|v| v["snapshotPath"] = json!("/private/../now-playing.json")),
            Box::new(|v| v["homeId"] = json!("home")),
            Box::new(|v| v["placement"]["spaceOccurrenceId"] = json!("hall way")),
            Box::new(|v| v["placement"]["roomName"] = json!("Hallway")),
            Box::new(|v| v["profile"] = json!("houseatlas.radio-station-profile.v2")),
        ];
        for (index, mutate) in mutations.iter().enumerate() {
            let mut value = base.clone();
            mutate(&mut value);
            assert!(parse(&value).is_err(), "mutation {index}");
        }
    }
}
