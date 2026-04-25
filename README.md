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
- **Interactive player** — preview a guide step-by-step with a pulsing hotspot, instruction card, progress dots, and keyboard navigation (← / → / Space / Esc)
- **Import / Export** — share guides as `.clickguide.json` files
- **Local persistence** — guides are saved in `localStorage` automatically

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
