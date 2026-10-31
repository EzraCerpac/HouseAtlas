# deploy-nas

One command to put a `main` commit or a model release on the NAS, and one to
undo it. It runs on the NAS itself, as the user that owns the launchd service.

```sh
tools/deploy-nas/deploy-nas status                  # live binary, commit, model, gateway, recent records
tools/deploy-nas/deploy-nas deploy <main-sha>       # build, smoke-test, swap, verify
tools/deploy-nas/deploy-nas model <release-dir>     # switch the served model, verify
tools/deploy-nas/deploy-nas rollback                # undo the newest live record, verify
tools/deploy-nas/deploy-nas prune [--dry-run]       # remove caches and frontends no rollback needs
```

`deploy` and `model` take `--prepare-only` to stop before the live service is
touched. They roll back on their own when gateway verification fails; pass
`--no-auto-rollback` to leave a failed release up for inspection.

## What `deploy <sha>` does

1. Clones the repository fresh and refuses a commit that is not on `origin/main`.
2. Diffs the live build's commit against the new one. Changes under
   `backend/migrations/`, `backend/src/storage/`, any `.sql` file, a backend
   `schema*.rs`, the network sidecar and archive stores, or any backend line with
   embedded SQL DDL or a schema version stop the deploy until someone has
   reviewed them and passes
   `--storage-reviewed '<reason>'`. The reason is kept with the build.
3. Builds the backend (`cargo build --release --locked`) and the frontend
   (`npm ci`, `typecheck`, `build`, `check:backend-frontend-compat`), reusing the
   previous build's caches.
4. Stages the binary in a new `houseatlas-main-<sha7>-<date>-vN/` folder and the
   frontend next to the live one. The staged frontend is the new build plus every
   older top-level hashed asset, so tabs opened on an earlier build keep loading.
   An asset name reused with different bytes stops the deploy.
5. Starts the new binary on throwaway state (the smoke template, a fresh data
   folder, the live model pins) and checks it: login, the app shell and
   service-worker pages are `private, no-store`, old and new entry scripts are
   `immutable`, session/view/rooms answer, the model GLB matches its descriptor's
   SHA-256, and logout ends the session.
6. Stops the service, waits for the old process to exit, parks the live frontend,
   moves the staged one in, writes the new plist and bootstraps it. Then it runs
   the same checks through the gateway against the real service.

Nothing live is touched before step 6. Every earlier build folder is kept.

7. Once the gateway checks pass, prunes what no build or rollback will read again
   (see below) and logs it in the record. `--no-prune` skips this.

## What `model <release-dir>` does

Follows the release contract on #304: a release folder is `0700`, its files are
`0600` with one link each, everything is owned by the service user, the path is
canonical and outside the native data folder. It must hold `publication.json`,
`atlas-scene.json`, `overview.glb` and `reviewed-room-links.json`: the server
refuses to start when the room links do not match the selected scene, so a
release carries its own copy. The command repoints `--model-overview-manifest`,
`--atlas-scene-manifest` and `--atlas-room-links-manifest` with freshly computed
SHA-256 pins, smoke-tests the live binary with
those flags, restarts the service and checks through the gateway that the new
`publicationId` is served and its GLB matches. Rolling back restores the
previous flags.

## Optional display policy

`policy SOURCE --sha256 SHA256 [--prepare-only]` stages a NEW immutable release
for the currently selected publication. The source is a reviewed canonical
owner-private file (0600, one link, at most 32 KiB, private 0700 parent), with the
exact `houseatlas.atlas-display-selection.v1` contract described in
[the Atlas contract](../../docs/models/unified-atlas-scene-v1.md).

The existing tool verifies the current service's publication/scene/room-link
paths and pins, copies those exact files plus overview and optional Full GLB to
a new private release outside the active pinned directory, and adds
`display-policy.json`. It checks copied hashes, source identities and the
original service hash, then uses the existing model transaction and ledger.
Publication/model/scene bytes and identities remain unchanged; selectors are
never translated by names, source indices or proximity.

Nothing is inserted into the active publication directory. Staging and smoke
happen before the old service is stopped; inputs are revalidated before the
existing stopped-service plist swap. The new server validates the co-resident
policy again at startup. The old release and its files remain intact for exact
prior-argument rollback. Interrupted/failed staging is not an activation and
does not delete its private evidence.

