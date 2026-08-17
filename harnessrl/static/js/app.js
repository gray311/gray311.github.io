(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const GITHUB_RESULTS = "https://github.com/gray311/SAH/blob/main/results/cp20_final/";

  const dom = {
    progress: $("#scrollProgress"),
    navToggle: $("#navToggle"),
    navLinks: $("#navLinks"),
    explorer: $("#explorer"),
    loading: $("#explorerLoading"),
    app: $("#explorerApp"),
    error: $("#explorerError"),
    campaignSelect: $("#campaignSelect"),
    prev: $("#prevRound"),
    next: $("#nextRound"),
    play: $("#playRounds"),
    chart: $("#curveChart"),
    chartWrap: $("#chartWrap"),
    tooltip: $("#chartTooltip"),
    curveTitle: $("#curveTitle"),
    curveLegend: $("#curveLegend"),
    slider: $("#roundSlider"),
    sliderEnd: $("#roundSliderEnd"),
    eventNote: $("#eventNote"),
    roundName: $("#roundName"),
    roundStatus: $("#roundStatus"),
    roundSource: $("#roundSource"),
    roundMetrics: $("#roundMetrics"),
    candidates: $("#candidateGrid"),
    inspector: $("#inspector"),
    inspectorLabel: $("#inspectorLabel"),
    inspectorTitle: $("#inspectorTitle"),
    candidateMeta: $("#candidateMeta"),
    stageTabs: $("#stageTabs"),
    artifactView: $("#artifactView"),
    artifactSource: $("#artifactSource"),
    artifactSearch: $("#artifactSearch"),
    artifactMatches: $("#artifactMatchCount"),
    copyArtifact: $("#copyArtifact"),
    toast: $("#toast"),
  };

  const state = {
    manifest: null,
    campaign: null,
    campaignId: null,
    roundIndex: 0,
    candidateK: 0,
    detail: null,
    activeArtifactId: null,
    detailCache: new Map(),
    requestSerial: 0,
    playTimer: null,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function score(value, digits = 6) {
    const number = finite(value);
    return number === null ? "—" : number.toFixed(digits);
  }

  function signed(value, digits = 6) {
    const number = finite(value);
    if (number === null) return "—";
    return `${number > 0 ? "+" : ""}${number.toFixed(digits)}`;
  }

  function integer(value) {
    const number = finite(value);
    return number === null ? "—" : Math.round(number).toLocaleString();
  }

  function compact(value, max = 28) {
    const text = String(value ?? "—").replaceAll("_", " ");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => dom.toast.classList.remove("visible"), 1800);
  }

  function setupPageChrome() {
    const updateProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      dom.progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
    };
    window.addEventListener("scroll", updateProgress, { passive: true });
    updateProgress();

    dom.navToggle.addEventListener("click", () => {
      const open = dom.navLinks.classList.toggle("open");
      dom.navToggle.setAttribute("aria-expanded", String(open));
    });
    $$("a", dom.navLinks).forEach((link) => link.addEventListener("click", () => {
      dom.navLinks.classList.remove("open");
      dom.navToggle.setAttribute("aria-expanded", "false");
    }));

    if ("IntersectionObserver" in window) {
      const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 });
      $$(".reveal").forEach((node) => revealObserver.observe(node));

      const navObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          $$("a", dom.navLinks).forEach((link) => {
            link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
          });
        });
      }, { rootMargin: "-35% 0px -55%", threshold: 0 });
      $$("main section[id]").forEach((section) => navObserver.observe(section));
    } else {
      $$(".reveal").forEach((node) => node.classList.add("visible"));
    }
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${path}`);
    return response.json();
  }

  function querySelection() {
    const query = new URLSearchParams(window.location.search);
    return {
      campaign: query.get("campaign"),
      round: finite(query.get("round")),
      candidate: finite(query.get("candidate")),
    };
  }

  function updateUrl() {
    if (!state.campaign) return;
    const url = new URL(window.location.href);
    url.searchParams.set("campaign", state.campaignId);
    url.searchParams.set("round", state.campaign.rounds[state.roundIndex].display_round);
    url.searchParams.set("candidate", state.candidateK);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams}${url.hash}`);
  }

  async function initExplorer() {
    try {
      state.manifest = await fetchJson("static/data/manifest.json");
      const requested = querySelection();
      const available = state.manifest.campaigns || [];
      if (!available.length) throw new Error("The manifest contains no campaigns.");

      available.forEach((campaign) => {
        const option = document.createElement("option");
        option.value = campaign.id;
        option.textContent = campaign.label;
        dom.campaignSelect.append(option);
      });

      const initialId = available.some((item) => item.id === requested.campaign)
        ? requested.campaign
        : state.manifest.default_campaign || available[0].id;
      await loadCampaign(initialId, requested);

      dom.loading.hidden = true;
      dom.app.hidden = false;
      dom.explorer.setAttribute("aria-busy", "false");
      bindExplorerEvents();
    } catch (error) {
      console.error(error);
      dom.loading.hidden = true;
      dom.error.hidden = false;
      dom.explorer.setAttribute("aria-busy", "false");
    }
  }

  async function loadCampaign(id, requested = {}) {
    const record = state.manifest.campaigns.find((item) => item.id === id);
    if (!record) throw new Error(`Unknown campaign: ${id}`);
    state.campaign = await fetchJson(`static/data/${record.data_path}`);
    state.requestSerial += 1;
    state.campaignId = id;
    state.detail = null;
    state.activeArtifactId = null;
    dom.campaignSelect.value = id;
    dom.curveTitle.textContent = `${state.campaign.short_label} evolution curve`;
    dom.slider.max = String(state.campaign.rounds.length - 1);
    dom.sliderEnd.textContent = `Round ${state.campaign.rounds.at(-1).display_round}`;

    const requestedIndex = requested.round === null || requested.round === undefined
      ? -1
      : state.campaign.rounds.findIndex((round) => round.display_round === requested.round);
    const strongestIndex = state.campaign.rounds.reduce((best, round, index, rounds) => {
      const current = finite(round.best_causal_delta) ?? -Infinity;
      const previous = finite(rounds[best].best_causal_delta) ?? -Infinity;
      return current > previous ? index : best;
    }, 0);
    state.roundIndex = requestedIndex >= 0 ? requestedIndex : strongestIndex;
    const round = state.campaign.rounds[state.roundIndex];
    const requestedCandidate = finite(requested.candidate);
    state.candidateK = requestedCandidate !== null && round.candidates.some((item) => item.k === requestedCandidate)
      ? requestedCandidate
      : preferredCandidate(round);
    renderCampaign();
    await loadSelectedCandidate();
  }

  function preferredCandidate(round) {
    const promoted = round.candidates.find((candidate) => candidate.promoted);
    const winner = round.candidates.find((candidate) => candidate.winner);
    const valid = round.candidates.find((candidate) => candidate.valid && candidate.detail_path);
    return (promoted || winner || valid || round.candidates[0]).k;
  }

  function renderCampaign() {
    renderLegend();
    renderChart();
    renderRoundSummary();
    updateUrl();
  }

  function renderLegend() {
    const refs = state.campaign.references || {};
    dom.curveLegend.innerHTML = [
      `<span><i></i>HarnessRL incumbent</span>`,
      `<span><i class="finch"></i>Finch-9B ${escapeHtml(score(refs.finch_9b))}</span>`,
      `<span><i class="sota"></i>published best ${escapeHtml(score(refs.published_sota))}</span>`,
    ].join("");
  }

  function renderChart() {
    const rounds = state.campaign.rounds;
    const refs = state.campaign.references || {};
    const values = rounds.map((round) => finite(round.score)).filter((value) => value !== null);
    [refs.seed, refs.finch_9b, refs.published_sota].forEach((value) => {
      const number = finite(value);
      if (number !== null) values.push(number);
    });
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const padding = Math.max((rawMax - rawMin) * 0.09, .015);
    const yMin = rawMin - padding;
    const yMax = rawMax + padding;
    const width = 1040;
    const height = 360;
    const margin = { top: 20, right: 35, bottom: 42, left: 64 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = (index) => margin.left + (rounds.length === 1 ? 0 : (index / (rounds.length - 1)) * plotWidth);
    const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

    dom.chart.replaceChildren();
    const defs = svg("defs");
    const gradient = svg("linearGradient", { id: "curveFill", x1: "0", y1: "0", x2: "0", y2: "1" });
    gradient.append(svg("stop", { offset: "0%", "stop-color": "#718df2", "stop-opacity": ".26" }));
    gradient.append(svg("stop", { offset: "100%", "stop-color": "#718df2", "stop-opacity": "0" }));
    defs.append(gradient);
    dom.chart.append(defs);

    for (let index = 0; index < 5; index += 1) {
      const value = yMax - ((yMax - yMin) * index) / 4;
      const py = y(value);
      dom.chart.append(svg("line", { x1: margin.left, y1: py, x2: width - margin.right, y2: py, class: "grid-line" }));
      const label = svg("text", { x: margin.left - 10, y: py + 3, "text-anchor": "end" });
      label.textContent = value.toFixed(3);
      dom.chart.append(label);
    }

    const shownTicks = new Set([0, rounds.length - 1]);
    rounds.forEach((_, index) => {
      if ((index + 1) % 5 === 0) shownTicks.add(index);
    });
    shownTicks.forEach((index) => {
      const label = svg("text", { x: x(index), y: height - 13, "text-anchor": "middle" });
      label.textContent = `R${rounds[index].display_round}`;
      dom.chart.append(label);
    });

    const references = [
      { key: "seed", label: "SEED", color: "#667287" },
      { key: "finch_9b", label: "FINCH-9B", color: "#e99345" },
      { key: "published_sota", label: "PUBLISHED BEST", color: "#8d98aa" },
    ];
    references.forEach((reference) => {
      const value = finite(refs[reference.key]);
      if (value === null) return;
      const py = y(value);
      dom.chart.append(svg("line", {
        x1: margin.left,
        y1: py,
        x2: width - margin.right,
        y2: py,
        class: "reference-line",
        stroke: reference.color,
      }));
      const label = svg("text", {
        x: width - margin.right - 4,
        y: py - 5,
        "text-anchor": "end",
        class: "reference-label",
        fill: reference.color,
      });
      label.textContent = `${reference.label} ${score(value)}`;
      dom.chart.append(label);
    });

    const graftIndex = rounds.findIndex((round) => round.is_graft);
    if (graftIndex >= 0) {
      const px = x(graftIndex);
      dom.chart.append(svg("line", { x1: px, y1: margin.top, x2: px, y2: height - margin.bottom, class: "graft-line" }));
      const label = svg("text", { x: px + 5, y: margin.top + 10, class: "graft-label" });
      label.textContent = "EXTERNAL SEED GRAFT";
      dom.chart.append(label);
    }

    const points = rounds.map((round, index) => [x(index), y(finite(round.score))]);
    const path = points.map(([px, py], index) => `${index ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
    const area = `${path} L${points.at(-1)[0]},${height - margin.bottom} L${points[0][0]},${height - margin.bottom} Z`;
    dom.chart.append(svg("path", { d: area, class: "curve-area" }));
    dom.chart.append(svg("path", { d: path, class: "curve-line" }));

    rounds.forEach((round, index) => {
      const [px, py] = points[index];
      if (index === state.roundIndex) {
        dom.chart.append(svg("circle", { cx: px, cy: py, r: 9, class: "selected-ring" }));
      }
      const point = svg("circle", {
        cx: px,
        cy: py,
        r: index === state.roundIndex ? 5.5 : 4,
        class: `curve-point${index === state.roundIndex ? " selected" : ""}`,
        tabindex: "0",
        role: "button",
        "aria-label": `Round ${round.display_round}, score ${score(round.score)}`,
      });
      const openRound = () => {
        stopPlaying(false);
        selectRound(index, true);
      };
      point.addEventListener("click", openRound);
      point.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openRound();
      });
      point.addEventListener("mouseenter", (event) => showChartTooltip(event, round));
      point.addEventListener("mousemove", (event) => positionChartTooltip(event));
      point.addEventListener("mouseleave", hideChartTooltip);
      dom.chart.append(point);
    });
  }

  function showChartTooltip(event, round) {
    const delta = finite(round.best_causal_delta);
    dom.tooltip.innerHTML = `<b>ROUND ${escapeHtml(String(round.display_round).padStart(2, "0"))}</b>${escapeHtml(score(round.score))}<br><span>best causal lift ${escapeHtml(signed(delta))}</span>`;
    dom.tooltip.classList.add("visible");
    positionChartTooltip(event);
  }

  function positionChartTooltip(event) {
    const box = dom.chartWrap.getBoundingClientRect();
    const tooltipWidth = dom.tooltip.offsetWidth || 150;
    const left = Math.min(event.clientX - box.left + 12, box.width - tooltipWidth - 4);
    dom.tooltip.style.left = `${Math.max(4, left)}px`;
    dom.tooltip.style.top = `${Math.max(4, event.clientY - box.top - 58)}px`;
  }

  function hideChartTooltip() {
    dom.tooltip.classList.remove("visible");
  }

  function renderRoundSummary(options = {}) {
    const { loadDetail = true } = options;
    const round = state.campaign.rounds[state.roundIndex];
    dom.slider.value = String(state.roundIndex);
    dom.prev.disabled = state.roundIndex === 0;
    dom.next.disabled = state.roundIndex === state.campaign.rounds.length - 1;
    dom.roundName.textContent = `Round ${String(round.display_round).padStart(2, "0")}`;
    dom.roundStatus.textContent = round.is_graft
      ? "externally seeded"
      : round.accepted_improvement
        ? "incumbent advanced"
        : "no ratchet";
    dom.roundSource.href = `${GITHUB_RESULTS}${round.source}`;
    renderEvent(round);
    renderMetrics(round);
    renderCandidates(round);
    if (!loadDetail) {
      state.detail = null;
      state.activeArtifactId = null;
      dom.inspectorLabel.textContent = `ROUND ${String(round.display_round).padStart(2, "0")} · AUTOPLAY`;
      dom.inspectorTitle.textContent = "Artifact loading paused";
      dom.candidateMeta.replaceChildren();
      dom.stageTabs.replaceChildren();
      dom.artifactView.innerHTML = '<div class="artifact-placeholder">Pause or select a candidate to load the full trajectory.</div>';
      dom.artifactSource.textContent = "summary-only playback";
      dom.artifactMatches.textContent = "";
    }
  }

  function renderEvent(round) {
    dom.eventNote.className = "event-note";
    let icon = "i";
    let heading = "Round boundary";
    let message = "The incumbent was retained; candidate evidence remains inspectable below.";
    if (round.is_graft) {
      dom.eventNote.classList.add("warning");
      icon = "!";
      heading = "External seed graft";
      message = round.graft_note || "This score jump imports an incumbent from a prior run and is not attributed to proposer learning.";
    } else if (round.accepted_improvement && round.training?.rejection) {
      dom.eventNote.classList.add("warning");
      icon = "±";
      heading = "Harness improved; proposer update rejected";
      const reason = typeof round.training.rejection === "string"
        ? round.training.rejection
        : round.training.rejection.reason || JSON.stringify(round.training.rejection);
      message = `Best causal lift ${signed(round.best_causal_delta)} advanced the incumbent, but the resulting proposer weights were not retained: ${reason}`;
    } else if (round.accepted_improvement) {
      dom.eventNote.classList.add("success");
      icon = "+";
      heading = "Verified incumbent update";
      message = `Candidate ${String(round.winner_k ?? "—").padStart(2, "0")} produced best causal lift ${signed(round.best_causal_delta)} and the validated program ratchet advanced.`;
    } else if (round.training && round.training.rejection) {
      dom.eventNote.classList.add("warning");
      icon = "×";
      heading = "Proposer update rejected";
      message = typeof round.training.rejection === "string"
        ? round.training.rejection
        : round.training.rejection.reason || JSON.stringify(round.training.rejection);
    }
    dom.eventNote.innerHTML = `<span class="event-icon">${escapeHtml(icon)}</span><div><b>${escapeHtml(heading)}.</b> ${escapeHtml(message)}</div>`;
    dom.eventNote.classList.add("visible");
  }

  function renderMetrics(round) {
    const training = round.training || {};
    const metrics = [
      ["incumbent", score(round.score), `base ${score(round.base_score)}`],
      ["batch best", score(round.batch_best), round.accepted_improvement ? "accepted" : "retained only"],
      ["best causal lift", signed(round.best_causal_delta), "candidate − paired control"],
      ["proposal gate", `${round.gate.valid}/8 valid`, `${round.gate.repaired} repaired · ${round.gate.invalid} invalid`],
      ["proposer update", compact(training.classification || (training.weights_updated ? "weights updated" : "not updated")), training.weights_updated ? "weights changed" : "weights unchanged"],
    ];
    dom.roundMetrics.innerHTML = metrics.map(([label, value, note]) => `
      <div class="round-metric">
        <span>${escapeHtml(label)}</span>
        <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </div>`).join("");
  }

  function renderCandidates(round) {
    dom.candidates.replaceChildren();
    round.candidates.forEach((candidate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "listitem");
      const delta = finite(candidate.causal_delta);
      const deltaClass = delta === null || delta === 0 ? "neutral" : delta > 0 ? "positive" : "negative";
      const classes = ["candidate-card"];
      if (candidate.k === state.candidateK) classes.push("selected");
      if (candidate.winner) classes.push("winner");
      if (!candidate.valid) classes.push("invalid");
      if (candidate.repaired) classes.push("repaired");
      button.className = classes.join(" ");
      const badges = [];
      if (candidate.promoted) badges.push('<span class="badge winner">promoted</span>');
      else if (candidate.winner) badges.push('<span class="badge winner">best</span>');
      if (candidate.repaired) badges.push('<span class="badge repaired">repair</span>');
      if (!candidate.valid) badges.push('<span class="badge invalid">invalid</span>');
      else if (delta !== null && delta > 0) badges.push('<span class="badge positive">lift</span>');
      const changes = candidate.changed_fields && candidate.changed_fields.length
        ? candidate.changed_fields.join(" · ")
        : "no attributable component change";
      button.innerHTML = `
        <span class="candidate-top">
          <span class="candidate-index">CAND ${String(candidate.k).padStart(2, "0")}</span>
          <span class="candidate-badges">${badges.join("")}</span>
        </span>
        <strong class="candidate-score">${escapeHtml(score(candidate.score))}</strong>
        <span class="candidate-delta ${deltaClass}">${escapeHtml(signed(delta))} vs control</span>
        <span class="candidate-change" title="${escapeHtml(changes)}">${escapeHtml(changes)}</span>`;
      button.addEventListener("click", () => {
        stopPlaying(false);
        state.candidateK = candidate.k;
        renderCandidates(round);
        updateUrl();
        loadSelectedCandidate();
      });
      dom.candidates.append(button);
    });
  }

  async function selectRound(index, loadDetail = true) {
    const bounded = Math.max(0, Math.min(index, state.campaign.rounds.length - 1));
    if (bounded === state.roundIndex && state.detail && loadDetail) return;
    state.requestSerial += 1;
    state.roundIndex = bounded;
    const round = state.campaign.rounds[bounded];
    state.candidateK = preferredCandidate(round);
    state.detail = null;
    state.activeArtifactId = null;
    renderChart();
    renderRoundSummary({ loadDetail });
    updateUrl();
    if (loadDetail) await loadSelectedCandidate();
  }

  async function loadSelectedCandidate() {
    const round = state.campaign.rounds[state.roundIndex];
    const candidate = round.candidates.find((item) => item.k === state.candidateK);
    const requestId = ++state.requestSerial;
    dom.artifactSearch.value = "";
    dom.inspectorLabel.textContent = `ROUND ${String(round.display_round).padStart(2, "0")} · CAND ${String(state.candidateK).padStart(2, "0")}`;
    dom.inspectorTitle.textContent = "Loading candidate evidence…";
    dom.candidateMeta.replaceChildren();
    dom.stageTabs.replaceChildren();
    dom.artifactView.innerHTML = '<div class="artifact-placeholder"><span class="loader"></span></div>';
    dom.artifactSource.textContent = candidate?.detail_path || "artifact unavailable";
    dom.artifactMatches.textContent = "";

    if (!candidate || !candidate.detail_path) {
      dom.inspectorTitle.textContent = "No exported artifact";
      dom.artifactView.innerHTML = '<div class="artifact-placeholder">This candidate did not materialize a detail bundle.</div>';
      return;
    }

    try {
      let detail = state.detailCache.get(candidate.detail_path);
      if (!detail) {
        detail = await fetchJson(`static/data/${candidate.detail_path}`);
        state.detailCache.set(candidate.detail_path, detail);
      }
      if (requestId !== state.requestSerial) return;
      state.detail = detail;
      const preferred = detail.artifacts.find((item) => item.id === "harness") || detail.artifacts[0];
      state.activeArtifactId = preferred?.id || null;
      renderInspector();
    } catch (error) {
      console.error(error);
      if (requestId !== state.requestSerial) return;
      dom.inspectorTitle.textContent = "Artifact load failed";
      dom.artifactView.innerHTML = `<div class="artifact-placeholder">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderInspector() {
    if (!state.detail) return;
    const candidate = state.detail.candidate;
    const active = state.detail.artifacts.find((item) => item.id === state.activeArtifactId) || state.detail.artifacts[0];
    if (active) state.activeArtifactId = active.id;
    dom.inspectorTitle.textContent = active?.label || "Candidate evidence";
    renderCandidateMeta(candidate, state.detail);
    renderTabs();
    renderActiveArtifact();
  }

  function renderCandidateMeta(candidate, detail) {
    const delta = finite(candidate.causal_delta);
    const lineage = detail.component_lineage || {};
    const lineageRows = Object.values(lineage).flatMap((items) => Array.isArray(items) ? items : []);
    const added = lineageRows.filter((item) => item && item.status === "added").length;
    const inherited = lineageRows.filter((item) => item && item.status === "inherited").length;
    const items = [
      ["score", score(candidate.score), "neutral"],
      ["control", score(candidate.control_score), "neutral"],
      ["causal lift", signed(delta), delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral"],
      ["advantage", signed(candidate.advantage), finite(candidate.advantage) > 0 ? "positive" : "neutral"],
      [candidate.change_type || "other", `${(candidate.changed_fields || []).length} fields`, "neutral"],
      [candidate.valid ? "valid" : "invalid", candidate.attribution_status || "attribution unknown", candidate.valid ? "success" : "negative"],
    ];
    if (candidate.repaired) items.push(["repaired", "frozen executor", "warning"]);
    if (lineageRows.length) items.push(["lineage", `${added} added · ${inherited} inherited`, added ? "positive" : "neutral"]);
    dom.candidateMeta.innerHTML = items.map(([label, value, type]) => `<span class="pill ${type}" title="${escapeHtml(value)}">${escapeHtml(label)} · ${escapeHtml(compact(value, 45))}</span>`).join("");
  }

  function renderTabs() {
    dom.stageTabs.replaceChildren();
    state.detail.artifacts.forEach((artifact, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `stage-tab${artifact.id === state.activeArtifactId ? " active" : ""}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(artifact.id === state.activeArtifactId));
      button.textContent = `${String(index + 1).padStart(2, "0")} ${artifact.label}`;
      button.addEventListener("click", () => {
        state.activeArtifactId = artifact.id;
        dom.artifactSearch.value = "";
        renderInspector();
      });
      dom.stageTabs.append(button);
    });
  }

  function artifactText(artifact) {
    if (!artifact) return "";
    return typeof artifact.content === "string"
      ? artifact.content
      : JSON.stringify(artifact.content, null, 2);
  }

  function contentText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content, null, 2);
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return String(part ?? "");
      if (typeof part.text === "string") return part.text;
      if (part.type === "tool_use") {
        return `${part.name || "tool"}(${JSON.stringify(part.input ?? part.raw_input ?? {}, null, 2)})`;
      }
      if (part.type === "tool_result") {
        return typeof part.content === "string" ? part.content : JSON.stringify(part.content, null, 2);
      }
      return JSON.stringify(part, null, 2);
    }).join("\n\n");
  }

  function countMatches(text, term) {
    if (!term) return 0;
    const haystack = text.toLocaleLowerCase();
    const needle = term.toLocaleLowerCase();
    let count = 0;
    let offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) !== -1) {
      count += 1;
      offset += Math.max(needle.length, 1);
    }
    return count;
  }

  function highlighted(text, term) {
    const raw = String(text ?? "");
    if (!term) return escapeHtml(raw);
    const lower = raw.toLocaleLowerCase();
    const needle = term.toLocaleLowerCase();
    const pieces = [];
    let cursor = 0;
    let index;
    while ((index = lower.indexOf(needle, cursor)) !== -1) {
      pieces.push(escapeHtml(raw.slice(cursor, index)));
      pieces.push(`<mark>${escapeHtml(raw.slice(index, index + needle.length))}</mark>`);
      cursor = index + needle.length;
    }
    pieces.push(escapeHtml(raw.slice(cursor)));
    return pieces.join("");
  }

  function renderActiveArtifact() {
    const artifact = state.detail?.artifacts.find((item) => item.id === state.activeArtifactId);
    if (!artifact) {
      dom.artifactView.innerHTML = '<div class="artifact-placeholder">No artifact selected.</div>';
      return;
    }
    const term = dom.artifactSearch.value.trim();
    if (artifact.format === "trajectory" && Array.isArray(artifact.content)) {
      const turns = artifact.content.map((turn, index) => {
        const role = String(turn?.role || "unknown").toLowerCase();
        const body = contentText(turn?.content);
        const identifier = turn?.id ? String(turn.id).slice(0, 8) : `turn ${index + 1}`;
        return `<article class="turn role-${escapeHtml(role)}">
          <div class="turn-head"><span>${escapeHtml(role)}</span><span>${escapeHtml(identifier)}</span></div>
          <pre class="turn-body">${highlighted(body, term)}</pre>
        </article>`;
      }).join("");
      dom.artifactView.innerHTML = `<div class="trajectory">${turns}</div>`;
    } else {
      dom.artifactView.innerHTML = `<pre class="code-block">${highlighted(artifactText(artifact), term)}</pre>`;
    }
    const matches = countMatches(artifactText(artifact), term);
    dom.artifactMatches.textContent = term ? `${matches} match${matches === 1 ? "" : "es"}` : "";
    dom.artifactSource.textContent = artifact.source;
    dom.inspectorTitle.textContent = artifact.label;
  }

  function togglePlaying() {
    if (state.playTimer) {
      stopPlaying(true);
      return;
    }
    if (state.roundIndex >= state.campaign.rounds.length - 1) {
      state.roundIndex = -1;
    }
    dom.play.classList.add("playing");
    $("span", dom.play).textContent = "Pause";
    state.playTimer = window.setInterval(async () => {
      const next = state.roundIndex + 1;
      if (next >= state.campaign.rounds.length) {
        stopPlaying(true);
        return;
      }
      await selectRound(next, false);
    }, 1250);
    selectRound(state.roundIndex + 1, false);
  }

  function stopPlaying(loadDetail) {
    if (state.playTimer) window.clearInterval(state.playTimer);
    state.playTimer = null;
    dom.play.classList.remove("playing");
    $("span", dom.play).textContent = "Play";
    if (loadDetail && state.campaign) loadSelectedCandidate();
  }

  function bindExplorerEvents() {
    dom.campaignSelect.addEventListener("change", async () => {
      stopPlaying(false);
      dom.explorer.setAttribute("aria-busy", "true");
      try {
        await loadCampaign(dom.campaignSelect.value, {});
      } finally {
        dom.explorer.setAttribute("aria-busy", "false");
      }
    });
    dom.prev.addEventListener("click", () => {
      stopPlaying(false);
      selectRound(state.roundIndex - 1, true);
    });
    dom.next.addEventListener("click", () => {
      stopPlaying(false);
      selectRound(state.roundIndex + 1, true);
    });
    dom.play.addEventListener("click", togglePlaying);
    dom.slider.addEventListener("input", () => {
      stopPlaying(false);
      selectRound(Number(dom.slider.value), true);
    });
    dom.artifactSearch.addEventListener("input", renderActiveArtifact);
    dom.copyArtifact.addEventListener("click", async () => {
      const artifact = state.detail?.artifacts.find((item) => item.id === state.activeArtifactId);
      if (!artifact) return;
      const text = artifactText(artifact);
      try {
        await navigator.clipboard.writeText(text);
        showToast("Artifact copied");
      } catch (_) {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        showToast("Artifact copied");
      }
    });
    window.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") {
        stopPlaying(false);
        selectRound(state.roundIndex - 1, true);
      } else if (event.key === "ArrowRight") {
        stopPlaying(false);
        selectRound(state.roundIndex + 1, true);
      }
    });
  }

  setupPageChrome();
  initExplorer();
})();
