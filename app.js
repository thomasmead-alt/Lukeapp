(() => {
  "use strict";

  const STORAGE_KEY = "clickguide.guides.v1";
  const TESTPLANS_KEY = "clickguide.testplans.v1";
  const SETTINGS_KEY = "clickguide.settings.v1";

  const DEFAULT_ENVS = ["DEV", "SIT", "UAT", "PROD"];
  const STATUSES = ["NotRun", "Pass", "Fail", "Blocked"];
  const STATUS_LABELS = {
    NotRun: "Not Run", Pass: "Pass", Fail: "Fail", Blocked: "Blocked",
  };

  // ---------- State ----------
  const state = {
    guides: [],
    testplans: [],
    settings: { tester: "", environments: [...DEFAULT_ENVS] },
    view: "home",       // "home" | "editor" | "testplan-editor" | "player"
    homeTab: "guides",  // "guides" | "testplans"
    activeGuideId: null,
    activeStepId: null,
    activeTestPlanId: null,
    activeTestId: null,
    activeRunId: null,
    activeRunStepId: null,
    annotationTool: "hotspot", // "hotspot" | "box" | "label"
    pendingLabel: null,        // { stepId, x, y } while prompt is open
    testFilter: "",
    statusFilter: "all",
    playerIndex: 0,
  };

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const tpl = (id) => document.getElementById(id).content.cloneNode(true);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // ---------- Persistence ----------
  // Storage may be unavailable (file:// origin restrictions, private mode,
  // disabled by policy) or fill up. We probe up front, then no-op writes when
  // unavailable and surface a persistent banner so the user knows their work
  // won't survive a refresh.
  const storage = {
    available: false,
    reason: "",
    warned: false,
  };

  function probeStorage() {
    try {
      const k = "__cg_probe__";
      localStorage.setItem(k, "1");
      const ok = localStorage.getItem(k) === "1";
      localStorage.removeItem(k);
      if (!ok) throw new Error("read-back mismatch");
      storage.available = true;
    } catch (e) {
      storage.available = false;
      storage.reason = describeStorageError(e);
      console.warn("localStorage unavailable:", e);
    }
  }

  function describeStorageError(e) {
    const name = (e && e.name) || "";
    const msg = (e && e.message) || String(e);
    if (name === "QuotaExceededError" || /quota/i.test(msg)) {
      return "Browser storage is full. Export anything important as JSON, then delete old guides or runs.";
    }
    if (name === "SecurityError" || /denied|disabled|access/i.test(msg)) {
      return "Browser blocked storage on this page. If you opened the file directly, run it from a local server (e.g. `python3 -m http.server`) and reload.";
    }
    return "Browser storage isn't working. Your work this session won't be saved across refreshes.";
  }

  function showStorageBanner(text) {
    const existing = $("#storage-banner");
    if (existing) {
      existing.querySelector(".banner-text").textContent = text;
      return;
    }
    const banner = document.createElement("div");
    banner.id = "storage-banner";
    banner.className = "storage-banner";
    banner.innerHTML = `
      <span class="banner-icon">!</span>
      <span class="banner-text"></span>
      <button class="icon-btn" data-banner-close title="Dismiss">&times;</button>
    `;
    banner.querySelector(".banner-text").textContent = text;
    banner.querySelector("[data-banner-close]").addEventListener("click", () => banner.remove());
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function reportStorageError(e) {
    storage.available = false;
    storage.reason = describeStorageError(e);
    console.error(e);
    if (!storage.warned) {
      storage.warned = true;
      showStorageBanner(storage.reason);
    }
  }

  function safeRead(key) {
    if (!storage.available) return null;
    try {
      return localStorage.getItem(key);
    } catch (e) {
      reportStorageError(e);
      return null;
    }
  }

  function safeWrite(key, value) {
    if (!storage.available) return false;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      reportStorageError(e);
      return false;
    }
  }

  function load() {
    const raw = safeRead(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("Failed to parse guides", e);
      return [];
    }
  }

  function save() { safeWrite(STORAGE_KEY, JSON.stringify(state.guides)); }

  function loadTestPlans() {
    const raw = safeRead(TESTPLANS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function saveTestPlans() { safeWrite(TESTPLANS_KEY, JSON.stringify(state.testplans)); }

  function loadSettings() {
    const raw = safeRead(SETTINGS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        tester: parsed.tester || "",
        environments: Array.isArray(parsed.environments) && parsed.environments.length
          ? parsed.environments : [...DEFAULT_ENVS],
      };
    } catch (e) { return null; }
  }

  function saveSettings() { safeWrite(SETTINGS_KEY, JSON.stringify(state.settings)); }

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

  // ---------- Test plan models ----------
  function createTestPlan() {
    return {
      id: uid(),
      kind: "testplan",
      title: "Untitled test plan",
      description: "",
      tester: state.settings.tester || "",
      environments: [...state.settings.environments],
      activeEnvironment: state.settings.environments[0] || "DEV",
      tests: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  function createTest(extra = {}) {
    return {
      id: uid(),
      number: extra.number || "",
      name: extra.name || "Untitled test",
      precondition: extra.precondition || "",
      expected: extra.expected || "",
      priority: extra.priority || "",
      runs: [],
    };
  }
  function createRun(env, tester) {
    return {
      id: uid(),
      environment: env,
      status: "NotRun",
      notes: "",
      tester: tester || "",
      startedAt: Date.now(),
      finishedAt: null,
      steps: [],
    };
  }
  function createRunStep() {
    return {
      id: uid(),
      title: "",
      instruction: "",
      image: null,
      hotspot: null,
      annotations: [],
    };
  }
  function getTestPlan(id) { return state.testplans.find((p) => p.id === id) || null; }
  function getTest(plan, id) { return plan && plan.tests.find((t) => t.id === id) || null; }
  function getRun(test, id) { return test && test.runs.find((r) => r.id === id) || null; }
  function getRunStep(run, id) { return run && run.steps.find((s) => s.id === id) || null; }
  function touchTestPlan(plan) {
    plan.updatedAt = Date.now();
    saveTestPlans();
  }

  function latestRunForEnv(test, env) {
    const matches = test.runs.filter((r) => r.environment === env);
    if (!matches.length) return null;
    return matches.reduce((a, b) => (a.startedAt > b.startedAt ? a : b));
  }
  function statusFor(test, env) {
    const r = latestRunForEnv(test, env);
    return r ? r.status : "NotRun";
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
    if (state.view === "testplan-editor") return renderTestPlanEditor(root);
    if (state.view === "player") return renderPlayer(root);
  }

  function renderHome(root) {
    root.appendChild(tpl("tpl-home"));
    $$(".home-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === state.homeTab);
      btn.addEventListener("click", () => {
        state.homeTab = btn.dataset.tab;
        renderHomeList();
      });
    });
    renderHomeList();
  }

  function renderHomeList() {
    $$(".home-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === state.homeTab);
    });
    const list = $("#guide-list");
    list.replaceChildren();
    if (state.homeTab === "guides") return renderGuideCards(list);
    if (state.homeTab === "testplans") return renderTestPlanCards(list);
  }

  function renderGuideCards(list) {
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
      card.innerHTML = `
        <span class="tag tag-guide">Guide</span>
        <h3></h3>
        <p></p>
        <div class="meta"><span></span><span></span></div>
      `;
      card.querySelector("h3").textContent = g.title || "Untitled guide";
      card.querySelector("p").textContent = g.description || "No description yet.";
      const sc = g.steps.length;
      card.querySelector(".meta span:first-child").textContent =
        `${sc} step${sc === 1 ? "" : "s"}`;
      card.querySelector(".meta span:last-child").textContent = formatDate(g.updatedAt);
      card.addEventListener("click", () => openEditor(g.id));
      list.appendChild(card);
    }
  }

  function renderTestPlanCards(list) {
    if (state.testplans.length === 0) {
      const empty = document.createElement("div");
      empty.className = "guide-empty";
      empty.textContent = "No test plans yet. Create one to start tracking test evidence.";
      list.appendChild(empty);
      return;
    }
    const sorted = [...state.testplans].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const p of sorted) {
      const card = document.createElement("div");
      card.className = "guide-card";
      const env = p.activeEnvironment || (p.environments[0] || "DEV");
      const counts = STATUSES.reduce((acc, s) => ((acc[s] = 0), acc), {});
      p.tests.forEach((t) => { counts[statusFor(t, env)]++; });
      card.innerHTML = `
        <span class="tag tag-test">Test plan</span>
        <h3></h3>
        <p></p>
        <div class="status-row"></div>
        <div class="meta"><span></span><span></span></div>
      `;
      card.querySelector("h3").textContent = p.title || "Untitled plan";
      card.querySelector("p").textContent = p.description || "No description yet.";
      const sr = card.querySelector(".status-row");
      STATUSES.forEach((s) => {
        if (!counts[s]) return;
        const pill = document.createElement("span");
        pill.className = `status-pill status-${s}`;
        pill.textContent = `${counts[s]} ${STATUS_LABELS[s]}`;
        sr.appendChild(pill);
      });
      card.querySelector(".meta span:first-child").textContent =
        `${p.tests.length} test${p.tests.length === 1 ? "" : "s"} · ${env}`;
      card.querySelector(".meta span:last-child").textContent = formatDate(p.updatedAt);
      card.addEventListener("click", () => openTestPlan(p.id));
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
    state.activeTestPlanId = null;
    state.activeTestId = null;
    state.activeRunId = null;
    render();
  }

  // ---------- Test plan editor ----------
  function newTestPlan() {
    const p = createTestPlan();
    state.testplans.push(p);
    saveTestPlans();
    openTestPlan(p.id);
  }

  function openTestPlan(id, testId) {
    const plan = getTestPlan(id);
    if (!plan) return;
    state.view = "testplan-editor";
    state.activeTestPlanId = id;
    state.activeTestId = testId || (plan.tests[0]?.id || null);
    state.activeRunId = null;
    render();
  }

  function renderTestPlanEditor(root) {
    const plan = getTestPlan(state.activeTestPlanId);
    if (!plan) { state.view = "home"; return render(); }
    root.appendChild(tpl("tpl-testplan-editor"));

    // Bind meta inputs
    $('[data-bind="title"]').value = plan.title;
    $('[data-bind="description"]').value = plan.description;
    $('[data-bind="tester"]').value = plan.tester;

    $('[data-bind="title"]').addEventListener("input", (e) => {
      plan.title = e.target.value; touchTestPlan(plan);
    });
    $('[data-bind="description"]').addEventListener("input", (e) => {
      plan.description = e.target.value; touchTestPlan(plan);
    });
    $('[data-bind="tester"]').addEventListener("input", (e) => {
      plan.tester = e.target.value;
      // If active run exists and has no tester, set it
      const t = getTest(plan, state.activeTestId);
      const r = t && getRun(t, state.activeRunId);
      if (r && !r.tester) r.tester = plan.tester;
      touchTestPlan(plan);
    });

    // Environment dropdown
    const envSel = $('[data-bind="environment"]');
    plan.environments.forEach((env) => {
      const opt = document.createElement("option");
      opt.value = env; opt.textContent = env;
      envSel.appendChild(opt);
    });
    if (!plan.environments.includes(plan.activeEnvironment)) {
      plan.activeEnvironment = plan.environments[0] || "DEV";
    }
    envSel.value = plan.activeEnvironment;
    envSel.addEventListener("change", (e) => {
      plan.activeEnvironment = e.target.value;
      state.activeRunId = null; // re-resolve active run for new env
      touchTestPlan(plan);
      renderTestList(plan);
      renderActiveTest(plan);
    });

    // Filters
    $("#test-search").value = state.testFilter;
    $("#status-filter").value = state.statusFilter;
    $("#test-search").addEventListener("input", (e) => {
      state.testFilter = e.target.value;
      renderTestList(plan);
    });
    $("#status-filter").addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      renderTestList(plan);
    });

    renderTestList(plan);
    renderActiveTest(plan);
  }

  function renderTestList(plan) {
    const list = $("#test-list");
    list.replaceChildren();
    const env = plan.activeEnvironment;
    const filter = state.testFilter.trim().toLowerCase();
    const status = state.statusFilter;
    const filtered = plan.tests.filter((t) => {
      if (filter) {
        const hay = `${t.number} ${t.name}`.toLowerCase();
        if (!hay.includes(filter)) return false;
      }
      if (status !== "all" && statusFor(t, env) !== status) return false;
      return true;
    });
    $("#test-count").textContent = `${filtered.length} of ${plan.tests.length}`;

    if (plan.tests.length === 0) {
      const empty = document.createElement("div");
      empty.className = "guide-empty";
      empty.style.fontSize = "13px";
      empty.style.padding = "18px";
      empty.textContent = "Import a CSV or add a test to begin.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach((t) => {
      const li = document.createElement("li");
      const s = statusFor(t, env);
      li.className = "step-item test-item" + (t.id === state.activeTestId ? " active" : "");
      li.innerHTML = `
        <span class="status-dot status-${s}" title="${STATUS_LABELS[s]}"></span>
        <span class="test-num-tag"></span>
        <span class="step-name"></span>
      `;
      li.querySelector(".test-num-tag").textContent = t.number || "—";
      li.querySelector(".step-name").textContent = t.name || "Untitled test";
      li.addEventListener("click", () => {
        state.activeTestId = t.id;
        state.activeRunId = null;
        renderTestList(plan);
        renderActiveTest(plan);
      });
      list.appendChild(li);
    });
  }

  function renderActiveTest(plan) {
    const main = $("#testplan-main");
    main.replaceChildren();
    const test = getTest(plan, state.activeTestId);
    if (!test) {
      const placeholder = document.createElement("p");
      placeholder.style.color = "var(--muted)";
      placeholder.style.margin = "auto";
      placeholder.textContent = "Select a test on the left or import a CSV to begin.";
      main.appendChild(placeholder);
      return;
    }

    main.appendChild(tpl("tpl-test-detail"));
    main.querySelector(".test-num").textContent = test.number || "—";
    const nameEl = main.querySelector('[data-bind="test-name"]');
    nameEl.value = test.name;
    nameEl.addEventListener("input", (e) => {
      test.name = e.target.value;
      touchTestPlan(plan);
      const item = $(`#test-list .test-item.active .step-name`);
      if (item) item.textContent = test.name || "Untitled test";
    });

    // Meta grid (precondition, expected, priority)
    const grid = main.querySelector(".test-meta-grid");
    const fields = [
      ["Precondition", "precondition"],
      ["Expected", "expected"],
      ["Priority", "priority"],
    ];
    fields.forEach(([label, key]) => {
      const cell = document.createElement("label");
      cell.className = "field";
      cell.innerHTML = `<span>${label}</span><textarea class="meta-input" rows="1"></textarea>`;
      const ta = cell.querySelector("textarea");
      ta.value = test[key] || "";
      ta.addEventListener("input", (e) => {
        test[key] = e.target.value;
        touchTestPlan(plan);
      });
      grid.appendChild(cell);
    });

    // Resolve active run for current env
    const env = plan.activeEnvironment;
    let run = state.activeRunId ? getRun(test, state.activeRunId) : null;
    if (!run) {
      run = latestRunForEnv(test, env);
    }
    state.activeRunId = run ? run.id : null;

    if (!run) {
      // Show "Start run" CTA in the run card area
      const card = main.querySelector("#run-card");
      card.innerHTML = `
        <div class="run-empty">
          <p>No run yet for <strong>${escapeHtml(env)}</strong>.</p>
          <button class="btn btn-primary" data-action="start-run">Start run on ${escapeHtml(env)}</button>
        </div>
      `;
    } else {
      renderActiveRun(plan, test, run);
    }

    renderPastRuns(plan, test);
  }

  function renderActiveRun(plan, test, run) {
    const card = $("#run-card");
    // Header info
    const env = card.querySelector(".run-env-badge");
    env.textContent = run.environment;
    env.className = `run-env-badge env-${run.environment}`;
    const when = card.querySelector(".run-when");
    const finished = run.finishedAt ? formatDateTime(run.finishedAt) : "in progress";
    when.textContent = `started ${formatDateTime(run.startedAt)} · ${finished}`;

    // Status buttons
    card.querySelectorAll(".status-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.status === run.status);
      btn.addEventListener("click", () => {
        run.status = btn.dataset.status;
        if (run.status === "Pass" || run.status === "Fail" || run.status === "Blocked") {
          run.finishedAt = Date.now();
        }
        if (!run.tester) run.tester = plan.tester || state.settings.tester || "";
        touchTestPlan(plan);
        renderActiveRun(plan, test, run);
        renderTestList(plan);
      });
    });

    // Notes
    const notes = card.querySelector('[data-bind="run-notes"]');
    notes.value = run.notes;
    notes.addEventListener("input", (e) => {
      run.notes = e.target.value;
      touchTestPlan(plan);
    });

    // Steps
    renderRunSteps(plan, test, run);
  }

  function renderRunSteps(plan, test, run) {
    const wrap = $("#run-steps");
    wrap.replaceChildren();
    if (run.steps.length === 0) {
      const empty = document.createElement("div");
      empty.className = "run-step-empty";
      empty.textContent = "No steps yet. Use Capture or + Add step to attach evidence.";
      wrap.appendChild(empty);
      return;
    }
    run.steps.forEach((step, i) => {
      const node = tpl("tpl-run-step");
      const root = node.querySelector(".run-step");
      root.dataset.stepId = step.id;
      root.querySelector(".run-step-num").textContent = String(i + 1).padStart(2, "0");

      const title = root.querySelector('[data-bind="step-title"]');
      const instr = root.querySelector('[data-bind="step-instruction"]');
      title.value = step.title;
      instr.value = step.instruction;
      title.addEventListener("input", (e) => { step.title = e.target.value; touchTestPlan(plan); });
      instr.addEventListener("input", (e) => { step.instruction = e.target.value; touchTestPlan(plan); });

      // Tools
      const toolButtons = root.querySelectorAll(".tool-btn");
      toolButtons.forEach((b) => {
        b.classList.toggle("active",
          state.activeRunStepId === step.id && b.dataset.tool === state.annotationTool);
        b.addEventListener("click", () => {
          state.activeRunStepId = step.id;
          state.annotationTool = b.dataset.tool;
          renderRunSteps(plan, test, run);
        });
      });

      // Image
      const img = root.querySelector(".run-canvas-img");
      const overlay = root.querySelector(".run-overlay");
      const canvas = root.querySelector(".run-canvas");
      const hint = root.querySelector(".canvas-hint");
      hint.textContent = step.image
        ? toolHint(state.activeRunStepId === step.id ? state.annotationTool : "hotspot")
        : "";

      if (step.image) {
        const place = () => paintAnnotations(canvas, img, overlay, step);
        img.addEventListener("load", place);
        img.src = step.image;
        if (img.complete && img.naturalWidth) place();

        canvas.addEventListener("mousedown", (e) => {
          state.activeRunStepId = step.id;
          startAnnotationGesture(e, plan, test, run, step, canvas, img, overlay);
        });
      } else {
        const upload = document.createElement("button");
        upload.className = "btn btn-ghost btn-sm";
        upload.textContent = "Upload screenshot";
        upload.addEventListener("click", () => triggerRunStepUpload(plan, test, run, step));
        canvas.appendChild(upload);
      }

      // Action buttons
      root.querySelectorAll("[data-action]").forEach((b) => {
        b.addEventListener("click", () => {
          const act = b.dataset.action;
          if (act === "step-up") moveRunStep(plan, run, i, -1);
          else if (act === "step-down") moveRunStep(plan, run, i, 1);
          else if (act === "step-replace") triggerRunStepUpload(plan, test, run, step);
          else if (act === "step-delete") deleteRunStep(plan, test, run, step.id);
        });
      });

      wrap.appendChild(node);
    });
  }

  function toolHint(tool) {
    if (tool === "hotspot") return "Click to place a click hotspot.";
    if (tool === "box") return "Drag to draw a box around the area of interest.";
    if (tool === "label") return "Click to drop a label.";
    return "";
  }

  function renderPastRuns(plan, test) {
    const wrap = $("#past-runs-list");
    wrap.replaceChildren();
    const others = test.runs.filter((r) => r.id !== state.activeRunId)
      .sort((a, b) => b.startedAt - a.startedAt);
    if (others.length === 0) {
      wrap.innerHTML = `<p class="muted-count">No previous runs.</p>`;
      return;
    }
    others.forEach((r) => {
      const row = document.createElement("div");
      row.className = "past-run-row";
      row.innerHTML = `
        <span class="run-env-badge env-${r.environment}"></span>
        <span class="status-pill status-${r.status}"></span>
        <span class="muted-count"></span>
        <span class="muted-count"></span>
        <span class="past-actions">
          <button class="btn btn-ghost btn-sm" data-act="open">Open</button>
          <button class="icon-btn" data-act="del" title="Delete run">&times;</button>
        </span>
      `;
      row.querySelector(".run-env-badge").textContent = r.environment;
      row.querySelector(".status-pill").textContent = STATUS_LABELS[r.status];
      row.querySelectorAll(".muted-count")[0].textContent = formatDateTime(r.startedAt);
      row.querySelectorAll(".muted-count")[1].textContent = r.tester || "—";
      row.querySelector('[data-act="open"]').addEventListener("click", () => {
        state.activeRunId = r.id;
        renderActiveTest(plan);
      });
      row.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (!confirm("Delete this run? Evidence will be lost.")) return;
        const idx = test.runs.findIndex((x) => x.id === r.id);
        test.runs.splice(idx, 1);
        touchTestPlan(plan);
        renderActiveTest(plan);
        renderTestList(plan);
      });
      wrap.appendChild(row);
    });
  }

  // ---------- Run actions ----------
  function startRun(plan, test) {
    const run = createRun(plan.activeEnvironment, plan.tester || state.settings.tester);
    test.runs.push(run);
    state.activeRunId = run.id;
    touchTestPlan(plan);
    renderActiveTest(plan);
    renderTestList(plan);
  }

  function newRun(plan, test) {
    startRun(plan, test);
    toast("Started new run on " + plan.activeEnvironment);
  }

  function addRunStep(plan, test, run) {
    const s = createRunStep();
    run.steps.push(s);
    state.activeRunStepId = s.id;
    touchTestPlan(plan);
    renderRunSteps(plan, test, run);
    triggerRunStepUpload(plan, test, run, s);
  }

  function deleteRunStep(plan, test, run, stepId) {
    if (!confirm("Delete this step?")) return;
    run.steps = run.steps.filter((s) => s.id !== stepId);
    touchTestPlan(plan);
    renderRunSteps(plan, test, run);
  }

  function moveRunStep(plan, run, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= run.steps.length) return;
    const [s] = run.steps.splice(index, 1);
    run.steps.splice(target, 0, s);
    touchTestPlan(plan);
    const test = getTest(plan, state.activeTestId);
    renderRunSteps(plan, test, run);
  }

  function triggerRunStepUpload(plan, test, run, step) {
    pendingUpload = {
      kind: "run",
      planId: plan.id,
      testId: test.id,
      runId: run.id,
      stepId: step.id,
    };
    $("#screenshot-input").click();
  }

  function deleteTestPlan() {
    const plan = getTestPlan(state.activeTestPlanId);
    if (!plan) return;
    if (!confirm(`Delete "${plan.title || "this test plan"}"? This cannot be undone.`)) return;
    state.testplans = state.testplans.filter((p) => p.id !== plan.id);
    saveTestPlans();
    goHome();
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
      if (!data || typeof data !== "object") throw new Error("Invalid file");

      if (data.kind === "testplan" && Array.isArray(data.tests)) {
        data.id = uid();
        data.tests = data.tests.map((t) => ({
          ...createTest(),
          ...t,
          id: uid(),
          runs: (t.runs || []).map((r) => ({
            ...createRun(r.environment || "DEV", r.tester || ""),
            ...r,
            id: uid(),
            steps: (r.steps || []).map((s) => ({ ...createRunStep(), ...s, id: uid() })),
          })),
        }));
        data.createdAt = data.createdAt || Date.now();
        data.updatedAt = Date.now();
        if (!Array.isArray(data.environments) || !data.environments.length) {
          data.environments = [...DEFAULT_ENVS];
        }
        state.testplans.push(data);
        saveTestPlans();
        toast("Imported test plan.");
        openTestPlan(data.id);
        return;
      }

      if (Array.isArray(data.steps)) {
        data.id = uid();
        data.steps = data.steps.map((s) => ({ ...createStep(), ...s, id: uid() }));
        data.createdAt = data.createdAt || Date.now();
        data.updatedAt = Date.now();
        state.guides.push(data);
        save();
        toast("Imported guide.");
        openEditor(data.id);
        return;
      }

      throw new Error("Unrecognised file format");
    } catch (e) {
      console.error(e);
      toast("Couldn't import: " + e.message);
    }
  }

  // ---------- Screenshot upload ----------
  let pendingUpload = null; // { guideId, stepId }

  function triggerScreenshotUpload(guide, step) {
    pendingUpload = { kind: "guide", guideId: guide.id, stepId: step.id };
    $("#screenshot-input").click();
  }

  function handleScreenshotFile(file, guide, step) {
    if (!file.type.startsWith("image/")) {
      toast("Please select an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      step.image = await compressScreenshot(reader.result);
      step.hotspot = null;
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

  // Downsize + recompress to keep localStorage usage manageable. PNG screenshots
  // can be 5-10MB each; this typically gets them under 300KB.
  async function compressScreenshot(dataUrl, opts = {}) {
    const { maxDim = 1600, quality = 0.85, type = "image/jpeg" } = opts;
    if (!dataUrl) return dataUrl;
    try {
      const img = await loadImage(dataUrl);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return dataUrl;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const targetW = Math.round(w * scale);
      const targetH = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetW, targetH);
      return canvas.toDataURL(type, quality);
    } catch (e) {
      console.warn("Screenshot compression failed, using original", e);
      return dataUrl;
    }
  }

  // ---------- Document export (PDF + Word) ----------
  // Burn the hotspot and annotations directly onto a copy of the screenshot so
  // they survive in any output format (print, .doc, etc.).
  async function composeStepImage(step) {
    if (!step.image) return null;
    const img = await loadImage(step.image);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (step.hotspot) drawHotspot(ctx, canvas, step.hotspot);
    (step.annotations || []).forEach((a) => drawAnnotation(ctx, canvas, a));
    return canvas.toDataURL("image/png");
  }

  function drawHotspot(ctx, canvas, hotspot) {
    const x = hotspot.x * canvas.width;
    const y = hotspot.y * canvas.height;
    const r = Math.max(10, Math.min(canvas.width, canvas.height) * 0.018);
    ctx.fillStyle = "rgba(79, 140, 255, 0.20)";
    ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(79, 140, 255, 0.95)";
    ctx.lineWidth = Math.max(2, r * 0.35);
    ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#4f8cff";
    ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
  }

  function drawAnnotation(ctx, canvas, ann) {
    const W = canvas.width, H = canvas.height;
    if (ann.type === "box") {
      const x = ann.x * W, y = ann.y * H, w = ann.w * W, h = ann.h * H;
      ctx.strokeStyle = "rgba(226, 85, 75, 0.95)";
      ctx.lineWidth = Math.max(3, Math.min(W, H) * 0.004);
      ctx.strokeRect(x, y, w, h);
    } else if (ann.type === "label") {
      const x = ann.x * W, y = ann.y * H;
      const fontPx = Math.max(14, Math.min(W, H) * 0.022);
      ctx.font = `600 ${fontPx}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      const padX = fontPx * 0.5, padY = fontPx * 0.3;
      const metrics = ctx.measureText(ann.text);
      const tw = metrics.width + padX * 2;
      const th = fontPx + padY * 2;
      ctx.fillStyle = "rgba(226, 85, 75, 0.95)";
      const rectX = x, rectY = y;
      ctx.fillRect(rectX, rectY, tw, th);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "top";
      ctx.fillText(ann.text, rectX + padX, rectY + padY);
    }
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

  // ---------- Evidence pack export ----------
  async function buildTestEvidenceHtml(plan, test) {
    const runs = [...test.runs].sort((a, b) => b.startedAt - a.startedAt);
    const composedRuns = await Promise.all(runs.map(async (r) => ({
      run: r,
      composed: await Promise.all(r.steps.map(composeStepImage)),
    })));
    const runsHtml = composedRuns.map(({ run, composed }) => {
      const stepsHtml = run.steps.map((s, i) => {
        const num = String(i + 1).padStart(2, "0");
        const title = escapeHtml(s.title || `Step ${i + 1}`);
        const instr = s.instruction ? `<p class="instr">${escapeHtml(s.instruction)}</p>` : "";
        const imgTag = composed[i]
          ? `<img src="${composed[i]}" alt="" />`
          : `<div class="no-img">No screenshot</div>`;
        return `
          <section class="step">
            <h3><span class="num">${num}</span>${title}</h3>
            ${imgTag}
            ${instr}
          </section>`;
      }).join("");
      return `
        <section class="run">
          <h2>${escapeHtml(run.environment)} — ${escapeHtml(STATUS_LABELS[run.status] || run.status)}</h2>
          <table class="run-meta">
            <tr><th>Tester</th><td>${escapeHtml(run.tester || "—")}</td></tr>
            <tr><th>Started</th><td>${escapeHtml(formatDateTime(run.startedAt))}</td></tr>
            <tr><th>Finished</th><td>${escapeHtml(run.finishedAt ? formatDateTime(run.finishedAt) : "—")}</td></tr>
            ${run.notes ? `<tr><th>Notes</th><td>${escapeHtml(run.notes)}</td></tr>` : ""}
          </table>
          ${stepsHtml || `<p class="muted">No steps captured.</p>`}
        </section>`;
    }).join("");

    const css = `
      body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
             color: #1a1a1a; margin: 32px; line-height: 1.5; }
      h1 { font-size: 26px; margin: 0 0 4px; }
      h2 { font-size: 18px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e0e3ea; }
      h3 { font-size: 15px; margin: 16px 0 8px; }
      .num { color: #4f8cff; font-weight: 700; margin-right: 8px; }
      .cover { background: #f4f6fa; border: 1px solid #e0e3ea; border-radius: 6px;
               padding: 18px 22px; margin-bottom: 28px; }
      .cover-title { font-size: 22px; margin: 0 0 6px; }
      .cover-sub { color: #555; margin: 0 0 16px; }
      .cover table, .run-meta { width: 100%; border-collapse: collapse; font-size: 13px; }
      .cover th, .run-meta th { text-align: left; padding: 4px 12px 4px 0; color: #666;
                                font-weight: 500; width: 130px; vertical-align: top; }
      .cover td, .run-meta td { padding: 4px 0; }
      .step img { display: block; max-width: 100%; height: auto; border: 1px solid #ddd;
                  border-radius: 4px; }
      .no-img { padding: 30px; background: #f4f5f7; color: #888; text-align: center;
                border-radius: 4px; }
      .instr { margin: 10px 0 0; white-space: pre-wrap; }
      .muted { color: #888; }
      .step { margin: 0 0 18px; page-break-inside: avoid; }
      .run { margin-bottom: 36px; }
      @page { margin: 18mm; }
      @media print { body { margin: 0; } .run { page-break-before: always; } .run:first-of-type { page-break-before: auto; } }`;

    return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(test.number ? test.number + " — " : "")}${escapeHtml(test.name || "Test")}</title>
<style>${css}</style>
</head>
<body>
<div class="cover">
  <h1 class="cover-title">${escapeHtml(test.number || "—")} · ${escapeHtml(test.name || "Untitled test")}</h1>
  <p class="cover-sub">${escapeHtml(plan.title || "Test plan")}</p>
  <table>
    <tr><th>Tester</th><td>${escapeHtml(plan.tester || "—")}</td></tr>
    <tr><th>Generated</th><td>${escapeHtml(formatDateTime(Date.now()))}</td></tr>
    ${test.precondition ? `<tr><th>Precondition</th><td>${escapeHtml(test.precondition)}</td></tr>` : ""}
    ${test.expected ? `<tr><th>Expected</th><td>${escapeHtml(test.expected)}</td></tr>` : ""}
    ${test.priority ? `<tr><th>Priority</th><td>${escapeHtml(test.priority)}</td></tr>` : ""}
    <tr><th>Runs</th><td>${runs.length}</td></tr>
  </table>
</div>
${runsHtml || `<p class="muted">No runs recorded yet.</p>`}
</body></html>`;
  }

  async function buildPlanSummaryHtml(plan) {
    const env = plan.activeEnvironment;
    const counts = STATUSES.reduce((a, s) => ((a[s] = 0), a), {});
    plan.tests.forEach((t) => { counts[statusFor(t, env)]++; });
    const rowsHtml = plan.tests.map((t) => {
      const s = statusFor(t, env);
      const r = latestRunForEnv(t, env);
      return `
        <tr>
          <td>${escapeHtml(t.number || "—")}</td>
          <td>${escapeHtml(t.name || "")}</td>
          <td>${escapeHtml(STATUS_LABELS[s] || s)}</td>
          <td>${escapeHtml(r ? formatDateTime(r.startedAt) : "—")}</td>
          <td>${escapeHtml(r ? (r.tester || "—") : "—")}</td>
          <td>${escapeHtml(r ? (r.notes || "") : "")}</td>
        </tr>`;
    }).join("");
    const css = `
      body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a;
             margin: 32px; line-height: 1.4; }
      h1 { font-size: 24px; margin: 0 0 6px; }
      .sub { color: #555; margin: 0 0 18px; }
      .pills span { display: inline-block; padding: 3px 10px; border-radius: 999px;
                    font-size: 12px; margin-right: 6px; }
      .pill-Pass { background: #def4e2; color: #1a6c2c; }
      .pill-Fail { background: #fbe1de; color: #91261d; }
      .pill-Blocked { background: #fff0d0; color: #80560a; }
      .pill-NotRun { background: #e9ecf2; color: #555; }
      table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e0e3ea;
               vertical-align: top; }
      th { background: #f4f6fa; }
      @page { margin: 14mm; }`;
    return `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(plan.title || "Test plan")}</title>
<style>${css}</style></head><body>
<h1>${escapeHtml(plan.title || "Test plan")}</h1>
<p class="sub">Environment: <strong>${escapeHtml(env)}</strong> · Tester: ${escapeHtml(plan.tester || "—")} · Generated ${escapeHtml(formatDateTime(Date.now()))}</p>
<div class="pills">
  <span class="pill-Pass">${counts.Pass} Pass</span>
  <span class="pill-Fail">${counts.Fail} Fail</span>
  <span class="pill-Blocked">${counts.Blocked} Blocked</span>
  <span class="pill-NotRun">${counts.NotRun} Not Run</span>
</div>
<table>
  <thead><tr><th>#</th><th>Name</th><th>Status</th><th>Last run</th><th>Tester</th><th>Notes</th></tr></thead>
  <tbody>${rowsHtml || `<tr><td colspan="6">No tests yet.</td></tr>`}</tbody>
</table>
</body></html>`;
  }

  function printHtmlToPdf(html, label = "Preparing PDF...") {
    toast(label);
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);
    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
      catch (e) { console.error(e); toast("Print failed."); }
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
      setTimeout(doPrint, 4000);
    };
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
  }

  function downloadHtmlAsWord(html, filename) {
    const blob = new Blob(["﻿", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportTestEvidence(format) {
    const plan = getTestPlan(state.activeTestPlanId);
    const test = plan && getTest(plan, state.activeTestId);
    if (!plan || !test) return;
    try {
      const html = await buildTestEvidenceHtml(plan, test);
      const base = `${safeFilename(test.number || "test")}-${safeFilename(test.name || "evidence")}`;
      if (format === "pdf") printHtmlToPdf(html, "Preparing evidence PDF...");
      else downloadHtmlAsWord(html, `${base}.doc`);
    } catch (e) {
      console.error(e);
      toast("Couldn't build evidence: " + e.message);
    }
  }

  async function exportPlanSummary(format) {
    const plan = getTestPlan(state.activeTestPlanId);
    if (!plan) return;
    try {
      const html = await buildPlanSummaryHtml(plan);
      const base = safeFilename(plan.title || "test-plan");
      if (format === "pdf") printHtmlToPdf(html, "Preparing plan PDF...");
      else if (format === "word") downloadHtmlAsWord(html, `${base}.doc`);
      else if (format === "json") {
        const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${base}.testplan.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      console.error(e);
      toast("Couldn't export plan: " + e.message);
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

  function startCapture(guide) {
    capture.contextKind = "guide";
    capture.context = { guideId: guide.id };
    startCaptureRaw(() => {
      const g = getGuide(capture.context.guideId);
      return { guide: g };
    });
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
    const kind = capture.contextKind;
    const ctx = capture.context;
    capture.contextKind = null;
    capture.context = null;
    capture.resolveTarget = null;
    capture.count = 0;
    if (kind === "guide" && ctx?.guideId) {
      openEditor(ctx.guideId);
    } else if (kind === "run" && ctx?.planId) {
      state.activeTestId = ctx.testId;
      state.activeRunId = ctx.runId;
      openTestPlan(ctx.planId, ctx.testId);
    }
  }

  async function captureFrame() {
    if (!capture.video) return;
    const w = capture.video.videoWidth;
    const h = capture.video.videoHeight;
    if (!w || !h) {
      toast("Stream not ready yet.");
      return;
    }
    const target = capture.resolveTarget && capture.resolveTarget();
    if (!target) return;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(capture.video, 0, 0);
    // Capture as PNG then immediately compress so quota usage stays low.
    const rawUrl = canvas.toDataURL("image/png");
    const dataUrl = await compressScreenshot(rawUrl);

    if (capture.contextKind === "run") {
      const { plan, test, run } = target;
      if (!plan || !test || !run) return;
      let step;
      const last = run.steps[run.steps.length - 1];
      if (last && !last.image && !last.title && !last.instruction) {
        step = last;
      } else {
        step = createRunStep();
        run.steps.push(step);
      }
      step.image = dataUrl;
      step.hotspot = null;
      step.annotations = [];
      capture.count++;
      touchTestPlan(plan);
    } else {
      const { guide } = target;
      if (!guide) return;
      let step;
      const last = guide.steps[guide.steps.length - 1];
      if (
        guide.steps.length === 1 && !last.image && !last.title && !last.instruction
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
    }
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

  function formatDateTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  // ---------- CSV parser ----------
  // Handles quoted fields, escaped quotes (""), CRLF, LF.
  function parseCsv(text) {
    const rows = [];
    let cur = [], field = "", inQuotes = false, i = 0;
    text = text.replace(/^﻿/, "");
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++;
      } else {
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ",") { cur.push(field); field = ""; i++; continue; }
        if (c === "\r") { i++; continue; }
        if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; i++; continue; }
        field += c; i++;
      }
    }
    if (field.length || cur.length) { cur.push(field); rows.push(cur); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim()));
  }

  function importCsv(plan) {
    pendingUpload = { kind: "csv", planId: plan.id };
    $("#csv-input").click();
  }

  async function handleCsvFile(file, plan) {
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) { toast("CSV looks empty."); return; }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (...candidates) => {
        for (const c of candidates) {
          const i = header.indexOf(c);
          if (i !== -1) return i;
        }
        return -1;
      };
      const numIdx = idx("number", "test number", "test #", "id", "test id");
      const nameIdx = idx("name", "test name", "title", "description");
      let dataStart = 1;
      // If header looks unrecognised, treat first row as data with cols 0,1
      let cn = numIdx, na = nameIdx;
      if (cn === -1 && na === -1) { cn = 0; na = 1; dataStart = 0; }
      const preIdx = idx("precondition", "pre-condition", "preconditions");
      const expIdx = idx("expected", "expected result", "expected_result");
      const priIdx = idx("priority", "severity");

      let added = 0;
      for (let r = dataStart; r < rows.length; r++) {
        const row = rows[r];
        const number = (cn !== -1 ? row[cn] : "")?.trim() || "";
        const name = (na !== -1 ? row[na] : "")?.trim() || "";
        if (!number && !name) continue;
        plan.tests.push(createTest({
          number,
          name,
          precondition: preIdx !== -1 ? (row[preIdx] || "").trim() : "",
          expected: expIdx !== -1 ? (row[expIdx] || "").trim() : "",
          priority: priIdx !== -1 ? (row[priIdx] || "").trim() : "",
        }));
        added++;
      }
      if (added === 0) { toast("No tests found in CSV."); return; }
      touchTestPlan(plan);
      if (!state.activeTestId && plan.tests.length) state.activeTestId = plan.tests[0].id;
      toast(`Imported ${added} test${added === 1 ? "" : "s"}.`);
      render();
    } catch (e) {
      console.error(e);
      toast("Couldn't parse CSV: " + e.message);
    }
  }

  // ---------- Annotations ----------
  function paintAnnotations(canvas, img, overlay, step) {
    overlay.replaceChildren();
    if (!step.image) return;
    const w = img.clientWidth, h = img.clientHeight;
    if (!w || !h) return;
    overlay.style.width = w + "px";
    overlay.style.height = h + "px";
    overlay.style.left = img.offsetLeft + "px";
    overlay.style.top = img.offsetTop + "px";

    if (step.hotspot) {
      const dot = document.createElement("div");
      dot.className = "ann-hotspot";
      dot.style.left = step.hotspot.x * w + "px";
      dot.style.top = step.hotspot.y * h + "px";
      overlay.appendChild(dot);
    }
    (step.annotations || []).forEach((a) => {
      if (a.type === "box") {
        const el = document.createElement("div");
        el.className = "ann-box";
        el.style.left = a.x * w + "px";
        el.style.top = a.y * h + "px";
        el.style.width = a.w * w + "px";
        el.style.height = a.h * h + "px";
        const del = document.createElement("button");
        del.className = "ann-del";
        del.textContent = "×";
        del.title = "Remove";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          removeAnnotation(step, a.id);
        });
        el.appendChild(del);
        overlay.appendChild(el);
      } else if (a.type === "label") {
        const el = document.createElement("div");
        el.className = "ann-label";
        el.style.left = a.x * w + "px";
        el.style.top = a.y * h + "px";
        el.textContent = a.text;
        const del = document.createElement("button");
        del.className = "ann-del";
        del.textContent = "×";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          removeAnnotation(step, a.id);
        });
        el.appendChild(del);
        overlay.appendChild(el);
      }
    });
  }

  function removeAnnotation(step, id) {
    step.annotations = (step.annotations || []).filter((a) => a.id !== id);
    if (step.hotspot && step.hotspot.id === id) step.hotspot = null;
    const plan = getTestPlan(state.activeTestPlanId);
    const test = plan && getTest(plan, state.activeTestId);
    const run = test && getRun(test, state.activeRunId);
    if (plan) {
      touchTestPlan(plan);
      renderRunSteps(plan, test, run);
    }
  }

  function startAnnotationGesture(e, plan, test, run, step, canvas, img, overlay) {
    if (!step.image || !img.clientWidth) return;
    const tool = state.activeRunStepId === step.id ? state.annotationTool : "hotspot";
    const rect = img.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const start = { x: (e.clientX - rect.left) / w, y: (e.clientY - rect.top) / h };
    if (start.x < 0 || start.x > 1 || start.y < 0 || start.y > 1) return;
    e.preventDefault();
    state.activeRunStepId = step.id;

    if (tool === "hotspot") {
      step.hotspot = { x: clamp01(start.x), y: clamp01(start.y) };
      touchTestPlan(plan);
      paintAnnotations(canvas, img, overlay, step);
      return;
    }
    if (tool === "label") {
      state.pendingLabel = { stepId: step.id, x: start.x, y: start.y };
      openLabelPrompt();
      return;
    }
    if (tool === "box") {
      // Start drag-to-draw
      const ann = {
        id: uid(), type: "box", x: start.x, y: start.y, w: 0, h: 0,
      };
      step.annotations = step.annotations || [];
      step.annotations.push(ann);
      const onMove = (mv) => {
        const r2 = img.getBoundingClientRect();
        const cx = clamp01((mv.clientX - r2.left) / r2.width);
        const cy = clamp01((mv.clientY - r2.top) / r2.height);
        ann.x = Math.min(start.x, cx);
        ann.y = Math.min(start.y, cy);
        ann.w = Math.abs(cx - start.x);
        ann.h = Math.abs(cy - start.y);
        paintAnnotations(canvas, img, overlay, step);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (ann.w < 0.005 || ann.h < 0.005) {
          step.annotations = step.annotations.filter((a) => a.id !== ann.id);
        }
        touchTestPlan(plan);
        paintAnnotations(canvas, img, overlay, step);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
  }

  // ---------- Modals ----------
  let modalEl = null;
  function openModal(templateId, fill) {
    closeModal();
    const fragment = tpl(templateId);
    document.body.appendChild(fragment);
    const all = document.body.querySelectorAll(".modal-backdrop");
    modalEl = all[all.length - 1];
    if (fill) fill(modalEl);
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
    setTimeout(() => {
      const focusable = modalEl && modalEl.querySelector("input, textarea");
      if (focusable) focusable.focus();
    }, 50);
  }
  function closeModal() {
    if (modalEl) { modalEl.remove(); modalEl = null; }
    state.pendingLabel = null;
  }

  function openSettings() {
    openModal("tpl-settings", (root) => {
      root.querySelector('[data-bind="settings-tester"]').value = state.settings.tester || "";
      root.querySelector('[data-bind="settings-envs"]').value =
        (state.settings.environments || []).join("\n");
    });
  }

  function saveSettingsFromModal() {
    if (!modalEl) return;
    state.settings.tester = modalEl.querySelector('[data-bind="settings-tester"]').value.trim();
    const envs = modalEl.querySelector('[data-bind="settings-envs"]').value
      .split("\n").map((s) => s.trim()).filter(Boolean);
    state.settings.environments = envs.length ? envs : [...DEFAULT_ENVS];
    saveSettings();
    closeModal();
    toast("Settings saved.");
  }

  function openEnvironments() {
    const plan = getTestPlan(state.activeTestPlanId);
    if (!plan) return;
    openModal("tpl-environments", (root) => {
      root.querySelector('[data-bind="plan-envs"]').value = plan.environments.join("\n");
    });
  }
  function savePlanEnvs() {
    if (!modalEl) return;
    const plan = getTestPlan(state.activeTestPlanId);
    if (!plan) return;
    const envs = modalEl.querySelector('[data-bind="plan-envs"]').value
      .split("\n").map((s) => s.trim()).filter(Boolean);
    plan.environments = envs.length ? envs : [...DEFAULT_ENVS];
    if (!plan.environments.includes(plan.activeEnvironment)) {
      plan.activeEnvironment = plan.environments[0];
    }
    touchTestPlan(plan);
    closeModal();
    render();
  }

  function openLabelPrompt() {
    openModal("tpl-label-prompt");
  }
  function saveLabel() {
    if (!modalEl || !state.pendingLabel) { closeModal(); return; }
    const text = modalEl.querySelector('[data-bind="label-text"]').value.trim();
    const { stepId, x, y } = state.pendingLabel;
    closeModal();
    if (!text) return;
    const plan = getTestPlan(state.activeTestPlanId);
    const test = plan && getTest(plan, state.activeTestId);
    const run = test && getRun(test, state.activeRunId);
    const step = run && getRunStep(run, stepId);
    if (!step) return;
    step.annotations = step.annotations || [];
    step.annotations.push({ id: uid(), type: "label", x, y, text });
    touchTestPlan(plan);
    renderRunSteps(plan, test, run);
  }

  // ---------- Generalized capture for runs ----------
  function startCaptureForRun(plan, test, run) {
    capture.contextKind = "run";
    capture.context = { planId: plan.id, testId: test.id, runId: run.id };
    startCaptureRaw(() => {
      const p = getTestPlan(capture.context.planId);
      const t = getTest(p, capture.context.testId);
      const r = getRun(t, capture.context.runId);
      return { plan: p, test: t, run: r };
    });
  }

  // Refactored capture: keep original startCapture for guides, add generalized stream start
  async function startCaptureRaw(resolveTarget) {
    if (capture.stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast("Capture mode needs a browser with screen-sharing support.");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always", frameRate: 15 }, audio: false,
      });
    } catch (e) {
      if (e.name !== "NotAllowedError") toast("Couldn't start capture: " + e.message);
      return;
    }
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    try { await video.play(); } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      toast("Couldn't start preview: " + e.message);
      return;
    }
    capture.stream = stream;
    capture.video = video;
    capture.count = 0;
    capture.resolveTarget = resolveTarget;
    stream.getVideoTracks()[0].addEventListener("ended", stopCapture);
    showCapturePanel();
    document.addEventListener("keydown", captureHotkey, true);
    toast("Capture started. Press F9 or click Capture.");
  }
  document.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;

    const guide = getGuide(state.activeGuideId);
    const step = guide && getStep(guide, state.activeStepId);

    const plan = getTestPlan(state.activeTestPlanId);
    const test = plan && getTest(plan, state.activeTestId);
    const run = test && getRun(test, state.activeRunId);

    switch (action) {
      case "go-home": goHome(); break;
      case "new-guide": newGuide(); break;
      case "new-testplan": newTestPlan(); break;
      case "new-menu": showNewMenu(e.target); break;
      case "import-guide": importGuide(); break;
      case "open-settings": openSettings(); break;
      case "save-settings": saveSettingsFromModal(); break;
      case "close-modal": closeModal(); break;
      case "save-label": saveLabel(); break;

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

      // Test plan
      case "import-csv": if (plan) importCsv(plan); break;
      case "add-test":
        if (plan) {
          const t = createTest({ number: `T-${String(plan.tests.length + 1).padStart(3, "0")}` });
          plan.tests.push(t);
          state.activeTestId = t.id;
          touchTestPlan(plan);
          render();
        }
        break;
      case "manage-environments": openEnvironments(); break;
      case "save-plan-envs": savePlanEnvs(); break;
      case "delete-testplan": deleteTestPlan(); break;
      case "start-run": if (plan && test) startRun(plan, test); break;
      case "new-run": if (plan && test) newRun(plan, test); break;
      case "run-add-step":
        if (plan && test && run) addRunStep(plan, test, run);
        else if (plan && test) { startRun(plan, test); }
        break;
      case "run-capture":
        if (plan && test && run) startCaptureForRun(plan, test, run);
        else if (plan && test) {
          startRun(plan, test);
          const r2 = getRun(getTest(plan, state.activeTestId), state.activeRunId);
          if (r2) startCaptureForRun(plan, test, r2);
        }
        break;
      case "export-test-pdf": exportTestEvidence("pdf"); break;
      case "export-test-word": exportTestEvidence("word"); break;
      case "export-plan-pdf": exportPlanSummary("pdf"); break;
      case "export-plan-word": exportPlanSummary("word"); break;
      case "export-plan-json": exportPlanSummary("json"); break;
    }
  });

  function showNewMenu() {
    closeModal();
    const node = document.createElement("div");
    node.className = "modal-backdrop";
    node.innerHTML = `
      <div class="modal modal-sm" role="menu">
        <header class="modal-header"><h2>Create</h2><button class="icon-btn" data-close>&times;</button></header>
        <div class="modal-body new-menu">
          <button class="btn btn-primary" data-id="guide">New guide</button>
          <button class="btn btn-primary" data-id="plan">New test plan</button>
        </div>
      </div>`;
    document.body.appendChild(node);
    modalEl = node;
    node.addEventListener("click", (e) => {
      if (e.target === node) closeModal();
    });
    node.querySelector('[data-close]').addEventListener("click", closeModal);
    node.querySelector('[data-id="guide"]').addEventListener("click", () => { closeModal(); newGuide(); });
    node.querySelector('[data-id="plan"]').addEventListener("click", () => { closeModal(); newTestPlan(); });
  }

  $("#screenshot-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingUpload) return;
    const u = pendingUpload;
    pendingUpload = null;
    if (u.kind === "run") {
      const plan = getTestPlan(u.planId);
      const test = getTest(plan, u.testId);
      const run = getRun(test, u.runId);
      const step = getRunStep(run, u.stepId);
      if (plan && step) handleRunScreenshotFile(file, plan, test, run, step);
    } else {
      const guide = getGuide(u.guideId);
      const step = guide && getStep(guide, u.stepId);
      if (guide && step) handleScreenshotFile(file, guide, step);
    }
  });

  function handleRunScreenshotFile(file, plan, test, run, step) {
    if (!file.type.startsWith("image/")) {
      toast("Please select an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      step.image = await compressScreenshot(reader.result);
      step.hotspot = null;
      step.annotations = [];
      touchTestPlan(plan);
      renderRunSteps(plan, test, run);
    };
    reader.onerror = () => toast("Failed to read the image.");
    reader.readAsDataURL(file);
  }

  $("#import-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleImportFile(file);
  });

  $("#csv-input").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pendingUpload || pendingUpload.kind !== "csv") return;
    const plan = getTestPlan(pendingUpload.planId);
    pendingUpload = null;
    if (plan) handleCsvFile(file, plan);
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
  probeStorage();
  if (!storage.available) {
    storage.warned = true;
    showStorageBanner(storage.reason);
  }
  state.guides = load();
  state.testplans = loadTestPlans();
  const savedSettings = loadSettings();
  if (savedSettings) state.settings = savedSettings;
  render();
})();
