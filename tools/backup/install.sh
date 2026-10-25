#!/bin/sh
# Installs the nightly iCloud backup for the current user on the NAS.
# The launcher is built only once: macOS ties the iCloud Drive permission to
# its exact bytes, so rebuilding it would ask for permission again.
# Usage: tools/backup/install.sh <config.json> [--load]
set -eu
config=${1:?usage: install.sh <config.json> [--load]}
here=$(cd "$(dirname "$0")" && pwd)
state=$(python3 -c 'import json,os,sys; print(os.path.expanduser(json.load(open(sys.argv[1]))["stateDirectory"]))' "$config")
label=${HOUSEATLAS_BACKUP_LABEL:-houseatlas.icloud-backup}
plist="$HOME/Library/LaunchAgents/$label.plist"
python=$(command -v python3)

mkdir -p "$state/bin" "$state/logs"
chmod 700 "$state"
if [ ! -x "$state/bin/houseatlas-backup" ]; then
  clang -O2 -o "$state/bin/houseatlas-backup" "$here/launcher.c"
  codesign -s - -i houseatlas.backup -f "$state/bin/houseatlas-backup"
fi
swiftc -O -o "$state/bin/houseatlas-icloud" "$here/icloud.swift"
install -m 0700 "$here/houseatlas_backup.py" "$state/bin/houseatlas_backup.py"
sed -e "s#@LABEL@#$label#" -e "s#@STATE@#$state#g" -e "s#@PYTHON@#$python#" \
  -e "s#@CONFIG@#$(cd "$(dirname "$config")" && pwd)/$(basename "$config")#" \
  "$here/launchd.plist.template" > "$plist.new"
plutil -lint "$plist.new" >/dev/null
mv "$plist.new" "$plist"
echo "installed $plist"
if [ "${2:-}" = "--load" ]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "loaded $label (runs daily at 04:00)"
fi