Both code-deploy smoke and gateway verification carry configured policy
arguments and check the protected descriptor/body pins, context, revision and
private/no-store response. Unconfigured operations make no policy request.
A later `model` switch with a selected policy must provide a matching
`display-policy.json` in its inactive release, or deliberately use
`--without-display-policy`. The tool refuses silent carry-over; retirement
removes only the argument pair, never old private files. Replacement and
retirement cannot be requested together.

`--prepare-only` leaves a prepared record and does not activate it. There is
no invented resume command: any later real operation needs the existing sole
operator's explicit activation window and current-input checks. Rollback
restores the recorded prior plist and selected paths, preserving both releases;
an older binary is never paired with newly appended flags by manual editing.
Do not change files under a running process's pinned directory or hand-edit its
arguments around the ledger.

The existing synthetic test module covers argument handling, private-source
bounds, staging without active-directory writes, stale service/input refusal,
fake HTTP pin checks and fake-service rollback. It launches no service/network
or browser. Source/CI success does not establish private configuration,
installed readback, model/device/visual acceptance or a released activation.

## Records and rollback

Each deploy or model switch is a record in `<SETUP_ROOT>/deploy-nas/ledger.jsonl`
with its folder, the plist before and after, and the frontend it parked.
`rollback` undoes the newest record that is live: it restores that record's
`service.before.plist` and, for code, moves the parked frontend back. It refuses
when the plist has changed since the record was made (someone edited it by hand)
unless you pass `--force`. Run it again to step back one more record.

Each record folder also holds `recovery/rollback.sh`, a standalone shell undo for
when this checkout is unavailable (it refuses, before stopping anything, when the
parked frontend is gone and it did not restore it itself), plus `events.log`,
`gateway-verify.txt` and the smoke results. Only one deploy-nas command runs at a time.

## Pruning

A deploy seeds `target/` and `npm-cache/` from the live build's inputs only, so
older copies just fill the disk. After a verified deploy, and with
`deploy-nas prune`, the tool removes:

- `target/` and `npm-cache/` in every `houseatlas-main-*-inputs/` folder except
  the live build's and the build `rollback` returns to. Sources, logs, smoke
  results and the reports stay.
- `frontend.before-*` next to the live frontend, except those of the newest 3
  code records `rollback` can still undo (rolled-back records do not count). So
  `rollback` can step back 3 code records; past that it refuses, as it does
  whenever a parked frontend is gone.
- `frontend.next-*`, `frontend.rolled-back-*` and `frontend.restored-*` leftovers.

It never removes a folder that a path in the service plist, the live server config
or the smoke template points into, a frontend an unfinished record (or the newest
prepared one) names, or anything reached through a symlink. Release folders, the
ledger, model releases and anything outside those two folders are not candidates.
`--dry-run` lists what would go and records nothing. A deploy's prune is the
`prune` entry on its record; a `deploy-nas prune` run is its own ledger record
(`kind: prune`, `status: pruned`), which `rollback` skips. The entry lists each
removed folder with its allocated size, and `freedBytes` is the space the volume
actually gained (clones share blocks, so it is less than the sum). A failed prune
is reported and never fails the deploy.

## Host config

Host paths, hostnames and IDs stay out of Git. The tool reads
`~/.config/houseatlas/deploy-nas.env` (or `$HOUSEATLAS_DEPLOY_CONFIG`):

```sh
# Build folders, ledger and lock
SETUP_ROOT=~/path/to/deploy/folders
# Optional: the folder holding cargo/ and rustup/, used as CARGO_HOME and RUSTUP_HOME
TOOLCHAIN_ROOT=~/path/with/cargo/and/rustup
PLIST=~/Library/LaunchAgents/<label>.plist
SERVICE_LABEL=<label>
GATEWAY_URL=https://<gateway host>
SMOKE_TEMPLATE=~/.config/houseatlas/smoke-server.json
# Optional: BUILD_TARGET (x86_64-apple-darwin), REPO_URL, STOP_TIMEOUT (30), START_TIMEOUT (90)
```

`SMOKE_TEMPLATE` is a server config with `loopback-local` authentication on a
port the live service does not use; its first home supplies the workspace and
home IDs for the checks. The tool overrides its data, log and frontend folders
and deployment ID on every run.

## Tests

```sh
python3 -m unittest discover -s tools/deploy-nas -p 'test_*.py'
```

They use temporary folders and a fake service; they start no process, call no
launchd and touch no network.
