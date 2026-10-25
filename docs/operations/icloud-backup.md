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
2. Copies the model publication folders named in the service's plist and checks
   their manifests against the hashes the service was started with.
3. Runs `houseatlas restore-check` on the bundle: a full restore into a fresh
   private folder with the capture's validation peers, then every retained
   original is read back from the restored vault and compared byte for byte.
4. Packs the bundle, model and report into one `.tar.gz` and copies it, with a
   `.sha256` file, into the configured iCloud Drive folder. Existing files are
   never overwritten and nothing in iCloud is ever deleted.
5. Waits until iCloud reports the archive uploaded, evicts the local copy,
   downloads it again from iCloud, compares its hash, unpacks it and repeats the
   restore check and model check on the downloaded copy.

Success writes `last-success.json` (recovery point, sizes, durations) in the
state directory. Any failure writes `last-failure.json` and runs the optional
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
vault in the destination for inspection. To serve a restored copy, build
a fresh data directory from it with compatible code and supply current Access
state, configuration and credentials separately, as
[recovery-and-rollback.md](recovery-and-rollback.md) describes.
