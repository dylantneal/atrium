# Atrium

A walkable 3D spatial file manager prototype. Folders become rooms; light, dust and place carry meaning;
every file opens in a crisp flat view. Runs in the browser, all data stays local.

Design doc: https://claude.ai/artifact/Q315NQtphU6jyP1q89EYw9

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (add ?perf for the performance overlay, ` toggles it)
```

## Test

```bash
npm run typecheck
npm test           # unit, property and VFS contract tests (Vitest)
npm run e2e        # Playwright; set PW_CHROMIUM=/path/to/chromium to use an existing browser
```

## Layout

`src/core` actions, store, undo, rules · `src/vfs` file backends · `src/data` IndexedDB schema ·
`src/world` three.js scene and generators · `src/ui` DOM overlay · `src/workers` heavy jobs ·
`src/docent` rule-based assistant · `src/demo` generated sample data.

## Status

P0 slice in progress (M0 to M4). See the plan milestones in the design doc, section 12.
