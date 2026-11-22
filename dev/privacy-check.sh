#!/bin/sh
# Privacy check: nothing private may be in this repository, neither in a file nor anywhere in the Git history.
#
#   sh dev/privacy-check.sh          exit 0 = no findings, exit 1 = findings (listed)
#
# It looks in (1) every tracked and untracked-but-not-ignored file, (2) the full history of ALL branches and tags (every diff, every
# commit message, author and committer), (3) branch and tag names, (4) image metadata of the PNG files (text, EXIF, time chunks).
# Looked for: absolute user paths, e-mail addresses (except noreply ones; vendored third-party files and licenses are exempt from this one
# rule), access tokens and private keys, names of private projects and tools, and any extra words listed one per line in
# dev/privacy-words.local (git-ignored, so that private names never get into the repository by being listed here).
# Patterns are written with a bracketed letter so that this file does not match itself.
set -u
LC_ALL=C; export LC_ALL
cd "$(dirname "$0")/.." || exit 2
found=0
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

pat_common='/Use[r]s/|/hom[e]/[a-z]|C:\\Use[r]s|mac[m]ap|3D-[M]ac|[~]/(Movies|Documents|Desktop|Downloads)/|/priva[t]e/(var|tmp)/|/Volume[s]/'
pat_tokens='gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|BEGIN [A-Z ]*PRIVATE KEY|npm_[A-Za-z0-9]{30,}|GH_TOKEN=[A-Za-z0-9]'
pat_mail='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
mail_ok='noreply|no-reply|@invalid\.example'
words=''
[ -f dev/privacy-words.local ] && words=$(grep -v '^[[:space:]]*\(#\|$\)' dev/privacy-words.local | paste -sd'|' -)

# the publisher account name is meant to be public, and Emscripten's virtual home is a fixed string of the converter: take both out before the search
strip_public() { sed -e 's#/home/web_user#EMSCRIPTEN_HOME#g' -e 's/LifeGood-acc/PUBLISHER/g' -e 's/lifegood-acc/PUBLISHER/g'; }

report() { # $1 = label, stdin = findings
  n=$(wc -l < "$tmp/f"); if [ "$n" -gt 0 ]; then echo "FINDINGS ($1): $n"; head -20 "$tmp/f" | cut -c1-200; found=$((found + n)); else echo "ok: $1"; fi
}

scan_stream() { # stdin = text; prints matching lines with the rule that hit (the text is buffered: every rule must see all of it; the token rule skips lines over 2000 characters, i.e. embedded base64 WebAssembly, which matches token shapes by chance)
  cat > "$tmp/scan.in"
  strip_public < "$tmp/scan.in" > "$tmp/scan.txt"
  grep -aEn "$pat_common" "$tmp/scan.txt" | sed 's/^/path-or-private-name: /'
  if [ -n "$words" ]; then grep -aEin "$words" "$tmp/scan.txt" | sed 's/^/private-word: /'; fi
  awk 'length($0) < 2000' "$tmp/scan.txt" | grep -aEn "$pat_tokens" | sed 's/^/token: /'
}

# 1) files
files=$(git ls-files -co --exclude-standard)
: > "$tmp/f"
for f in $files; do
  case "$f" in dev/privacy-check.sh) continue;; esac
  { scan_stream < "$f"; case "$f" in editor/vendor/*|licenses/*|THIRD_PARTY_NOTICES.md|package-lock.json) ;; *) strip_public < "$f" | grep -aEon "$pat_mail" | grep -aviE "$mail_ok" | sed 's/^/e-mail: /';; esac; } | sed "s|^|$f: |" >> "$tmp/f"
done
report "files ($(echo "$files" | wc -l | tr -d ' ') files)"

# 2) history, all refs: every diff and message
: > "$tmp/f"
git log --all -p --no-color --format='COMMIT %H%n%an <%ae>%n%cn <%ce>%n%B' > "$tmp/history"
# e-mail rule: not for vendored third-party files (editor/vendor, licenses, notices, lock file); the diff header tells which file a line belongs to
awk '/^diff --git /{skip = ($0 ~ / b\/(editor\/vendor\/|licenses\/|THIRD_PARTY_NOTICES\.md|package-lock\.json)/)} !skip' "$tmp/history" > "$tmp/history-own"
{ scan_stream < "$tmp/history"; grep -aEon "$pat_mail" "$tmp/history-own" | grep -aviE "$mail_ok" | sed 's/^/e-mail: /'; } | sed 's/^/history: /' >> "$tmp/f"
report "history ($(git rev-list --all --count) commits, $(git for-each-ref refs/heads refs/tags | wc -l | tr -d ' ') refs)"

# 3) identities, ref names, tag messages
: > "$tmp/f"
git log --all --format='%an <%ae>%n%cn <%ce>' | sort -u > "$tmp/ids"
grep -vE '^[A-Za-z0-9 .-]+ contributors <[^ ]*(noreply|invalid\.example)[^ ]*>$' "$tmp/ids" | sed 's/^/identity not neutral: /' >> "$tmp/f"
git for-each-ref --format='%(refname) %(taggername) %(taggeremail)' | scan_stream | sed 's/^/ref: /' >> "$tmp/f"
git config --local --get-regexp '^(user|remote)\.' 2>/dev/null | grep -aE 'remote\..*url|user\.email' | grep -aviE "$mail_ok|github\.com[/:]LifeGood-acc/" | sed 's/^/local git config: /' >> "$tmp/f"
report "identities (author and committer neutral \"... contributors\" noreply) and ref names"

# 4) image metadata
: > "$tmp/f"
for f in $(echo "$files" | grep -iE '\.(png|jpe?g|webp|gif)$'); do
  python3 - "$f" <<'PY' >> "$tmp/f"
import sys, struct
p = sys.argv[1]; d = open(p, 'rb').read()
if d[:8] == b'\x89PNG\r\n\x1a\n':
    i = 8
    while i < len(d):
        n, t = struct.unpack('>I4s', d[i:i+8]); t = t.decode('latin1')
        if t in ('tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME', 'pHYs' if False else 'tIME'):
            print(f'{p}: metadata chunk {t}')
        i += 12 + n
else:
    if b'Exif' in d[:64] or b'http://ns.adobe.com' in d: print(f'{p}: EXIF/XMP present')
PY
  grep -aEq "$pat_common|$pat_tokens${words:+|$words}" "$f" && echo "$f: private string inside the image bytes" >> "$tmp/f"
done
report "image metadata"

if [ "$found" -gt 0 ]; then echo "PRIVACY CHECK FAILED: $found finding(s)"; exit 1; fi
echo "PRIVACY CHECK PASSED: 0 findings"
