# Nightly iCloud backup

`tools/backup/` backs up the HouseAtlas server to the owner's iCloud Drive every
night and proves each copy restores. It covers the Atlas database and retained
originals through the native `backup` CLI (profile `native-stock-queue-free`) and
the served model release. Like every native bundle it excludes the Access
database and sessions, credentials, server configuration, HomeBox originals and
Network source state; recover those through their own private procedures.

## What one run does

1. Stops the HouseAtlas launchd service, runs `houseatlas backup` against the
   live data directory, and starts the service again. The service is offline for
   the few seconds the capture takes, and the start runs even if capture fails.
2. Lists every file of the model publication folders named in the service's
   plist with its SHA-256 and size, after checking the manifests against the
   hashes the service was started with and the model files (`overview.glb`, and
   `detail.glb` when the manifest pins one) against the manifests' pins.
3. Runs `houseatlas restore-check` on the bundle: a full restore into a fresh
   private folder with the capture's validation peers, then every retained
   original is read back from the restored vault and compared byte for byte.
4. Stores each model file in the iCloud folder's `models/blobs/` once, named by
   its SHA-256, and only if no file of that name is there yet. A release that
   did not change since the last run therefore adds nothing; a new release adds
   only the files whose bytes differ, so a byte-identical `detail.glb` carried
   into a new release is not stored twice. Before the nightly archive goes up, iCloud
   must report every file it names as uploaded, reused ones included, and this
   run's new files are evicted locally.
5. Packs the bundle and report into one `.tar.gz` and copies it, with a
   `.sha256` file, into the configured iCloud Drive folder. The report lists the
   model files and their hashes; the archive does not carry them. Existing files
   are never overwritten.
6. Waits until iCloud reports the archive uploaded, evicts the local copy,
   downloads it again from iCloud, compares its hash, unpacks it and repeats the
   restore check on the downloaded copy. It then rebuilds the full model
   folders from `models/blobs/`, downloading any evicted blob, and checks every
   file's hash and every manifest's pins again.
7. Writes `<archive>.models.json` next to the archive: the blobs it needs, and
   that this run verified it. Then it applies the retention chosen in the
   app (below).

## Retention

The owner picks it in the app under Settings → Backups. The server stores the
choice as `retention.json` in a `backup/` folder in its data directory, and
the job finds that folder through the `--server-config` in the service plist,
so neither needs a new setting.

- **Forever** (the default, and what a missing or invalid file means) deletes
  nothing.
- **Recent + monthly** keeps tonight's archive, the newest archive of each of
  the last N nights that have one (7 to 365) and the first archive of each of
  the last M months that have one (0 to 120). Within a night or a month, an
  archive whose run was verified wins over one that was not. Everything else
  of the form `houseatlas-backup-<stamp>.tar.gz` and its sidecars is deleted
  from the iCloud folder, then every blob in `models/blobs/` that no kept
  archive names. Other files in the folder are never touched.

Retention runs only after the whole run succeeded, and reads every kept
archive's blob list before it deletes anything; an archive made before the
sidecars existed is downloaded once to read its report and gets a sidecar
then. If any list cannot be read, nothing is deleted that night, the job runs
`reportCommand`, and Settings says why.

After every run the job also writes `status.json` in that folder: the last
success (time, archive size, service downtime), the last failure if newer,
the retention it applied, what it deleted and what the iCloud folder holds.
Settings shows it.

Success writes `last-success.json` (recovery point, sizes, how many model
files were newly stored, what retention deleted, durations) in the state directory. A blob that exists
but no longer matches its name fails the model rebuild loudly; it is never
replaced automatically. Any failure writes `last-failure.json` and runs the optional
`reportCommand`. The NAS keeps the last `keepLocalArchives` archives locally.

## iCloud Drive permission

macOS asks for iCloud Drive access on the Mac's screen and waits there. On a
headless Mac nobody sees the prompt, so access hangs; jobs that launchd starts
directly through `/bin/sh` or Python are refused without a prompt. The job
therefore starts through `houseatlas-backup`, a tiny launcher built once by
`install.sh` and never rebuilt, which the owner allows once in the prompt (or in
System Settings > Privacy & Security > Files and Folders). Child processes
inherit that permission. Rebuilding the launcher invalidates it.

## Install

Create a private config (mode 0600) outside the repository:

```json
{
  "serviceLabel": "<launchd label of the server>",
  "servicePlist": "~/Library/LaunchAgents/<label>.plist",
  "stateDirectory": "~/.local/share/houseatlas-backup",
  "icloudDirectory": "~/Library/Mobile Documents/com~apple~CloudDocs/HouseAtlas Backups",
  "icloudHelper": "~/.local/share/houseatlas-backup/bin/houseatlas-icloud",
  "healthUrl": "https://<gateway>/api/atlas/auth/mode",
  "reportCommand": ["gh", "issue", "comment", "<n>", "--body", "{message}"]
}
```

Optional keys: `restoreCheckBinary` (defaults to the served binary),
`uploadTimeoutSeconds` (3600) and `keepLocalArchives` (3). Then run
`tools/backup/install.sh <config> --load`. The job runs daily at 04:00; start
one run now with `launchctl kickstart gui/$(id -u)/houseatlas.icloud-backup`.

## Restore

Never restore over the live data directory. Download an archive from the iCloud
folder, check it against its `.sha256`, unpack it into a new private folder, and
run `houseatlas restore-check --bundle <folder>/bundle --destination <new folder>
--profile native-stock-queue-free`. It leaves the restored database and media
vault in the destination for inspection. Then rebuild the model release from
the blob store into another new folder:

```sh
python3 tools/backup/houseatlas_backup.py --restore-models <folder>/backup-report.json \
  --store "<iCloud folder>/models" --destination <new model folder>
```

It writes `releases/<version>/` with every file the served release had (modes
0700/0600) and checks each hash and model pin. Archives made before the blob
store carry the release in their own `model/` folder instead. To serve a restored copy, build
a fresh data directory from it with compatible code and supply current Access
state, configuration and credentials separately, as
[recovery-and-rollback.md](recovery-and-rollback.md) describes.
