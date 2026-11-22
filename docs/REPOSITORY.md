# Repository layout and release rules

Fixed before the first release tag, because moving a plugin to another folder or repository later counts as a transfer for the
plugin catalog (new versions are paused until the move is confirmed).

- **One plugin, one repository.** The plugin manifest `orca-plugin.json` is at the repository root, so the catalog entry needs no
  `source.path` (`orca plugin release-entry .` prints none). Do not move the plugin into a subfolder or a monorepo after the first tag.
- **Entry points** are `editor/index.html` (editor) and `editor/panel.html` (sidebar panel, a byte copy of `index.html`; Orca builds
  one frame per entry file). Shared layout code is `editor/shared/` (canonical copy outside this repository, see the test that checks it).
- **No binary sample files in the repository.** The catalog rejects archives and other binary files, so a sample must be text or
  generated. The one sample here, `samples/assembly.step`, is a small text file; only images (`assets/`, `docs/images/`) and the
  converter's WebAssembly are binary files in this repository (a test checks it).
- **No minified code without its source.** The minified or compiled files are upstream's, not ours: the converter glue and its WebAssembly (three.js and meshoptimizer's wrapper are copied byte for byte from pinned npm packages), and the converter glue (Emscripten output, only the two `Function` calls patched); the converter glue `occt-import-js.js` is rebuilt from the upstream file by `dev/patch-occt.mjs`; `dev/vendor.json` records every vendored file (package, path inside it, SHA-256) and each package's integrity,
  `node dev/vendor.mjs --check` verifies them offline and `--update` rebuilds them from npm. `THIRD_PARTY_NOTICES.md` lists the origins.
- **Cover and screenshots** (`docs/images/`, cover 1600 x 1000 = 16:10, icon 256 x 256) show only generated example scenes: the synthetic `samples/assembly.step` (written for this repository). None shows a file from a real project; add new ones the same way.
- **Names.** The display name must not start with the word "Orca"; the plugin id must not start with `orca-`.
- **Versions and tags are final** (a moved tag is rejected). Release only from a clean `main`.
- Nothing is published or pushed from this working copy; publishing is a separate decision.
