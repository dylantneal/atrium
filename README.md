# Atrium

A walkable 3D spatial file manager prototype. Folders become rooms; light, dust and place carry meaning;
every file opens in a crisp flat view. Runs in the browser and keeps all data local.

Design doc: https://claude.ai/artifact/Q315NQtphU6jyP1q89EYw9

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

Useful URL flags: `?perf` (performance overlay, `` ` `` toggles it), `?tier=low|medium|high|auto`, `?tour=off`, `?db=name` (separate local database).

The app starts on generated demo data (six projects, about 200 files). It has no server and sends nothing anywhere.

## What is built (P0 slice, milestones M0 to M4)

| Area | What you get |
| --- | --- |
| Rooms | Each folder is a seeded room that looks the same every visit. Four wall types (gallery, shelf, screen, corkboard) chosen by what is in the folder. Doors are portals; the building is a graph, not a tree. |
| Light as attention | Active rooms are bright and warm; neglected ones are dim, dusty, cobwebbed. Doors show the activity behind them and a "neglected" badge after 60 idle days. Items changed in the last day glow. |
| Flat focus mode | Click or Enter on any item for a full-screen HTML viewer: CodeMirror editor with autosave and versions, markdown split preview, image pan/zoom, audio/video. Esc returns to the exact spot you stood. |
| Hands | Pick up (E, right-click, long-press), carry up to eight items, place on any glowing spot, drop through a door, copy with Shift. Everything is undoable. Trash is recoverable until emptied. |
| Search as a room | Ctrl+K or `/`. Fuzzy, ranked search; Ctrl+Enter builds the results into a temporary room with result lamps; Keep turns it into a saved room with its own door. |
| Docent | Rule-based, on-device. Sorts a wall by colour/name/date/size/kind, summarizes a room, suggests threads, tags items, gives a tour. Changes are previewed and applied only on confirmation. |
| Also | Welcome tour, quality tiers with auto step-down, accessible list view (`L`), settings (control room). |

### Controls

| Action | Touch | Keyboard and mouse |
| --- | --- | --- |
| Move / look | Left stick / drag right | WASD / drag |
| Go through a door | Walk into it or tap | Walk into it or `F` |
| Open flat | Tap an item | Click, `Enter` or `F` |
| Pick up, place, drop | Long-press | `E` or right-click |
| Put back / trash | Hotbar buttons | `Q` / `Delete` |
| Hotbar slots | Tap | `1` to `8` |
| Search / commands | Search button | `Ctrl+K` or `/` (type `>` for commands) |
| Up one level / list | Crumb arrow / list button | `B` / `L` |

## Test

```bash
npm run typecheck
npm test           # 74 unit, property and contract tests (Vitest)
npm run e2e        # 20 browser tests (Playwright). Set PW_CHROMIUM=/path/to/chromium to reuse an installed browser.
npm run perf       # scripted flythrough with 4x CPU throttle (software GL: relative numbers only)
```

The tests that matter most: room generation is byte-identical across reloads and fresh databases; adding files never moves an
existing item; every random sequence of place/copy/drop/trash is exactly undone; the activity, dust, glow and light rules
are pinned to the design doc's numbers.

## Layout

`src/core` actions, undo, inventory, placement, rules, search · `src/vfs` file backends (`DemoVFS` now, `FsaVFS` next) ·
`src/data` IndexedDB schema and migrations · `src/world` three.js scene, generators, input · `src/ui` DOM overlay ·
`src/workers` thumbnails and search · `src/docent` rule-based assistant · `src/demo` generated sample data.

## Deploy

`.github/workflows/ci.yml` runs the checks and publishes `dist/` to GitHub Pages (`ATRIUM_BASE=/atrium/`). Open the Pages URL
in Chromium on the tablet.

## Where this differs from the design doc

- World labels are canvas textures, not SDF text (the SDF library fetches its font from a CDN at runtime).
- Textures use one 256 px atlas tier with an instant colour placeholder; focus mode loads the full image. No 1024 px tier.
- Rooms with more than about 120 items grow their slot grids instead of becoming a "wing" of sub-rooms. Anything that does not fit stays reachable through list view and search.
- Trash is a panel and a recoverable `.atrium-trash` folder, not a 3D basement incinerator.
- Threads are suggested and stored; the strings between items are not drawn yet (M5).
- Player collision radius is 0.5 m, not 1.0 m.
- Not built yet: real-folder mode in the UI (the `VFS` seam and contract tests are in place), PDF viewer, spatial audio, floor and building maps, depth-as-time stack, swipe-down to close focus mode, rubber-band multi-select.
