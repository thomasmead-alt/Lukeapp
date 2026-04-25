(() => {
  "use strict";

  const STORAGE_KEY = "clickguide.guides.v1";

  // ---------- State ----------
  const state = {
    guides: [],
    view: "home",       // "home" | "editor" | "player"
    activeGuideId: null,
    activeStepId: null,
    playerIndex: 0,
  };

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const tpl = (id) => document.getElementById(id).content.cloneNode(true);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // ---------- Persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("Failed to load guides", e);
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.guides));
    } catch (e) {
      // localStorage quota can be hit when multiple screenshots are stored as data URLs
      toast("Couldn't save. Storage quota may be full.");
      console.error(e);
    }
  }

  // ---------- Models ----------
  function createGuide() {
    return {
      id: uid(),
      title: "Untitled guide",
      description: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [createStep()],
    };
  }

  function createStep() {
    return {
      id: uid(),
      title: "",
      instruction: "",
      image: null,           // data URL
      hotspot: null,         // { x: 0..1, y: 0..1 } in image-relative coordinates
    };
  }

  function getGuide(id) { return state.guides.find((g) => g.id === id) || null; }
  function getStep(guide, id) { return guide.steps.find((s) => s.id === id) || null; }

  function touchGuide(guide) {
    guide.updatedAt = Date.now();
    save();
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 250);
    }, 2200);
  }

  // ---------- Render ----------
  function render() {
    const root = $("#view-root");
    root.replaceChildren();
    if (state.view === "home") return renderHome(root);
    if (state.view === "editor") return renderEditor(root);
    if (state.view === "player") return renderPlayer(root);
  }

  function renderHome(root) {
    root.appendChild(tpl("tpl-home"));
    const list = $("#guide-list");
    if (state.guides.length === 0) {
      const empty = document.createElement("div");
      empty.className = "guide-empty";
      empty.textContent = "No guides yet. Create your first one to get started.";
      list.appendChild(empty);
      return;
    }
    const sorted = [...state.guides].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const g of sorted) {
      const card = document.createElement("div");
      card.className = "guide-card";
      card.dataset.guideId = g.id;
      const stepCount = g.steps.length;
      card.innerHTML = `
        <h3></h3>
        <p></p>
        <div class="meta">
          <span></span>
          <span></span>
        </div>
      `;
      card.querySelector("h3").textContent = g.title || "Untitled guide";
      card.querySelector("p").textContent = g.description || "No description yet.";
      card.querySelector(".meta span:first-child").textContent =
        `${stepCount} step${stepCount === 1 ? "" : "s"}`;
      card.querySelector(".meta span:last-child").textContent = formatDate(g.updatedAt);
      card.addEventListener("click", () => openEditor(g.id));
      list.appendChild(card);
    }
  }

  function renderEditor(root) {
    const guide = getGuide(state.activeGuideId);
    if (!guide) { state.view = "home"; return render(); }

    root.appendChild(tpl("tpl-editor"));

    const titleInput = $('[data-bind="title"]');
    const descInput = $('[data-bind="description"]');
    titleInput.value = guide.title;
    descInput.value = guide.description;
    titleInput.addEventListener("input", (e) => {
      guide.title = e.target.value;
      touchGuide(guide);
    });
    descInput.addEventListener("input", (e) => {
      guide.description = e.target.value;
      touchGuide(guide);
    });

    renderStepList(guide);
    renderActiveStep(guide);
  }

  function renderStepList(guide) {
    const list = $("#step-list");
    list.replaceChildren();
    guide.steps.forEach((step, i) => {
      const li = document.createElement("li");
      li.className = "step-item" + (step.id === state.activeStepId ? " active" : "");
      li.dataset.stepId = step.id;
      li.draggable = true;
      li.innerHTML = `
        <span class="step-index"></span>
        <span class="step-name"></span>
        <span class="step-actions">
          <button class="icon-btn" title="Move up" data-act="up">&uarr;</button>
          <button class="icon-btn" title="Move down" data-act="down">&darr;</button>
          <button class="icon-btn" title="Delete" data-act="del">&times;</button>
        </span>
      `;
      li.querySelector(".step-index").textContent = String(i + 1).padStart(2, "0");
      li.querySelector(".step-name").textContent = step.title || "Untitled step";
      li.addEventListener("click", (e) => {
        if (e.target.closest(".step-actions")) return;
        state.activeStepId = step.id;
        renderStepList(guide);
        renderActiveStep(guide);
      });
      li.querySelectorAll(".icon-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === "up") moveStep(guide, i, -1);
          else if (act === "down") moveStep(guide, i, 1);
          else if (act === "del") deleteStep(guide, step.id);
        });
      });
      list.appendChild(li);
    });
  }

  function renderActiveStep(guide) {
    const main = $("#editor-main");
    main.replaceChildren();
    if (!state.activeStepId && guide.steps.length) {
      state.activeStepId = guide.steps[0].id;
    }
    const step = getStep(guide, state.activeStepId);
    if (!step) {
      const placeholder = document.createElement("p");
      placeholder.style.color = "var(--muted)";
      placeholder.style.margin = "auto";
      placeholder.textContent = "Add a step from the sidebar to get started.";
      main.appendChild(placeholder);
      return;
    }

    if (!step.image) {
      const empty = tpl("tpl-step-empty");
      const wrap = empty.querySelector(".step-empty");
      wrap.addEventListener("dragover", (e) => {
        e.preventDefault();
        wrap.classList.add("dragover");
      });
      wrap.addEventListener("dragleave", () => wrap.classList.remove("dragover"));
      wrap.addEventListener("drop", (e) => {
        e.preventDefault();
        wrap.classList.remove("dragover");
        const file = e.dataTransfer.files?.[0];
        if (file) handleScreenshotFile(file, guide, step);
      });
      main.appendChild(empty);
      return;
    }

    main.appendChild(tpl("tpl-step-editor"));
    const titleEl = $('[data-bind="step-title"]');
    const instrEl = $('[data-bind="step-instruction"]');
    titleEl.value = step.title;
    instrEl.value = step.instruction;
    titleEl.addEventListener("input", (e) => {
      step.title = e.target.value;
      touchGuide(guide);
      // update sidebar label
      const item = $(`.step-item[data-step-id="${step.id}"] .step-name`);
      if (item) item.textContent = step.title || "Untitled step";
    });
    instrEl.addEventListener("input", (e) => {
      step.instruction = e.target.value;
      touchGuide(guide);
    });

    const img = $("#canvas-img");
    img.addEventListener("load", () => positionHotspot(step), { once: true });
    img.src = step.image;
    if (img.complete && img.naturalWidth) positionHotspot(step);

    const canvas = $("#canvas");
    canvas.addEventListener("click", (e) => {
      const rect = img.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      step.hotspot = { x: clamp01(x), y: clamp01(y) };
      touchGuide(guide);
      positionHotspot(step);
    });
  }

  function positionHotspot(step) {
    const img = $("#canvas-img");
    const hotspot = $("#hotspot");
    if (!step.hotspot || !img) {
      hotspot.hidden = true;
      return;
    }
    hotspot.hidden = false;
    hotspot.style.left = `${step.hotspot.x * img.clientWidth}px`;
    hotspot.style.top = `${step.hotspot.y * img.clientHeight}px`;
  }

  // ---------- Player ----------
  function renderPlayer(root) {
    const guide = getGuide(state.activeGuideId);
    if (!guide || guide.steps.length === 0) {
      state.view = "editor";
      toast("Add at least one step to preview the guide.");
      return render();
    }

    root.appendChild(tpl("tpl-player"));
    $("#player-title").textContent = guide.title || "Untitled guide";
    renderPlayerStep(guide);
  }

  function renderPlayerStep(guide) {
    const idx = clamp(state.playerIndex, 0, guide.steps.length - 1);
    state.playerIndex = idx;
    const step = guide.steps[idx];

    $("#player-progress").textContent =
      `Step ${idx + 1} of ${guide.steps.length}`;

    const stage = $("#player-stage");
    stage.replaceChildren();

    if (!step.image) {
      const empty = document.createElement("div");
      empty.className = "player-empty";
      empty.textContent = "This step has no screenshot yet.";
      stage.appendChild(empty);
    } else {
      const canvas = document.createElement("div");
      canvas.className = "player-canvas";
      const img = document.createElement("img");
      img.alt = "";
      const hot = document.createElement("div");
      hot.className = "hotspot";
      hot.innerHTML = `<span class="hotspot-pulse"></span><span class="hotspot-dot"></span>`;
      hot.hidden = !step.hotspot;
      const place = () => {
        if (!step.hotspot) return;
        const rect = img.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        hot.style.left = `${(rect.left - canvasRect.left) + step.hotspot.x * img.clientWidth}px`;
        hot.style.top = `${(rect.top - canvasRect.top) + step.hotspot.y * img.clientHeight}px`;
      };
      img.addEventListener("load", place);
      canvas.appendChild(img);
      canvas.appendChild(hot);
      stage.appendChild(canvas);
      img.src = step.image;
      if (img.complete && img.naturalWidth) place();
    }

    const card = document.createElement("div");
    card.className = "player-card";
    card.innerHTML = `
      <span class="step-num"></span>
      <h3></h3>
      <p></p>
    `;
    card.querySelector(".step-num").textContent = `STEP ${idx + 1}`;
    card.querySelector("h3").textContent = step.title || "Untitled step";
    card.querySelector("p").textContent = step.instruction || "(No instructions for this step.)";
    stage.appendChild(card);

    const dots = $("#player-dots");
    dots.replaceChildren();
    guide.steps.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.className = "player-dot" + (i === idx ? " active" : i < idx ? " done" : "");
      dot.addEventListener("click", () => {
        state.playerIndex = i;
        renderPlayerStep(guide);
      });
      dots.appendChild(dot);
    });
  }

  function playerNext() {
    const guide = getGuide(state.activeGuideId);
    if (!guide) return;
    if (state.playerIndex < guide.steps.length - 1) {
      state.playerIndex++;
      renderPlayerStep(guide);
    } else {
      toast("End of guide.");
    }
  }
  function playerPrev() {
    const guide = getGuide(state.activeGuideId);
    if (!guide) return;
    if (state.playerIndex > 0) {
      state.playerIndex--;
      renderPlayerStep(guide);
    }
  }

  // ---------- Actions ----------
  function newGuide() {
    const g = createGuide();
    state.guides.push(g);
    save();
    openEditor(g.id);
  }

  function openEditor(id) {
    const g = getGuide(id);
    if (!g) return;
    state.view = "editor";
    state.activeGuideId = id;
    state.activeStepId = g.steps[0]?.id || null;
    render();
  }

  function goHome() {
    state.view = "home";
    state.activeGuideId = null;
    state.activeStepId = null;
    render();
  }

  function addStep(guide) {
    const step = createStep();
    guide.steps.push(step);
    state.activeStepId = step.id;
    touchGuide(guide);
    renderStepList(guide);
    renderActiveStep(guide);
    // Auto-prompt the user for a screenshot for the new step
    triggerScreenshotUpload(guide, step);
  }

  function deleteStep(guide, stepId) {
    if (guide.steps.length <= 1) {
      toast("A guide needs at least one step.");
      return;
    }
    if (!confirm("Delete this step?")) return;
    const idx = guide.steps.findIndex((s) => s.id === stepId);
    guide.steps.splice(idx, 1);
    if (state.activeStepId === stepId) {
      state.activeStepId = guide.steps[Math.max(0, idx - 1)].id;
    }
    touchGuide(guide);
    renderStepList(guide);
    renderActiveStep(guide);
  }

  function moveStep(guide, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= guide.steps.length) return;
    const [step] = guide.steps.splice(index, 1);
    guide.steps.splice(target, 0, step);
    touchGuide(guide);
    renderStepList(guide);
  }

  function deleteGuide() {
    const guide = getGuide(state.activeGuideId);
    if (!guide) return;
    if (!confirm(`Delete "${guide.title || "this guide"}"? This cannot be undone.`)) return;
    state.guides = state.guides.filter((g) => g.id !== guide.id);
    save();
    goHome();
  }

  function exportGuide() {
    const guide = getGuide(state.activeGuideId);
    if (!guide) return;
    const blob = new Blob([JSON.stringify(guide, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeTitle = (guide.title || "guide").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = `${safeTitle}.clickguide.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Exported.");
  }

  function importGuide() {
    $("#import-input").click();
  }

  async function handleImportFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.steps)) throw new Error("Invalid file format");
      // Re-id to avoid collisions
      data.id = uid();
      data.steps = data.steps.map((s) => ({ ...createStep(), ...s, id: uid() }));
      data.createdAt = data.createdAt || Date.now();
      data.updatedAt = Date.now();
      state.guides.push(data);
      save();
      toast("Imported guide.");
      openEditor(data.id);
    } catch (e) {
      console.error(e);
      toast("Couldn't import. The file looks invalid.");
    }
  }

  // ---------- Screenshot upload ----------
  let pendingUpload = null; // { guideId, stepId }

  function triggerScreenshotUpload(guide, step) {
    pendingUpload = { guideId: guide.id, stepId: step.id };
    $("#screenshot-input").click();
  }

  function handleScreenshotFile(file, guide, step) {
    if (!file.type.startsWith("image/")) {
      toast("Please select an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      step.image = reader.result;
      step.hotspot = null; // reset hotspot for new image
      touchGuide(guide);
      renderActiveStep(guide);
    };
    reader.onerror = () => toast("Failed to read the image.");
    reader.readAsDataURL(file);
  }

  // ---------- Utilities ----------
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function clamp01(n) { return clamp(n, 0, 1); }
  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function safeFilename(s) {
    return (s || "guide").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase().slice(0, 60) || "guide";
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = src;
    });
  }

  // ---------- Document export (PDF + Word) ----------
  // Burn the hotspot directly onto a copy of the screenshot so it survives in
  // any output format (print, .doc, etc.) without needing absolute positioning.
  async function composeStepImage(step) {
    if (!step.image) return null;
    const img = await loadImage(step.image);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (step.hotspot) {
      const x = step.hotspot.x * canvas.width;
      const y = step.hotspot.y * canvas.height;
      const r = Math.max(10, Math.min(canvas.width, canvas.height) * 0.018);
      ctx.fillStyle = "rgba(79, 140, 255, 0.20)";
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(79, 140, 255, 0.95)";
      ctx.lineWidth = Math.max(2, r * 0.35);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4f8cff";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas.toDataURL("image/png");
  }

  async function buildGuideHtml(guide) {
    const composed = await Promise.all(guide.steps.map(composeStepImage));
    const stepsHtml = guide.steps.map((s, i) => {
      const num = String(i + 1).padStart(2, "0");
      const title = escapeHtml(s.title || `Step ${i + 1}`);
      const instr = s.instruction ? `<p class="instr">${escapeHtml(s.instruction)}</p>` : "";
      const imgTag = composed[i]
        ? `<img src="${composed[i]}" alt="" />`
        : `<div class="no-img">No screenshot</div>`;
      return `
        <section class="step">
          <h2><span class="num">${num}</span>${title}</h2>
          ${imgTag}
          ${instr}
        </section>`;
    }).join("");

    const css = `
      body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
             color: #1a1a1a; margin: 32px; line-height: 1.5; }
      h1 { font-size: 26px; margin: 0 0 4px; }
      .desc { color: #555; margin: 0 0 28px; font-size: 14px; }
      .meta { color: #888; font-size: 12px; margin-bottom: 24px; }
      .step { margin: 0 0 28px; page-break-inside: avoid; }
      .step h2 { font-size: 16px; margin: 0 0 10px; }
      .num { display: inline-block; min-width: 28px; color: #4f8cff;
             font-weight: 700; margin-right: 8px; }
      .step img { display: block; max-width: 100%; height: auto;
                  border: 1px solid #ddd; border-radius: 4px; }
      .no-img { padding: 40px; background: #f4f5f7; color: #888;
                text-align: center; border-radius: 4px; }
      .instr { margin: 12px 0 0; white-space: pre-wrap; }
      @page { margin: 18mm; }
      @media print {
        body { margin: 0; }
        .step { page-break-after: always; }
        .step:last-child { page-break-after: auto; }
      }`;

    return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(guide.title || "Guide")}</title>
<style>${css}</style>
</head>
<body>
<h1>${escapeHtml(guide.title || "Untitled guide")}</h1>
${guide.description ? `<p class="desc">${escapeHtml(guide.description)}</p>` : ""}
<p class="meta">${guide.steps.length} step${guide.steps.length === 1 ? "" : "s"} &middot; ${escapeHtml(formatDate(guide.updatedAt))}</p>
${stepsHtml}
</body>
</html>`;
  }

  async function exportPdf() {
    const guide = getGuide(state.activeGuideId);
    if (!guide) return;
    toast("Preparing PDF...");
    try {
      const html = await buildGuideHtml(guide);
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(iframe);
      let printed = false;
      const doPrint = () => {
        if (printed) return;
        printed = true;
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          console.error(e);
          toast("PDF print failed. Try the Word export instead.");
        }
        setTimeout(() => iframe.remove(), 1500);
      };
      iframe.onload = () => {
        const imgs = Array.from(iframe.contentDocument.images);
        let remaining = imgs.filter((i) => !i.complete).length;
        if (remaining === 0) return doPrint();
        const done = () => { if (--remaining <= 0) doPrint(); };
        imgs.forEach((i) => {
          if (i.complete) return;
          i.addEventListener("load", done, { once: true });
          i.addEventListener("error", done, { once: true });
        });
        setTimeout(doPrint, 4000); // safety fallback
      };
      const doc = iframe.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
    } catch (e) {
      console.error(e);
      toast("Couldn't build PDF: " + e.message);
    }
  }

  async function exportWord() {
    const guide = getGuide(state.activeGuideId);
    if (!guide) return;
    toast("Preparing Word document...");
    try {
      const html = await buildGuideHtml(guide);
      const blob = new Blob(["﻿", html], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFilename(guide.title)}.doc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Word document downloaded.");
    } catch (e) {
      console.error(e);
      toast("Couldn't build Word document: " + e.message);
    }
  }

  // ---------- Capture mode (screen recording -> step screenshots) ----------
  const capture = {
    stream: null,
    video: null,
    panel: null,
    guideId: null,
    count: 0,
  };

  async function startCapture(guide) {
    if (capture.stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast("Capture mode needs a browser with screen-sharing support.");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always", frameRate: 15 },
        audio: false,
      });
    } catch (e) {
      if (e.name !== "NotAllowedError") {
        toast("Couldn't start capture: " + e.message);
      }
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      toast("Couldn't start preview: " + e.message);
      return;
    }
    capture.stream = stream;
    capture.video = video;
    capture.guideId = guide.id;
    capture.count = 0;
    stream.getVideoTracks()[0].addEventListener("ended", stopCapture);
    showCapturePanel();
    document.addEventListener("keydown", captureHotkey, true);
    toast("Capture started. Press F9 or click Capture to grab a step.");
  }

  function stopCapture() {
    if (!capture.stream) return;
    capture.stream.getTracks().forEach((t) => t.stop());
    capture.stream = null;
    capture.video = null;
    document.removeEventListener("keydown", captureHotkey, true);
    if (capture.panel) {
      capture.panel.remove();
      capture.panel = null;
    }
    const id = capture.guideId;
    capture.guideId = null;
    capture.count = 0;
    if (id) openEditor(id);
  }

  function captureFrame() {
    if (!capture.video) return;
    const w = capture.video.videoWidth;
    const h = capture.video.videoHeight;
    if (!w || !h) {
      toast("Stream not ready yet.");
      return;
    }
    const guide = getGuide(capture.guideId);
    if (!guide) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(capture.video, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    let step;
    const last = guide.steps[guide.steps.length - 1];
    if (
      guide.steps.length === 1 &&
      !last.image &&
      !last.title &&
      !last.instruction
    ) {
      step = last;
    } else {
      step = createStep();
      guide.steps.push(step);
    }
    step.image = dataUrl;
    step.hotspot = null;
    capture.count++;
    touchGuide(guide);
    flashCapturePanel();
    updateCapturePanelCount();
  }

  function captureHotkey(e) {
    if (e.key === "F9") {
      e.preventDefault();
      captureFrame();
    } else if (e.key === "Escape" && e.shiftKey) {
      e.preventDefault();
      stopCapture();
    }
  }

  function showCapturePanel() {
    const panel = document.createElement("div");
    panel.className = "capture-panel";
    panel.innerHTML = `
      <div class="capture-dot"></div>
      <div class="capture-text">
        <strong>Capture mode</strong>
        <span class="capture-count">0 steps captured</span>
      </div>
      <button class="btn btn-primary btn-sm" data-cap="grab">Capture (F9)</button>
      <button class="btn btn-ghost btn-sm" data-cap="stop">Stop</button>
    `;
    panel.querySelector('[data-cap="grab"]').addEventListener("click", captureFrame);
    panel.querySelector('[data-cap="stop"]').addEventListener("click", stopCapture);
    makeDraggable(panel);
    document.body.appendChild(panel);
    capture.panel = panel;
  }

  function updateCapturePanelCount() {
    if (!capture.panel) return;
    const el = capture.panel.querySelector(".capture-count");
    if (el) el.textContent = `${capture.count} step${capture.count === 1 ? "" : "s"} captured`;
  }

  function flashCapturePanel() {
    if (!capture.panel) return;
    capture.panel.classList.add("flash");
    setTimeout(() => capture.panel && capture.panel.classList.remove("flash"), 250);
  }

  function makeDraggable(el) {
    let dragging = false;
    let startX = 0, startY = 0, originX = 0, originY = 0;
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      el.style.right = "auto";
      el.style.bottom = "auto";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = `${originX + (e.clientX - startX)}px`;
      el.style.top = `${originY + (e.clientY - startY)}px`;
    });
    document.addEventListener("mouseup", () => { dragging = false; });
  }

  // ---------- Global event wiring ----------
  document.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;

    const guide = getGuide(state.activeGuideId);
    const step = guide && getStep(guide, state.activeStepId);

    switch (action) {
      case "go-home": goHome(); break;
      case "new-guide": newGuide(); break;
      case "import-guide": importGuide(); break;
      case "add-step": if (guide) addStep(guide); break;
      case "upload-screenshot":
      case "replace-screenshot":
        if (guide && step) triggerScreenshotUpload(guide, step);
        break;
      case "clear-hotspot":
        if (step) {
          step.hotspot = null;
          touchGuide(guide);
          positionHotspot(step);
        }
        break;
      case "export-guide": exportGuide(); break;
      case "export-pdf": exportPdf(); break;
      case "export-word": exportWord(); break;
      case "start-capture": if (guide) startCapture(guide); break;
      case "play-guide":
        if (guide) {
          state.view = "player";
          state.playerIndex = 0;
          render();
        }
        break;
      case "exit-player": openEditor(state.activeGuideId); break;
      case "player-next": playerNext(); break;
      case "player-prev": playerPrev(); break;
      case "delete-guide": deleteGuide(); break;
    }
  });

  $("#screenshot-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingUpload) return;
    const guide = getGuide(pendingUpload.guideId);
    const step = guide && getStep(guide, pendingUpload.stepId);
    pendingUpload = null;
    if (guide && step) handleScreenshotFile(file, guide, step);
  });

  $("#import-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleImportFile(file);
  });

  document.addEventListener("keydown", (e) => {
    if (state.view === "player") {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); playerNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); playerPrev(); }
      else if (e.key === "Escape") openEditor(state.activeGuideId);
    }
  });

  window.addEventListener("resize", () => {
    if (state.view === "editor") {
      const guide = getGuide(state.activeGuideId);
      const step = guide && getStep(guide, state.activeStepId);
      if (step) positionHotspot(step);
    }
  });

  // ---------- Boot ----------
  state.guides = load();
  render();
})();
