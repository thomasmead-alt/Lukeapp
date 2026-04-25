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
