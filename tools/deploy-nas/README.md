# deploy-nas

One command to put a `main` commit or a model release on the NAS, and one to
undo it. It runs on the NAS itself, as the user that owns the launchd service.

```sh
tools/deploy-nas/deploy-nas status                  # live binary, commit, model, gateway, recent records
tools/deploy-nas/deploy-nas deploy <main-sha>       # build, smoke-test, swap, verify
tools/deploy-nas/deploy-nas model <release-dir>     # switch the served model, verify
tools/deploy-nas/deploy-nas rollback                # undo the newest live record, verify
```

`deploy` and `model` take `--prepare-only` to stop before the live service is
touched. They roll back on their own when gateway verification fails; pass
`--no-auto-rollback` to leave a failed release up for inspection.

## What `deploy <sha>` does

1. Clones the repository fresh and refuses a commit that is not on `origin/main`.
2. Diffs the live build's commit against the new one. Changes under
   `backend/migrations/`, `backend/src/storage/`, any `.sql` file or a backend
   `schema*.rs` stop the deploy until someone has reviewed them and passes
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

Nothing live is touched before step 6. Every earlier build folder and parked
frontend is kept, so any record can be undone.

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

## Records and rollback

Each deploy or model switch is a record in `<SETUP_ROOT>/deploy-nas/ledger.jsonl`
with its folder, the plist before and after, and the frontend it parked.
`rollback` undoes the newest record that is live: it restores that record's
`service.before.plist` and, for code, moves the parked frontend back. It refuses
when the plist has changed since the record was made (someone edited it by hand)
unless you pass `--force`. Run it again to step back one more record.

Each record folder also holds `recovery/rollback.sh`, a standalone shell undo for
when this checkout is unavailable, plus `events.log`, `gateway-verify.txt` and
the smoke results. Only one deploy-nas command runs at a time.

## Host config

Host paths, hostnames and IDs stay out of Git. The tool reads
`~/.config/houseatlas/deploy-nas.env` (or `$HOUSEATLAS_DEPLOY_CONFIG`):

```sh
SETUP_ROOT=~/path/to/deploy/folders        # build folders, ledger, lock
TOOLCHAIN_ROOT=~/path/with/cargo/and/rustup # optional; sets CARGO_HOME and RUSTUP_HOME
PLIST=~/Library/LaunchAgents/<label>.plist
SERVICE_LABEL=<label>
GATEWAY_URL=https://<gateway host>
SMOKE_TEMPLATE=~/.config/houseatlas/smoke-server.json
# BUILD_TARGET=x86_64-apple-darwin  REPO_URL=...  STOP_TIMEOUT=30  START_TIMEOUT=90
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
