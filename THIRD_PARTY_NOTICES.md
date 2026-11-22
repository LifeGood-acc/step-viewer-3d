# Third-party notices

STEP Viewer 3D's own code is MIT-licensed (see [LICENSE](LICENSE)). It bundles the following third-party components,
in `editor/vendor/` (three.js and the WebAssembly file unmodified, one JavaScript file with a documented patch). Nothing is downloaded at run time.

| Component | npm package, version | License | Files | Source |
| --- | --- | --- | --- | --- |
| **occt-import-js** (Emscripten build of OpenCascade) | `occt-import-js@0.0.23` | **LGPL-2.1** | `editor/vendor/occt/occt-import-js.js` (patched, see below), `editor/vendor/occt/occt-import-js.wasm.gz` (unmodified content, gzip-compressed) | https://github.com/kovacsv/occt-import-js, tag 0.0.23 |
| **Open CASCADE Technology (OCCT)** inside that build | 7.6.1 (git commit `d2abb6d844231cb8f29be6894440874a4700e4a5`, the revision the occt-import-js 0.0.23 source tree pins) | **LGPL-2.1 with the Open CASCADE exception 1.0** | compiled into `occt-import-js.wasm` (shipped as `occt-import-js.wasm.gz`) | https://github.com/Open-Cascade-SAS/OCCT at that commit; https://dev.opencascade.org |
| three.js (core) | `three@0.187.0` (`build/three.module.js`, `build/three.core.js`) | MIT, Copyright © 2010-2026 three.js authors | `three.module.js`, `three.core.js` | https://github.com/mrdoob/three.js (tag r187) |
| three.js controls | `three@0.187.0` (`examples/jsm/controls/OrbitControls.js`) | MIT, same as three.js | `addons/controls/OrbitControls.js` | same package |
| meshoptimizer encoder and simplifier (tools, loaded only when used) | `meshoptimizer@1.3.0` (`meshopt_encoder.js`, `meshopt_simplifier.js`; WebAssembly embedded as text) | MIT, Copyright (C) 2016-2026 Arseny Kapoulkine | `meshopt/meshopt_encoder.js`, `meshopt/meshopt_simplifier.js`, `meshopt/LICENSE.meshoptimizer.txt` | https://github.com/zeux/meshoptimizer |

## Where each file comes from (npm)

Every vendored file is a byte-identical copy of a file in an npm package (the one exception is the patched glue file, which is
rebuilt from the original by `dev/patch-occt.mjs`). `dev/vendor.json` records, for each file, the package, the file's path inside it and
its SHA-256, plus the package tarball's integrity (sha512, as npm publishes it). **Reproducible build:** `npm ci && npm run build` (versions and integrity hashes are locked in `package.json` and `package-lock.json`) copies the files out of the npm packages into `editor/vendor/`; `npm run verify-build` does it in a temporary folder and compares with the committed files.
The converter glue is rebuilt from the original by `dev/patch-occt.mjs` (part of `npm run build`).

`node dev/vendor.mjs --check` verifies the files
offline (the unit tests run it); `node dev/vendor.mjs --update` downloads each package with `npm pack`, verifies the integrity and
rebuilds the files, which must come out byte-identical. **No file is minified by this project.** The only minified JavaScript is upstream's: the occt-import-js glue, which is Emscripten output as published. `three.module.js` and `three.core.js` are the readable builds in `three@0.187.0` (`build/`; the package ships no `.min.js` any more) and come from the tag r187 in the GitHub repository. The occt-import-js glue is the
upstream Emscripten output (as published, not minified by us); its source is the occt-import-js repository above.

