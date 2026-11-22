# Changelog

## 0.25.1

- Release preparation (no change to the viewer): `package.json` with `package-lock.json` and `npm ci && npm run build` rebuild `editor/vendor` byte for byte from the locked npm packages (`npm run verify-build` compares); `dev/privacy-check.sh` checks every file and the whole Git history for private data; `LICENSE` names "LifeGood-acc and contributors"; README has install, support and build notes. The LGPL source offer and the corresponding-source script (`dev/fetch-lgpl-source.sh`) are in THIRD_PARTY_NOTICES.md.
- Review of the fixes: the opacity floor of the mesh lines matches the slider (0.1); a ghosted part (greyed out by a selection) keeps full-strength lines (known, not changed). Test only: the crowded-labels test now uses 600 labels, where the old scan took about ten times as long.

## 0.25.0

- Review of the second stage: switching *Mesh over the surface* off lets go of the meshes (a new file is not kept alive), its lines follow the opacity slider, and a file's own polygon offset on a material is kept (only raised while the lines are on); the hook it puts into the scene is given back when it is disposed.
- Crowded views: the search for a free label place uses a grid of the places taken, looks at the nearest first, and does not scan again for a size that already found nothing. The "No room for …" note is not painted into saved pictures.
- *Set again* during a chain keeps the changed measurement selected; the way back of *Rotate 90°* (Shift + click) is also named for screen readers.

## 0.24.0

