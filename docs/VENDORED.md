# Vendored third-party files

Every file below `editor/vendor/` (and, for the STEP Viewer, the files in `licenses/`) is a third-party file that this project does **not** write. Each one is a copy of a file in a pinned npm package, except where a note says otherwise. This page lists, for every such file, where it comes from, its version, its license, its size and its SHA-256, and how to verify and rebuild it. Sizes and SHA-256 values were measured on the files of this folder (version 0.35.0) and agree with `dev/vendor.json`.

## Verify and rebuild

```sh
npm ci                         # installs the exact packages locked in package-lock.json (integrity hashes)
npm run build                  # copies the files out of node_modules into editor/vendor
npm run verify-build           # rebuilds into a temporary folder and compares with the committed files (exit 1 on any difference)
node dev/vendor.mjs --check    # offline: the SHA-256 of every vendored file against dev/vendor.json
```

`dev/vendor.json` is the machine-readable source of this page (package, version, tarball integrity, file path inside the package, SHA-256). `THIRD_PARTY_NOTICES.md` has the license notices. Anything that is not listed here is the project's own code (MIT, see `LICENSE`), including `editor/shared/`. No file listed here is minified or otherwise transformed by this project; the one patched file (the converter glue of the STEP Viewer) is marked below.

## three 0.187.0 (MIT)

- npm: https://www.npmjs.com/package/three/v/0.187.0
- source: https://github.com/mrdoob/three.js/tree/r187
- tarball integrity: `sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==` (equals the entry in `package-lock.json`)
- note: three.module.js and three.core.js are the builds of this npm release as published (build/); the npm package ships no minified builds since r187, so the readable files are vendored unchanged.

| File in this repository | Path in the package | Size | License | SHA-256 |
| --- | --- | ---: | --- | --- |
| `editor/vendor/three.module.js` | `build/three.module.js` | 658,900 B | MIT (three.js r187) | `104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341` |
| `editor/vendor/three.core.js` | `build/three.core.js` | 1,474,799 B | MIT (three.js r187) | `613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578` |
| `editor/vendor/LICENSE.three.txt` | `LICENSE` | 1,081 B | license text | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `editor/vendor/addons/controls/OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` | 40,918 B | MIT (three.js r187) | `e7fca2fe9e7670a828af9b28084669a5909445b7f36f1f26cee9bf8f2961c32c` |

Subtotal of this package: 2,175,698 B.

## occt-import-js 0.0.23 (LGPL-2.1)

- npm: https://www.npmjs.com/package/occt-import-js/v/0.0.23
- source: https://github.com/kovacsv/occt-import-js/tree/0.0.23
- tarball integrity: `sha512-RFfYQXYFX5C1mB1Aywm0ShcUKzXOr/VzTnlzhBSDJOR6YCAPt1HYCzeXWg1vwwjn/cUxwqRNhhtf1dlewoZYCQ==` (equals the entry in `package-lock.json`)
- note: The .wasm is the unmodified npm file, shipped as a plain file (editor/vendor/occt/occt-import-js.wasm; the Orca catalog rejects archives such as .gz). The original glue file is kept in licenses/original; editor/vendor/occt/occt-import-js.js is rebuilt from it by dev/patch-occt.mjs (two Function-constructor calls are replaced).

| File in this repository | Path in the package | Size | License | SHA-256 |
| --- | --- | ---: | --- | --- |
| `editor/vendor/occt/occt-import-js.wasm` | `dist/occt-import-js.wasm` | 7,604,031 B | LGPL-2.1 (occt-import-js 0.0.23) | `33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952` |
| `licenses/original/occt-import-js-0.0.23.js` | `dist/occt-import-js.js` | 96,871 B | LGPL-2.1 (occt-import-js 0.0.23) | `3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379` |
| `editor/vendor/occt/occt-import-js.js` | (generated from the original file by `dev/patch-occt.mjs`; patched) | 97,944 B | LGPL-2.1 (occt-import-js 0.0.23) | `6b6c2651245a711c259e712f8ee6653f57a07bdf84050be168d9237bde9fcde5` |

Subtotal of this package: 7,798,846 B.

## meshoptimizer 1.3.0 (MIT)

- npm: https://www.npmjs.com/package/meshoptimizer/v/1.3.0
- source: https://github.com/zeux/meshoptimizer
- tarball integrity: `sha512-2oZqMAcEEiCtXWUjIGtZ71oPx1B0ZxYGTqIKsXB1wzWFhleNsCFxQuUJzgCV706bRcwPWtMGf1odmQvAcqKkIw==` (equals the entry in `package-lock.json`)
- note: Encoder (compression for EXT_meshopt_compression) and simplifier (decimation, point thinning), each a JavaScript file with its WebAssembly embedded as text; loaded only when a tool is used. The decoder that opens such files is the one inside three.js (examples/jsm/libs/meshopt_decoder.module.js, 0.22).

| File in this repository | Path in the package | Size | License | SHA-256 |
| --- | --- | ---: | --- | --- |
| `editor/vendor/meshopt/meshopt_encoder.js` | `meshopt_encoder.js` | 24,363 B | MIT (meshoptimizer 1.3.0) | `22c128be3e22b187e2d2661882fc62f51e995f409c0fe14c9f6358cfbaff1611` |
| `editor/vendor/meshopt/meshopt_simplifier.js` | `meshopt_simplifier.js` | 67,671 B | MIT (meshoptimizer 1.3.0) | `c3098ee4cb4fc242b84f064c88898e76e44bf58b0e1f693507f323c08cdbb5ed` |
| `editor/vendor/meshopt/LICENSE.meshoptimizer.txt` | `LICENSE.md` | 1,079 B | license text | `f03037ca7bad1e3eb7f4a63fa6084a8baabd5ba30d3c239a9a7f35705d873e26` |

Subtotal of this package: 93,113 B.

## License texts that are not part of an npm file list

| File | Size | SHA-256 |
| --- | ---: | --- |
| `licenses/LICENSE-LGPL-2.1.txt` | 26,434 B | `e237fa56668030e928551ddd60f05df5fe957f75eab874bbd017e085ed722e7c` |
| `licenses/OCCT-LGPL-EXCEPTION-1.0.txt` | 663 B | `04580a884ea6cea294402649ff7b5cbb167d47462d1340a4ed33e550db10a81b` |

Total of all files listed in the package tables: 10,067,657 B.

## Corresponding source of the LGPL-2.1 converter

The converter (`occt-import-js` 0.0.23, which contains Open CASCADE Technology 7.6.1) is LGPL-2.1 with the Open CASCADE exception. The WebAssembly file and the original glue file are shipped as plain files so that they can be replaced by a modified build; `README.md` and `THIRD_PARTY_NOTICES.md` describe how. The complete corresponding source is attached to the GitHub release of each version as `occt-import-js-0.0.23-corresponding-source.tar.gz`; its SHA-256 is stated in `README.md` and `THIRD_PARTY_NOTICES.md`.