Package integrity (from the npm registry): `three@0.187.0` `sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==`;
`occt-import-js@0.0.23` `sha512-RFfYQXYFX5C1mB1Aywm0ShcUKzXOr/VzTnlzhBSDJOR6YCAPt1HYCzeXWg1vwwjn/cUxwqRNhhtf1dlewoZYCQ==`;
`meshoptimizer@1.3.0` `sha512-2oZqMAcEEiCtXWUjIGtZ71oPx1B0ZxYGTqIKsXB1wzWFhleNsCFxQuUJzgCV706bRcwPWtMGf1odmQvAcqKkIw==`.

Checksums (SHA-256) of the converter files as shipped, and of the original glue file they were made from:

```
33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952  editor/vendor/occt/occt-import-js.wasm.gz   (the CONTENT of this gzip file is unmodified and identical to npm occt-import-js@0.0.23's dist/occt-import-js.wasm; the plugin unpacks it with the browser's DecompressionStream)
6b6c2651245a711c259e712f8ee6653f57a07bdf84050be168d9237bde9fcde5  editor/vendor/occt/occt-import-js.js     (modified, see below)
3fb44ce11d00611f9b3f3c5775d520ebab48930c1f08279b7b1316f05f0d3379  licenses/original/occt-import-js-0.0.23.js   (original glue of occt-import-js@0.0.23)
```

## Modification of the JavaScript glue (LGPL-2.1 notice)

`editor/vendor/occt/occt-import-js.js` is the original Emscripten/embind glue with **two small changes**; the
WebAssembly file (`occt-import-js.wasm`, which holds all of OpenCascade) is **unmodified**.

Why: Orca's plugin frames forbid dynamic code evaluation (`unsafe-eval`; only `wasm-unsafe-eval` is allowed), and the
original glue builds some wrapper functions with `new Function(...)` (in `craftInvokerFunction` and in
`__emval_get_method_caller`). Both calls are replaced by equivalent closures that do exactly what the generated functions
did; no string is evaluated. A banner comment at the top of the file says so. The result of the converter was checked to be
identical (SHA-256 over all meshes) to the original's on three STEP files, including a 34 MB assembly.

The change is reproducible and reviewable: `node dev/patch-occt.mjs` rebuilds the shipped file from
`licenses/original/occt-import-js-0.0.23.js` (the original, kept for this purpose), and `orca plugin test` fails if the shipped
file differs from that output. The modified file remains licensed under the LGPL-2.1, as the original.

## LGPL-2.1 compliance for the converter

The converter is used as a separate library: the viewer's own code (MIT) only calls it through its public JavaScript API
(`ReadStepFile`) in a background worker (`editor/step-worker.js`).

- **Licenses**: the full license texts are in [licenses/LICENSE-LGPL-2.1.txt](licenses/LICENSE-LGPL-2.1.txt) and
  [licenses/OCCT-LGPL-EXCEPTION-1.0.txt](licenses/OCCT-LGPL-EXCEPTION-1.0.txt) (copied from the OCCT repository at the commit above).
- **Notice** (the OCCT exception asks for it): this software makes use of or is based on facilities provided by the
  Open CASCADE Technology software.