- **Appearance > Advanced > Mesh over the surface**: the closed surface and its mesh lines at the same time (the lines are a second object that shares the part's geometry, kept in the helpers: exports, part numbers and the model itself are untouched). Hidden parts have no lines, the section cuts them too, the *Mesh* view needs no extra lines, *Default* turns it off, the choice is remembered with the view.
- **Rotate 90°** in the Edit tab is three buttons (X, Y, Z) instead of six; **Shift + click** turns the other way.
- The Parts tab has **one** hint sentence (select, Ctrl/⌘, Shift, Esc, tick, double-click) instead of two lines.
- Review of the first stage: the "no room" label goes away with the last measurement, is measured only when its text changes, straight edges continue along the best aligned segment, edge picking compares squared distances.

## 0.23.0

- **Measure tab keeps the keyboard focus**: after hiding, colouring, selecting, deleting or setting a point again, the focus stays on the same control (after a delete it moves to the neighbouring row). Tab names read steadily (the eye keeps its name, only its state changes), colours are named, the chosen row is marked as current.
- **Crowded views**: a measurement label never covers another one. It looks for the nearest free place anywhere in the view; what finds none is named in one small label ("No room for: 4, 7, 9 …").
- Review fixes: CSV keeps negative coordinates as numbers (only names and details are guarded against formulas), the area of a small polygon far from the origin is exact, moving a point of an *Edge* measurement makes it a plain distance, deleting the measurement that waits for *Set again* disarms it, *Set again* finishes a chain that is under way, straight edges are found across the borders of the end-point grid, edge picking allocates nothing per segment, dead code removed.

## 0.22.0

- **Measure+** (a wish after seeing the first Measure): every measurement now stays. The result stands **on the line** in a slightly transparent coloured label (number and value; the name below it), upright, readable on light and dark backgrounds, and labels that would cover each other move apart. The summary stays in the chip as before.
- New tab **Measure** (between Section and Info): the list of all measurements (number, kind, value, name), rename, colour, hide, delete, delete all (asks first). One place for this: nothing of it is in Info. Opening a row shows its points; **change a point** by dragging its marker in the view or with *Set again* and a click.
- New way **Chain** (several points in a row): every piece, the sum, and, closed (*Close, with area*), the area of the polygon (a note says when the points are not in one plane). Enter finishes a chain.
- **Compare**: tick two measurements and the tab shows both values, the difference and the ratio (a length and an angle are not compared).
- **Take them along**: *Copy as text* and *Copy as CSV* (German files use `;` and a decimal comma), the labels are drawn into saved pictures (not into a transparent PNG), the measurements stay through a change of look, mesh, Up is and the turntable (their points live in the file's own axes), and *Close file* names them. They are dropped when a tool changes the geometry (Edit tab) and hidden while the parts are pulled apart.
- Review fixes: labels of deleted measurements are not drawn into pictures, measurements stay visible after a new file while *Explode* was on, no markers can be grabbed while parts are pulled apart, the bar's *Delete* only drops the unfinished measurement, darker label colours (contrast), names starting with `=`/`+`/`-`/`@` are made safe in CSV, a note when a tool drops the measurements.
- Five tabs: the tab row is a little tighter so that all five fit.
- Hardening (found by a security review of a sibling tool that shares the code): the GLB accessor reader refuses negative or fractional offsets, counts and strides, and strides under one element or over 252, before it works out sizes or allocates anything; with test.
- Review of the fixes: the face ranges come back after Decimate and "Back to the file"; the Tools check panel writes volumes like the details.


## 0.21.3

- The tabs are in the mockup's order: **Parts, Section, Info, Edit**. New store pictures.

## 0.21.2

- The empty panel (no file yet) shows only its sentence: no tab row and no heading "Whole model" (seen in the real Orca panel). The tab row keeps its close button and no longer wraps in a narrow panel. The text about G-code in the start page names the *Layers* tab.

## 0.21.1

**Review fixes and pictures.**
- Export: "Save as…" no longer saves on its own after a copy that was cancelled or changed; it shows "Working…" for every format; *Make smaller* is kept when you switch from Image back to 3D file; the dialog's button is called *Close* when nothing is running.
- **Close file…** is not offered in the editor tab of a project file (the tab is the file); it stays in the panel and in the start file.
- Tooltips: the *Surface ⇄* button says what a click does; the menu rows carry their key. *Section* and *Info* start with a sentence.
- New store pictures from the new interface (`dev/make-shots.mjs`).

## 0.21.0

**The export dialog as in the mockup.**
- **One button, "Save as…"**: it makes the copy and saves it; if the click is still fresh (up to four seconds) the save follows on its own, otherwise the button stays and the next click saves. *Cancel* stops a copy that is being made, or closes the dialog. (Whether Orca takes the save after the copy is made is only known from a try in the real Orca; the two-step way is the fallback and stays in the code.)
- **Image | Film | 3D file**, the sentence "The original file stays unchanged.", **Make smaller** as a check box (it is the compressed GLB; its size and precision appear when it is on), *Only visible parts*, *Advanced* ("Up in the copy"), the size ("About 63 KiB"), and the hint to the Edit tab.
- **Only the formats that fit the file**: a point cloud or splat offers GLB and PLY, G-code offers GLB; a mesh offers all five.

## 0.20.0

**The panel's tabs as in the mockup.**
- **Parts**: a sentence on how to choose, the buttons *All*, *None*, *Invert* and **Only selected**, then a visible line, **"Ctrl/⌘ + click: choose several. Shift + click in the list: a range. Esc: clear."**, and a **Select several** button (while it is on, every click adds a part: for a trackpad or touch without a key; a click on nothing does not clear then). Then the filter, the list, the part card, *Explode* and *Selected part*. *Color per part* moved to *Appearance*.
- **Info** (*Whole model*): the numbers, **the unit with *Set as***, *Check mesh* and *Copy numbers* (the mesh quality in STEP). *More numbers* one level down.
- **Edit**: the sentence, **"No changes."**, then *Position and size* (*Convert to* has its own row), *Parts* and *Simplify mesh* (*Accuracy* instead of "Detail"). *Make "Up is" part of the model* is gone (View > Up is works in the view and the export).
- A radio card no longer swallows the shortcut keys. "Default" in Appearance also sets point size and texture size back.

## 0.19.0

**The toolbar and its menus as in the mockup** (UX concept, second pass after the first look in Orca).
- **The bar has the six elements, then More and the panel button.** *Open file* and *Close file…* are not on the bar any more: they are in **More** (with *Open folder…*, *Keyboard shortcuts* and *Reset all*). The panel button moves into More when the bar is narrow. *Surface ⇄* shows that a click switches.
- **View** is a list with the shortcut of each row: *Show all* (R), *Show the selected part* (F), the eight views (1 to 8), *Up is* and the sentence that every view shows the whole model. "Fit" is gone from the words: *Show*.
- **Appearance** is a menu with a sentence: the colors as four cards with a line each (*Original*, *Gray*, *Color per part*, *X-ray*), *Show texture*, *Helpers* (floor grid, axes), and *Advanced* one level down (the other looks, opacity, bounding box, back faces, texture size, points). *Default* sets the looks back, *Done* closes.
- **Studio** has a header with the key, look tiles with a color swatch, the background, floor, **Turntable** (Turn + Speed in one row), *Advanced* (lights, exposure), and at the foot *Save image…*, *Film…* and *Reset*.
- **A list of keyboard shortcuts** (More > Keyboard shortcuts): every key, one line each (a test checks that every key of the table is in it).
- **The panel's tab row** has the close button at its end; the heading "Panel" is gone while there are tabs. The result of a measurement sits in the measuring bar.

## 0.18.0

**Words, tests and pictures** (UX concept E7).
- Texts follow the new screens: *Panel* (not "side panel"), *Edit* instead of "Tools", *Export* instead of "Export a copy", *Show as* for splats | points, *Reset all*; the sentences that pointed to old sections ("Tools section", "Points section", "Export a copy") now name the tab or menu. German: *Leiste*, *Bearbeiten*, *Exportieren*, *Zeigen als*, *Alles zurücksetzen*.
- New store screenshots, made by `dev/make-shots.mjs` from the plugin's own sample files (start page, parts with the part card, Edit tab, export dialog, Studio menu, narrow view, German, dark Info and mesh view); the cover shows the new interface.
- Tests: every `ch_*` text exists in both languages, no text key shows anywhere in the page, and the manifest version is the newest CHANGELOG entry.

## 0.17.0

**Export as a dialog** (UX concept E6).
- **Export…** opens a dialog over the view with three kinds: **Image**, **Film**, **3D file**. The format list shows 3D formats only; the options of the chosen format follow. *Up in the copy* sits under *Advanced*. A sentence points to the Edit tab for changes to the model itself.
- The Export tab and the quick *Save image* button are gone: *Save image…* and *Film…* in the Studio menu open the same dialog on Image or Film. Esc closes the dialog and the focus goes back to *Export…*.
- Still two steps (*Create copy*, then *Save as …*) as before; a one-click save for fast formats waits for a test in the real Orca (the save needs a click there).

## 0.16.0

**Studio as a menu** (UX concept E5).
- **Studio ▾** opens a menu instead of a side tab: look tiles (Original, Product on white, Dark studio, Grey gradient, Soft daylight), the background, floor with shadow, turntable with speed, and at the foot *Save image* and *Film…* (opens the Export tab with the video format). Lights, reflections, exposure, tone and quality are one level down under *Advanced*. The button says **Studio on** (and is blue) while a look is on.
- **Background that always works**: one list of seven, *Like the look*, *Like Orca*, *Light*, *Dark*, *White*, *Gradient*, *Transparent*, independent of the look and of the shading (it used to be greyed out with the look off). Choosing another look shows that look's own background again; editing a light or the floor leaves a chosen background alone. The key **B** steps through the list and names the new background. An older saved "light" or "dark" is read as before.
- A look with a shading that is not lit (Normals, X-ray, Matcap, Vertex colors) shows a hint with a button, *Set appearance to Original*.
- Behind it, one shared background module (`background-three.js`) replaces the two copies of the background code.

## 0.15.0

**Toolbar and side panel rebuilt** (UX concept E4).
- **Six elements on the bar**: *View* (show all, fit the selected part, look from, up is), *Surface | Mesh* with *Appearance* (shading, texture, edges in STEP, grid, axes, box, back faces, opacity, texture size, points), *Measure*, *Studio*, *Export…*, and *More* (⋯: open folder, reset all; the file buttons and the panel button move in when the bar is too narrow). The background and image buttons are gone from the bar (background and *Save image* sit in the Studio and Export tabs until E5/E6 replace them).
- **Side panel in tabs**: Parts (when there are two or more parts; always in STEP), Section (*Layers* for G-code), Edit (the tools, with the sentence that they change the working copy, never the file), Info (*Whole model*, a line naming the selected part, the numbers you need; load time, texture memory, converter memory and the like under *More numbers*; in STEP the mesh quality), Studio, Export. The tab you used last is remembered. The part card sticks to the bottom of the Parts tab.
- **Measuring bar** in the view: Distance, Angle, Circle, Edge (and Parts from two parts), Clear, Done (Esc). It replaces the Measure section of the panel.
- **Playback bar** for files with animation sits in the view.
- "Reset settings" is now **Reset all**.

## 0.14.0

**Popovers and tabs as factories** (UX concept E3, pilot).
- `popover.js`: the rules as pure functions (one popover open at most; Esc and a click outside close it and the focus goes back to the button; a click on a button inside closes it, a select or slider keeps it open) and `createPopoverGroup`, `makePopover`, `createTabs` (roles, arrow keys, Home/End, remembered and preferred tab) without fixed element ids.
- The **More menu** now runs on these rules. Esc closes an open menu first and only the next Esc reaches the view (measuring, selection).
- Tabs are built and tested (`dev/e2e-popover.mjs`) but not used by a screen yet: they come with the new side panel (E4).

## 0.13.0

**State instead of scattered flags** (UX concept E2).
- One table (`controls-core.js`, tested for the 28 cells of the effect matrix) says which control is shown, which works and why one does not: *Colour per part* is off with a tooltip outside the Original look, *Texture* outside Original and Flat. **Visible change: the CAD edges are on from the start** (they were off); a file's remembered view keeps its own choice.
- Remembered settings carry a version (`prefs-core.js`): one background model (look, Orca, light, dark, white, gradient, transparent; the button still offers like-Orca, light, dark until the Studio popover). An older record is migrated and keeps its keys, so an older version still reads it.
- **Reset all** now resets everything: the switches (mesh, grid, axes, box, back faces, colour per part, shading, opacity, point size, edges) go back to the standard values, the view of the file is made again and the remembered view is overwritten.

## 0.12.0

**Part info** (UX concept E8): numbers for single parts.
- **Select several parts**: a click selects a part (the same part again clears it), Ctrl or Cmd click adds or removes one, Shift click in the list selects a range, a click on nothing and Esc clear. In the STEP Viewer a node of the tree selects every part below it. A dashed blue box (not the red one) frames the whole selection and shows which way X, Y and Z run. Keys F (fit to the selection) and I (only the selected; Shift+I all) work in both viewers.
- **Part card** below the parts list: name, type, **size X × Y × Z**, triangles, share of the model; folded away under *More about the part*: centre, corner points (welded), surface, volume (only for closed parts), watertight (with the counts of open edges), material, colour, texture, position, rotation and scale (not for a part without a transform of its own), instance, visibility (also "partly cut away by the section"). The surface, volume and check are worked out when *More* is opened (in a worker, kept for each part until the working copy changes); above 50 parts or for a part with more than 500 000 triangles they wait for *Calculate*. *Copy the numbers* puts the card on the clipboard. The sizes are those of the working copy you see, in the file's axes; for a turned part the box of its vertices is used. The STEP sizes come from the CAD kernel's triangle mesh (a round part measures a little less than the exact one).
- **Two parts selected**: distance centre to centre, and the **smallest distance** between their surfaces on a button (from the points of each part to the surface of the other: an upper bound; "about" when a sample was used above 40 million point-triangle pairs; 0 means they touch or cross). From three parts on the card points to *Measure > Parts*.
- **Chip in the view**: the name and size of the selection, also with the panel closed, with a button to the card.
- **Measure > Parts** (new way to measure, from two parts on): click two different parts; the line goes between the centres of their boxes, the chip names centre to centre and the smallest distance.
- Measured (`dev/measure-parts.mjs`, headless Chrome, 3 000 / 10 000 small parts): load 375 / 521 ms, a click on a part 3 / 5 ms, a range of 1 000 parts 9 ms (it was 800 ms until the world matrices were updated once for all parts instead of once per part), the detailed numbers of 1 000 parts 114 ms in the worker.

## 0.11.1

- **Close**: a *Close* button next to *Open file…* (in the *More* menu when the bar is full) empties the model and goes back to the start page: the scene is emptied, the GPU memory is freed, the section and the tools' working copy are reset and the kept "last file" is forgotten (this replaces the *Forget it* button at the bottom of the panel). It always asks first, with a dialog the page draws itself (no `window.confirm`, which a sandboxed frame may block): "Close the model?", and when something would be lost (tools, section, measurements) it says so. The focus starts on *Cancel*, Escape cancels, Enter never closes by itself, and no shortcut works behind the question. In an editor tab the file of the tab is not touched; the start page then takes another file.

## 0.11.0

First steps of the interface rework (concept `UX-KONZEPT-VIEWER.md`, stages E0 and E1): the toolbar controls say what they do.
- **Surface | Mesh**: the *Wireframe* button is one button whose label is the state (*Surface* or *Mesh*); its tooltip names what a click does; key `W` stays. It is not there for point clouds, splats and G-code (no surface). The mesh shows in every look; the test checks all six (a matcap material only gets the property with three.js r181, so this was broken before 0.12.0).
- **View menu**: the *View* button is gone. The *View* menu holds *Show all* (R) and the eight views (keys 1 to 8, new: *Hero*); **every view fits the whole model** and looks at its middle, from wherever the camera is (before, only *View* did). The camera buttons of the Studio section are gone (they are in this menu).
- **Background** button: always changes what is seen. It flips to the opposite of the background shown now and back (before, the first click in a light Orca theme chose "light", the same colour, and with a studio look it changed only its own label). With a studio look it reads "like the look".
- **Texture** button: only for models with textures, and in the looks that show them (Original, Flat); in the other looks it is off and the tooltip says why.
- Internals: the keys are a table and one pure function (`shared/keymap.js`, `keyAction`), the element ids the tests depend on are listed and checked (`shared/ui-ids.js`); new `dev/e2e-ux.mjs`.

## 0.10.1

Fixes from a first real test of the studio look.
- **Narrow side panel**: the lists of the Studio section (look, background, tone mapping, quality) put their label above the choice, so nothing is cut; the full text is the tooltip.
- **Landscapes and stage sets**: a flat, wide scene (at least three times as wide as high) hides its own floor, so the model now catches the shadows itself; compact objects still show their shadow on the floor.
- **Background button** while the studio look is on: it used to do nothing visible (the look has its own background). It now reads "Background: studio look" and opens the Studio section.
- **PNG with a transparent background**: a note says that many image viewers show it black (the file has an alpha channel and is fine).
- The line "Large file - may take a moment" above the view is Orca's own note for any document over 16 MiB; the plugin cannot hide it.

## 0.10.0

**three.js 0.187.0** (was 0.180.0): the controls and the renderer come from the new release. The pictures of the sample assembly differ by at most 6 of 255 levels in the original look, by at most 50 in the studio look; frame times are the same within the noise. The npm package ships no minified build since r187, so the readable `three.module.js` and `three.core.js` are vendored. Notices updated (`THIRD_PARTY_NOTICES.md`).
- The studio shadow got a larger bias (the new release drew a hatched edge where a model sits on the floor).

## 0.9.0

**Studio look**, shared with the 3D Model Viewer. Background (colour, gradient, transparent), a floor that catches a soft shadow, key/fill/rim lights, reflections from a procedural studio room (no picture, no network), exposure and tone mapping, camera presets for product shots, a turntable, quality low/high, and the look in PNG (as shown, 2×, 4×) and in the WebM film (length, size). Original stays the default and the picture is pixel-identical to before. No new rights, no network.

## 0.8.3

- Shared-code update: faster inside-out test in the mesh check, tsc-clean shared code.

## 0.8.2

Shared-code follow-ups (same as the 3D Model Viewer 0.10.2).

- Mesh check: area and volume right for stretched or mirrored parts; "inside out" is decided per shell (a cavity is fine); edge measuring uses the real object transform.
- X-ray keeps its back faces whatever the "Back faces" switch says; removed parts free their materials and textures.
- Internals: drag-and-drop and file choice decisions (`dragReducer`, `planOpen`) are tested pure functions.

## 0.8.1

Fixes from the independent review (report 2); most of them are in the shared code that both plugins use.

- **Numbers**: three significant digits (0.045 m stays 0.045), small volumes in the smaller unit, the angle with the language's decimal separator.
- **Start view** fits narrow, tall panels.
- **Compress**: the smallest try is kept; a small target is honored; KiB/MiB throughout.
- **Mesh check**: a closed mesh turned inside out is reported.
- **Edge length** uses the CAD edges (where two B-rep faces meet) and measures a straight edge end to end; a curved edge gives a chord.
- **Decimate** reports "nothing reduced" when nothing was, and works on triangle soups.
- The converter's error message is translated; the parts list has no empty buttons in leaf rows (a blank, not a button); the shortcuts keep working after `E`; an uncaught error writes a `state:"error"` line to the log.
- README: the measurement and texture statements that belonged to the other plugin are corrected. e2e: a narrow view and a CAD-edge measurement.

## 0.8.0

- **Edges**: a toolbar button draws the CAD edges of each part, the lines where two B-rep faces meet (`editor/edges.js`, from the converter's face ranges, with a hash of welded vertices; about 0.2 s for a million triangles). They follow the section plane; a unit change, move or scale keeps them, Decimate makes them again as sharp edges (30 degrees) with a note.
- **Assembly tree**: group rows fold and unfold (by mouse or keyboard; selecting a part in the view unfolds its groups; double-click on the fold button no longer isolates the group).
- **Smaller plugin**: the converter's WebAssembly is shipped gzip-compressed (7.6 MB to 3.1 MB) and unpacked in the worker (and in the page fallback) with `DecompressionStream`; the recorded checksum is that of the content, `dev/vendor.mjs` checks it after unpacking; replacing the converter means compressing your build with `gzip -9n`.
- Tests: `test/edges.test.mjs`; e2e checks for edges (count, off, section, tool) and the folding tree; the network lint allows only the one fixed fetch of the converter file. No new permissions (capabilities stay empty).

## 0.7.0

- **Shading**: X-ray, matcap, flat and vertex colors next to original, solid and normals.
- **Measure**: angle (3 points), circle diameter (3 points on the rim) and edge length next to distance; a *Measure* section in the side panel.
- **Details**: *Watertight*, *Volume* and *Surface area* in the background after the model is up; **Copy details** as text.
- Shared code with the 3D Model Viewer (`shading.js`, `measure.js`, `measure-three.js`, `details.js`). No new permissions (capabilities stay empty).

## 0.6.0

- **Fix: the model is no longer lost when the panel is shown again.** Orca builds a panel frame anew when the right sidebar is closed and opened (or another panel was in front); the page used to start empty. The last file you dropped, chose or pasted is now kept in the plugin's own IndexedDB (this computer only, up to 200 MiB) and comes back with the camera and the display switches; the next file replaces it, **Forget it** deletes it. Frame starts show as `step-viewer-3d-boot` lines in `orca plugin logs`.
- **New: Tools** (side panel) change a working copy of the converted model, never the STEP file; Export writes the copy; "Back to the file" undoes it. Before/after numbers and small pictures. **GLB, compressed (under a size)** in the export section (meshopt, quantization, in a worker with progress and Cancel, with a reached/not-reachable report); **transform** (unit, origin, floor, scale, rotate 90°, mirror, make "Up is" permanent), **decimate** and a **mesh check**. Removing or merging parts is not offered: the parts are the leaves of the assembly tree (hide them and export only the visible ones).
- Libraries (loaded only when a tool runs): meshoptimizer 1.3.0 encoder and simplifier (MIT), recorded in `dev/vendor.json` and `THIRD_PARTY_NOTICES.md`. No new permissions (capabilities stay empty).
- Tests: the shared tests for the compressor, mesh tools and scene operations; `dev/e2e-export.mjs` covers the tools and the compressed copy.

## 0.5.0

- **New: export a copy.** **Export…** (or `E`) opens a section of the side panel: choose a format, **Create copy**, **Save as …** (Orca's Save dialog, after a click; no permission). A copy of the converted model as **GLB**, **STL**, **OBJ**, **PLY** or **3MF**, in the unit and at the quality shown; a **PNG** of the view with an optional transparent background; a **turntable video** (WebM). The STEP file is never changed, and there is no export back to STEP.
- The panel names what each format loses and shows the size of the copy against Orca's limits (50 MiB to open in a tab, 64 MiB for the Save dialog).
- Release hygiene: every vendored file is traced to its npm package (`dev/vendor.json`, `node dev/vendor.mjs --check` or `--update`); `THIRD_PARTY_NOTICES.md` lists package versions and integrity values and now says how to replace the converter in an installed plugin (a folder copy loaded with `orca plugin dev load`); `docs/REPOSITORY.md` fixes the repository layout. `dev/e2e-export.mjs` exports every format and opens the copies in the 3D Model Viewer.
- Manifest: no new permissions (capabilities stay empty).

## 0.4.0

- **New layout, nothing overlaps.** Toolbar on top in groups, with a **More** menu for what does not fit; the view and the side panel side by side (the panel takes space instead of covering the view); one column with a bottom sheet under 520 px.
- **Side panel**: drag to resize (arrow keys, double-click resets), open and close with the button or `P`, each section folds on its own, all remembered; vertical scrolling only, long values with ellipsis and a tooltip.
- Controls that need a model are disabled instead of hidden until a file is shown.
- The shared layout code lives in `editor/shared/` (the same files in 3D Model Viewer and STEP Viewer 3D).

## 0.3.0

- New: **start page without a file.** A sidebar panel, a "New file → STEP Viewer (drop a model)" entry and an "Open file…" button; drag a STEP file in from anywhere or choose one; files one after another replace the view. Dropped files bypass Orca's 50 MB limit; files above about 90 MB are refused with a message (the converter needs about 43 times the file size, WebAssembly stops at 4 GB); the memory gate still asks above 15 MB.
- New: an agent-readable state line (`step-viewer-3d-state {...}`) in `orca plugin logs` for every model shown.
- Fix: a panel needs its own entry page (`editor/panel.html`).
- Manifest: adds a panel and a new-file entry (no new permissions; Orca reported "already-approved").

## 0.2.0

- **Fix: the editor did not open.** Orca mounts a text editor only for text files, so the editor now declares `contentKind: text`.
- **Fix: the converter failed in Orca's frame** because its Emscripten glue called the `Function` constructor, which Orca's
  content security policy forbids. The glue is patched at the two places (`dev/patch-occt.mjs`, original kept in
  `licenses/original/`); the WebAssembly file is unmodified and the converter's output is identical on the files tested.
- The converter worker is warmed up while the file arrives.
- New: preset views, section plane, measuring, PNG export, shading modes, opacity, part filter, keyboard access; a lost WebGL
  context shows a message instead of a dead view; GPU memory is freed when the tab closes.

## 0.1.0

First version: STEP (`.step`, `.stp`) in a custom editor; OpenCascade converter in a background worker with elapsed time,
cancel and a memory warning for big files; assemblies and parts list with color and visibility; mesh quality (coarse,
normal, fine); unit from the file; wireframe, grid, axes, bounding box; English and German.
