# ClickGuide

A lightweight, ClickLearn-style web app for **walkthroughs** _and_ **structured test runs**. Capture screenshots, drop hotspots, annotate, and export evidence as PDF, Word, or JSON.

Two modes:

- **Guides** — author click-by-click tutorials and play them back interactively.
- **Test plans** — import a CSV of tests, switch between environments, capture evidence per run, mark Pass / Fail / Blocked, and export a per-test evidence pack.

No build step, no backend. It's three static files (`index.html`, `styles.css`, `app.js`) that store everything in your browser's `localStorage`.

## Run it

Open `index.html` directly in a browser, or serve the folder with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Features

- **Guide library** — list, open, and delete saved guides; sorted by most recently edited
- **Step editor** — title, instruction, screenshot, and a single click hotspot per step
- **Hotspot placement** — click anywhere on the screenshot to drop or move the hotspot; coordinates are stored relative to the image so the marker scales correctly at any size
- **Drag-to-upload** — drop an image onto an empty step to attach a screenshot
- **Reorder & delete** — move steps up/down or remove them from the sidebar
- **Capture mode** — share a window/tab/screen and grab frames as steps with one click or a hotkey (see below)
- **Interactive player** — preview a guide step-by-step with a pulsing hotspot, instruction card, progress dots, and keyboard navigation (← / → / Space / Esc)
- **Multiple export formats** — PDF (via the browser's print dialog), Word (`.doc`), and JSON for round-tripping
- **Local persistence** — guides are saved in `localStorage` automatically

## Capture mode

Click **Capture** in the editor sidebar. The browser asks which window, tab, or screen you want to share — pick the application you're documenting. A small floating panel appears with a red recording dot and a step counter.

- Click **Capture (F9)** or press **F9** to grab the current frame as a new step
- Drag the panel out of the way if it overlaps your target app
- Click **Stop** (or **Shift+Esc**) to end the session and return to the editor, where you can drop hotspots and write instructions

Capture mode uses the browser's [Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API) — no extension or backend required. It works in current Chrome, Edge, Firefox, and Safari (macOS 13+).

## Export formats

- **PDF** — opens a hidden iframe with a print-styled version of the guide and triggers the print dialog. Choose "Save as PDF" as the destination. Each step is on its own page.
- **Word** — downloads a `.doc` file (HTML-based Word document) with embedded images. Hotspots are burned into each screenshot via canvas so they show up correctly when the file is opened in Word, LibreOffice, or Google Docs.
- **JSON** — downloads a `.clickguide.json` file containing the full guide for backup or sharing with another ClickGuide install.

## Test mode

Pick **New test plan** from the home menu, then:

1. **Set up** the plan — title, description, your tester name. Click **Environments** to edit the per-plan environment list (defaults to DEV / SIT / UAT / PROD; the global default is in **Settings** in the top bar).
2. **Import CSV** — bring in your test inventory.
   - The first row is the header. Columns are matched case-insensitively.
   - Required: a column named `number` / `test number` / `id` and a column named `name` / `title` / `description`. If neither header is recognised, the first two columns are used.
   - Optional columns picked up automatically: `precondition`, `expected` (or `expected result`), `priority` (or `severity`).
3. **Pick a test** from the list. Search by number or name; filter by status (Not Run / Pass / Fail / Blocked).
4. **Toggle environment** with the dropdown in the sidebar — the test list re-colors to show that env's status, and the active run switches to the latest run for the selected env.
5. **Start a run** — captures evidence for the current `(test, environment)` pair. Each run records its tester, start time, and status.
6. **Capture evidence** — use **Capture** to grab screen frames (F9 hotkey) or **+ Add step** to upload a screenshot. Then drop annotations:
   - **Hotspot** — click marker (one per step)
   - **Box** — drag to draw a red rectangle around the area of interest
   - **Label** — click and type to drop a red text caption
7. **Set status** — Pass / Fail / Blocked, with a notes field for defect IDs.
8. **Re-run** with **New run** — preserves prior runs as history (visible in the **Past runs** disclosure under the active run).
9. **Export** the test as an **Evidence PDF** or **Word** doc (per-test cover page + every run's metadata + captured steps with annotations burned in), or export the whole plan as a **PDF / Word summary table** or full **JSON**.

### CSV example

```csv
Number,Name,Precondition,Expected,Priority
T-001,Login with valid credentials,User has account,Logged in to dashboard,High
T-002,Login fails with bad password,—,Error message shown,Med
T-003,Reset password email,User exists,Email arrives within 1 min,Med
```

## Capture mode

Click **Capture** in the editor sidebar (or in a test run). The browser asks which window, tab, or screen you want to share — pick the application you're documenting. A small floating panel appears with a red recording dot and a step counter.

- Click **Capture (F9)** or press **F9** to grab the current frame as a new step
- Drag the panel out of the way if it overlaps your target app
- Click **Stop** (or **Shift+Esc**) to end the session and return to the editor, where you can drop hotspots and write instructions

Capture mode uses the browser's [Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API) — no extension or backend required. It works in current Chrome, Edge, Firefox, and Safari (macOS 13+).

## Export formats

- **PDF** — opens a hidden iframe with a print-styled document and triggers the system print dialog. Choose "Save as PDF" as the destination.
- **Word** — downloads a `.doc` file (HTML-based Word document) with embedded images. Hotspots and annotations are burned into each screenshot via canvas so they survive in Word, LibreOffice, or Google Docs.
- **JSON** — downloads a `.clickguide.json` (guide) or `.testplan.json` (plan) for full-fidelity round-tripping.

## Data model

### Guide

```jsonc
{
  "id": "string",
  "title": "string", "description": "string",
  "createdAt": 0, "updatedAt": 0,
  "steps": [
    {
      "id": "string",
      "title": "string", "instruction": "string",
      "image": "data:image/png;base64,...",
      "hotspot": { "x": 0.42, "y": 0.78 }
    }
  ]
}
```

### Test plan

```jsonc
{
  "id": "string", "kind": "testplan",
  "title": "string", "description": "string",
  "tester": "string",
  "environments": ["DEV", "SIT", "UAT", "PROD"],
  "activeEnvironment": "UAT",
  "createdAt": 0, "updatedAt": 0,
  "tests": [
    {
      "id": "string",
      "number": "T-001", "name": "...",
      "precondition": "...", "expected": "...", "priority": "High",
      "runs": [
        {
          "id": "string",
          "environment": "UAT",
          "status": "Pass",            // NotRun | Pass | Fail | Blocked
          "notes": "DEF-123",
          "tester": "Jane Doe",
          "startedAt": 0, "finishedAt": 0,
          "steps": [
            {
              "id": "string",
              "title": "string", "instruction": "string",
              "image": "data:image/png;base64,...",
              "hotspot": { "x": 0.42, "y": 0.78 },
              "annotations": [
                { "id": "...", "type": "box", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1 },
                { "id": "...", "type": "label", "x": 0.5, "y": 0.5, "text": "Expected: 200 OK" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

All hotspot/box/label coordinates are normalized to `[0, 1]` relative to the screenshot, so they stay anchored when the image is rendered at different sizes.

## Notes & limitations

- Screenshots are stored as data URLs in `localStorage`. Browsers typically cap that around 5–10 MB per origin — large plans or long runs may hit the quota. Use JSON export for backup.
- One click hotspot per step is intentional; the box/label tools cover everything else.
- Captured frames don't track the OS cursor automatically — drop hotspots after capture.
