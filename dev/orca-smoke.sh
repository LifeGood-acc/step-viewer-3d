#!/bin/sh
# Smoke test in the real Orca: opens every sample in the plugin's editor with `orca plugin shot` and fails if any editor does
# not mount (the failure mode "text file, bytes editor" only shows up here, not in a browser).
#   dev/orca-smoke.sh [plugin-key]        default key: local.<id from orca-plugin.json> (the plugin must be loaded in Orca)
# Needs the Orca desktop app with a workspace; shots go to a temporary folder.
set -u
ORCA="${ORCA_CLI_COMMAND:-orca}"
here="$(cd "$(dirname "$0")/.." && pwd)"
key="${1:-local.$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$here/orca-plugin.json" | head -1)}"
out="$(mktemp -d)"
fail=0
for f in "$here"/samples/*; do
  case "$f" in *.py) continue ;; esac
  name="$(basename "$f")"
  json="$("$ORCA" plugin shot "$key" --editor "$f" --out "$out/$name.png" --json 2>&1)"
  if printf '%s' "$json" | grep -q '"ok": *true' && ! printf '%s' "$json" | grep -q '"errors": *\[ *"'; then
    echo "ok    $name"
  else
    echo "FAIL  $name: $(printf '%s' "$json" | tr -d '\n' | sed -n 's/.*"message": *"\([^"]*\)".*/\1/p')"
    fail=1
  fi
done
# the start page (no file): the sidebar panel, and the start file that "new file" creates
json="$("$ORCA" plugin shot "$key" --panel viewer --out "$out/panel.png" --json 2>&1)"
if printf '%s' "$json" | grep -q '"ok": *true'; then echo "ok    panel (start page)"; else echo "FAIL  panel: $(printf '%s' "$json" | tr -d '\n' | sed -n 's/.*"message": *"\([^"]*\)".*/\1/p')"; fail=1; fi
rm -rf "$out"
exit $fail
