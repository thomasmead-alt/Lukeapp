# ClickGuide

A lightweight, ClickLearn-style web app for building click-by-click software walkthroughs. Upload screenshots, drop hotspots where the user should click, write instructions, and play it back as an interactive guide.

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

## Data model

```jsonc
{
  "id": "string",
  "title": "string",
  "description": "string",
  "createdAt": 1714000000000,
  "updatedAt": 1714000000000,
  "steps": [
    {
      "id": "string",
      "title": "string",
      "instruction": "string",
      "image": "data:image/png;base64,...",
      "hotspot": { "x": 0.42, "y": 0.78 }
    }
  ]
}
```

`hotspot.x` and `hotspot.y` are normalized to the range `[0, 1]` relative to the screenshot, so the marker stays anchored when the image is rendered at different sizes.

## Notes & limitations

- Screenshots are stored as data URLs in `localStorage`. Browsers typically cap that around 5–10 MB per origin — large images or long guides may hit the quota. Use the JSON export for backup.
- Single hotspot per step is intentional to keep authoring fast. Multi-hotspot support could be added by changing `step.hotspot` to an array.
- No video / animated step capture — this is a static-screenshot tool, like ClickLearn's authored guides rather than its automatic screen recorder.