- **Corresponding source**: occt-import-js 0.0.23 (https://github.com/kovacsv/occt-import-js/tree/0.0.23, LGPL-2.1) and
  OCCT 7.6.1 at the commit above (https://github.com/Open-Cascade-SAS/OCCT). The build recipe is in the occt-import-js
  repository (`tools/build_wasm_*`, Emscripten). The glue change is `dev/patch-occt.mjs` in this repository.
- **Replacing the converter** (the LGPL right to use a modified version): the two files are plain files in the plugin
  folder, and the plugin source is a plain folder as well. To use your own build, build occt-import-js from source (with dynamic
  execution disabled, or apply `dev/patch-occt.mjs`'s changes), copy the plugin folder, compress your `.wasm` with `gzip -9n`, overwrite
  `editor/vendor/occt/occt-import-js.js` and `editor/vendor/occt/occt-import-js.wasm.gz` in the copy with your build, and load the copy
  with `orca plugin dev load <folder>`. (An installed plugin refuses files that no longer match the installed hash, so the change goes
  through a folder copy, not through the installed files.) The viewer loads the converter by those names. The test that pins the
  checksums and `dev/vendor.json` will then report the change; update the checksums in `test/`, in `dev/vendor.json` and in this file.

## Check of the LGPL duties before publication (2026-11-21)

Verified against the upstream repositories: occt-import-js 0.0.23 pins the OCCT submodule at commit `d2abb6d844231cb8f29be6894440874a4700e4a5` (`.gitmodules`, GitHub API), the same commit as named above; its `dist/` folder ships the
LGPL-2.1 text as `license.occt.txt` and the occt-import-js license as `license.occt-import-js.txt` (LGPL-2.1, `LICENSE.md`); the build recipe is the batch files `tools/setup_emscripten_win.bat` (Emscripten 3.1.69 and MinGW 7.1 through `emsdk`)
and `tools/build_wasm_win*.bat`, run on Windows. The shipped `occt-import-js.wasm` (7.6 MB unpacked) was searched for other libraries (FreeType, rapidjson, zlib/libpng markers, a compiler banner) and showed none by name; OCCT's own modules are listed in
the occt-import-js `CMakeLists.txt` (`AddOcctModule`), which compiles only OCCT sources and the occt-import-js sources.

| Duty (LGPL-2.1) | Status |
| --- | --- |
| License text and notice of the library (§1, §2) | done: texts in `licenses/`, notice in this file |
| Modified glue file stays LGPL and is marked as modified (§2a, §2b) | done: banner in the file, this section, reproducible by `dev/patch-occt.mjs` |
| Library used as a separate work, replaceable by the user (§6) | done: separate files loaded by name; the steps are above |
| Corresponding source offered (§6a-§6d) | done as a written offer plus references and a release asset: (1) the exact upstream versions and commits are pinned in this file and in `dev/fetch-lgpl-source.sh`; (2) that script builds the archive `occt-import-js-0.0.23-corresponding-source.tar.gz` (occt-import-js tag 0.0.23 and the OCCT commit, as upstream has them); it is attached to every GitHub release of this plugin as a release asset (not stored in the repository, which stays free of archives); (3) **written offer**: for at least three years from each release, anyone who received the plugin can ask for that source through [GitHub issues](https://github.com/LifeGood-acc/step-viewer-3d/issues) of this repository, and it will be supplied at no more than the cost of the medium (no e-mail address is needed). The release asset is attached when the release is published. SHA-256 of the archive as built for release 0.25.1: `ea1d1620984ec60bf36f9e38aaaf7f57713eca7628f2e7aaafeb75331e99d18b` (a rebuild with the script gives a different gzip checksum, because git and tar embed times; its contents come from the same pinned commits and are listed in `SOURCES.txt` inside the archive). |
| Build recipe usable for the replacement | **open** (weak): the recipe exists only as Windows batch files and pins Emscripten 3.1.69; whether the published binary was built with exactly that version cannot be told from the binary (no compiler banner). The replacement instruction above says "build from source" without a tested macOS recipe. A tested macOS/Linux build script would make the instruction concrete. Not done; the converter file can be replaced by any compatible occt-import-js build. |
| Notices of what Emscripten links into the wasm (runtime, libc, libc++) | done as a labelled statement: an Emscripten build **usually contains** parts of the Emscripten runtime (MIT/NCSA), the musl libc (MIT) and libc++ / libc++abi (Apache-2.0 with LLVM exception); **not verified in the binary** (it shows no names). Their license texts are not copied here; they are permissive and ask for the notice to accompany the binary, which this paragraph is. |

Verdict: the LGPL structure (separate library, replaceable, modified glue published) is sound. Left open: the source archive as a release asset (created at the release), and a tested build recipe for the replacement.

## three.js (MIT)

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## meshoptimizer encoder and simplifier (MIT)


MIT License

Copyright (c) 2016-2026 Arseny Kapoulkine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
