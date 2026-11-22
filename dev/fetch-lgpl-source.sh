#!/bin/sh
# Builds the "corresponding source" archive for the LGPL-2.1 converter (see THIRD_PARTY_NOTICES.md, "Corresponding source").
#
#   sh dev/fetch-lgpl-source.sh [OUT_DIR]     needs git and network access; writes OUT_DIR/occt-import-js-0.0.23-corresponding-source.tar.gz
#
# The archive holds the occt-import-js tag 0.0.23 and the Open CASCADE Technology commit that tag pins (the submodule), both exactly as
# upstream has them, plus a SOURCES.txt with the commits. It is attached to each GitHub release of this plugin (a release asset, not a file
# in the repository, which keeps the repository small and free of archives).
set -eu
OUT=${1:-./lgpl-source}
OCCT_IMPORT_TAG=0.0.23
OCCT_COMMIT=d2abb6d844231cb8f29be6894440874a4700e4a5
mkdir -p "$OUT"; work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
git clone --quiet --branch "$OCCT_IMPORT_TAG" https://github.com/kovacsv/occt-import-js.git "$work/occt-import-js"
mkdir -p "$work/OCCT"
git -C "$work/OCCT" init --quiet
git -C "$work/OCCT" fetch --quiet --depth 1 https://github.com/Open-Cascade-SAS/OCCT.git "$OCCT_COMMIT"
git -C "$work/OCCT" checkout --quiet FETCH_HEAD
got=$(git -C "$work/OCCT" rev-parse HEAD)
[ "$got" = "$OCCT_COMMIT" ] || { echo "OCCT commit $got is not the pinned $OCCT_COMMIT" >&2; exit 1; }
printf 'occt-import-js %s  https://github.com/kovacsv/occt-import-js\nOpen CASCADE Technology commit %s  https://github.com/Open-Cascade-SAS/OCCT\n' "$OCCT_IMPORT_TAG" "$OCCT_COMMIT" > "$work/SOURCES.txt"
rm -rf "$work/occt-import-js/.git" "$work/OCCT/.git"
tar -czf "$OUT/occt-import-js-$OCCT_IMPORT_TAG-corresponding-source.tar.gz" -C "$work" SOURCES.txt occt-import-js OCCT
shasum -a 256 "$OUT/occt-import-js-$OCCT_IMPORT_TAG-corresponding-source.tar.gz"
