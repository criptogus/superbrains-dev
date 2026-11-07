/* SuperBrains dashboard — auth, forecasts, billing. */
(function () {
  "use strict";

  const API = "/api";
  const LS = { session: "sb_session", email: "sb_email", plan: "sb_plan" };

  const $ = (id) => document.getElementById(id);
  const authView = $("authView"), appView = $("appView"), navCta = $("navCta");
  const authStatus = $("authStatus"), wsStatus = $("wsStatus"), saveStatus = $("saveStatus");

  const state = {
    session: localStorage.getItem(LS.session) || "",
    email: localStorage.getItem(LS.email) || "",
    plan: localStorage.getItem(LS.plan) || "free",
    lastForecast: null, // {values, forecast, quantiles, horizon, label}
  };

  function track(event, meta) {
    try {
      fetch(API + "/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, path: location.pathname, meta: meta || "" }),
      }).catch(() => {});
    } catch (e) { /* noop */ }
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (state.session) headers.Authorization = "Bearer " + state.session;
    const res = await fetch(API + path, { ...opts, headers });
    if (res.status === 401 && state.session) {
      logout(false);
      throw new Error("session expired");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || ("HTTP " + res.status));
    return body;
  }

  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "app__status" + (msg ? " " + (kind || "") : "");
  }

  /* ── auth ─────────────────────────────────────────────── */

  async function boot() {
    const params = new URLSearchParams(location.search);

    // magic-link landing: /app.html?token=...
    const token = params.get("token");
    if (token) {
      setStatus(authStatus, "Verifying your login link…", "is-loading");
      try {
        const data = await api("/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
        setSession(data.session, data.email, data.plan);
        track("login");
        history.replaceState(null, "", "/app.html");
        maybePendingPlan();
        return showApp();
      } catch (e) {
        setStatus(authStatus, e.message, "is-error");
        return;
      }
    }

    // billing return flags
    if (params.get("billing") === "success") {
      setStatus(authStatus, "Payment received — your plan is being activated. Refresh in a few seconds.", "is-ok");
      track("billing_success");
    } else if (params.get("billing") === "cancelled") {
      setStatus(authStatus, "Checkout cancelled — no charge was made.", "");
    }

    if (state.session) {
      try {
        const me = await api("/me");
        state.email = me.email; state.plan = me.plan || "free";
        persist();
        showApp();
        maybePendingPlan();
      } catch (e) {
        logout(false);
      }
    }
  }

  function setSession(session, email, plan) {
    state.session = session; state.email = email; state.plan = plan || "free";
    persist();
  }
  function persist() {
    localStorage.setItem(LS.session, state.session);
    localStorage.setItem(LS.email, state.email);
    localStorage.setItem(LS.plan, state.plan);
  }
  function logout(callApi = true) {
    if (callApi && state.session) {
      fetch(API + "/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + state.session } }).catch(() => {});
    }
    state.session = ""; state.email = ""; state.plan = "free";
    localStorage.removeItem(LS.session); localStorage.removeItem(LS.email); localStorage.removeItem(LS.plan);
    appView.hidden = true; authView.hidden = false;
    navCta.innerHTML = '<a href="index.html" class="btn btn--ghost">← Site</a>';
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("emailInput").value.trim();
    if (!email) return;
    $("loginBtn").disabled = true;
    setStatus(authStatus, "Sending login link…", "is-loading");
    try {
      const data = await api("/auth/request", { method: "POST", body: JSON.stringify({ email }) });
      track("login_requested");
      if (data.dev_link) {
        setStatus(authStatus, "Dev mode (no email provider configured):", "is-ok");
        const p = document.createElement("p");
        p.className = "app__devlink";
        p.innerHTML = '<a href="' + data.dev_link + '">' + data.dev_link + "</a>";
        authStatus.after(p);
        setTimeout(() => p.remove(), 60000);
      } else {
        setStatus(authStatus, "Check your inbox — the link expires in 15 minutes.", "is-ok");
      }
    } catch (err) {
      setStatus(authStatus, err.message, "is-error");
    } finally {
      $("loginBtn").disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", () => logout(true));

  function showApp() {
    authView.hidden = true; appView.hidden = false;
    $("userLine").textContent = state.email;
    const badge = $("planBadge");
    badge.textContent = state.plan;
    badge.classList.toggle("is-paid", state.plan !== "free");
    $("billingBtn").hidden = state.plan === "free";
    $("upgradeBtn").textContent = state.plan === "free" ? "Upgrade" : "Change plan";
    navCta.innerHTML = '<span style="font-size:.85rem;color:var(--ink-soft)">' + state.email + "</span>";
    loadSaved();
  }

  /* ── billing ──────────────────────────────────────────── */

  const PENDING_PLAN_KEY = "sb_pending_plan";
  function maybePendingPlan() {
    const plan = sessionStorage.getItem(PENDING_PLAN_KEY);
    if (plan && state.session) {
      sessionStorage.removeItem(PENDING_PLAN_KEY);
      checkout(plan);
    }
  }

  async function checkout(plan) {
    try {
      const data = await api("/billing/checkout", { method: "POST", body: JSON.stringify({ plan }) });
      track("checkout_started", plan);
      location.href = data.url;
    } catch (e) {
      alert("Billing isn't available yet: " + e.message);
    }
  }

  $("upgradeBtn").addEventListener("click", () => {
    if (state.plan === "free") {
      // simple chooser: Growth is the default push
      const plan = confirm("Upgrade to Growth ($29/mo — unlimited forecasts, 90-day horizon)?\n\nOK = Growth · Cancel = stay") ? "growth" : "scale";
      checkout(plan);
    } else {
      portal();
    }
  });
  $("billingBtn").addEventListener("click", portal);

  async function portal() {
    try {
      const data = await api("/billing/portal", { method: "POST", body: "{}" });
      location.href = data.url;
    } catch (e) {
      alert(e.message);
    }
  }

  /* ── table parsing (same logic as landing demo) ──────── */

  function looksLikeDate(v) {
    if (v == null || v === "") return false;
    const s = String(v).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return !isNaN(Date.parse(s.length === 10 ? s + "T00:00:00Z" : s));
    const t = Date.parse(s);
    return !isNaN(t) && /[a-zA-Z]{3,}|\//.test(s) && s.length > 5;
  }

  function rowsToSeries(rows) {
    rows = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
    if (rows.length < 3) throw new Error("File needs at least a header + a few rows");
    const header = rows[0].map((c) => String(c).trim().toLowerCase());
    const body = rows.slice(1);
    const ncols = Math.max(...body.map((r) => r.length));
    let dateCol = -1, numCol = -1;
    for (let c = 0; c < ncols; c++) {
      const vals = body.map((r) => r[c]).filter((v) => v !== undefined && String(v).trim() !== "");
      if (!vals.length) continue;
      const dateHits = vals.filter(looksLikeDate).length / vals.length;
      const numHits = vals.filter((v) => v !== "" && !isNaN(parseFloat(String(v).replace(/,/g, "")))).length / vals.length;
      if (dateCol === -1 && dateHits > 0.7) dateCol = c;
      if (numCol === -1 && numHits > 0.8 && c !== dateCol) numCol = c;
    }
    if (numCol === -1) throw new Error("No numeric column found — need a column of numbers");
    const daily = new Map(), values = [], dates = [];
    for (const r of body) {
      const num = parseFloat(String(r[numCol] ?? "").replace(/,/g, ""));
      if (isNaN(num)) continue;
      if (dateCol !== -1) {
        const d = new Date(r[dateCol]);
        if (isNaN(d)) continue;
        const key = d.toISOString().slice(0, 10);
        daily.set(key, (daily.get(key) || 0) + num);
      } else values.push(num);
    }
    if (dateCol !== -1) {
      [...daily.keys()].sort().forEach((k) => { dates.push(k); values.push(daily.get(k)); });
    }
    if (values.length < 8) throw new Error("Only " + values.length + " usable data points — need at least 8");
    return { values, dates: dateCol !== -1 ? dates : null, label: header[numCol] || "sales" };
  }

  function parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read file"));
      if (/\.(xlsx?|ods)$/i.test(file.name)) {
        reader.onload = () => {
          try {
            const wb = XLSX.read(reader.result, { type: "array", cellDates: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
            resolve(rowsToSeries(rows));
          } catch (e) { reject(e); }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = () => {
          try {
            const res = Papa.parse(String(reader.result).trim(), { skipEmptyLines: true });
            resolve(rowsToSeries(res.data));
          } catch (e) { reject(e); }
        };
        reader.readAsText(file);
      }
    });
  }

  /* ── forecast + chart ────────────────────────────────── */

  async function runForecast(parsed) {
    const horizon = parseInt($("horizonSelect").value, 10);
    setStatus(wsStatus, "Running forecast on " + parsed.values.length + " data points…", "is-loading");
    $("resultBox").hidden = true;
    try {
      const data = await api("/forecast", {
        method: "POST",
        body: JSON.stringify({ values: parsed.values, horizon }),
      });
      state.lastForecast = {
        name: "", horizon,
        values: parsed.values, forecast: data.forecast,
        quantiles: data.quantiles, label: parsed.label,
      };
      renderChart(parsed.values, data.forecast, data.quantiles);
      renderInsights(parsed, data);
      $("forecastName").value = "";
      $("resultBox").hidden = false;
      setStatus(wsStatus, "Forecast ready — name it and save to keep it.", "is-ok");
      track("forecast_generated", parsed.label);
    } catch (e) {
      setStatus(wsStatus, e.message, "is-error");
    }
  }

  function renderChart(hist, fc, quantiles) {
    const canvas = $("chart");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height, padL = 44, padR = 14, padT = 14, padB = 22;
    const all = hist.concat(fc).concat(quantiles.map((q) => q[0])).concat(quantiles.map((q) => q[8]));
    const lo = Math.min(...all), hi = Math.max(...all);
    const span = hi - lo || 1;
    const n = hist.length + fc.length - 1;
    const X = (i) => padL + (i / (n - 1)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);

    ctx.clearRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = "rgba(0,0,0,.07)"; ctx.fillStyle = "#9a9aa5";
    ctx.font = "10px system-ui"; ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = lo + (span * g) / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(Math.round(v).toLocaleString(), 6, y + 3);
    }
    // confidence band
    const bandTop = quantiles.map((q, i) => [X(hist.length - 1 + i), Y(q[8])]);
    const bandBot = quantiles.map((q, i) => [X(hist.length - 1 + i), Y(q[0])]).reverse();
    ctx.beginPath();
    ctx.moveTo(bandTop[0][0], bandTop[0][1]);
    bandTop.forEach(([x, y]) => ctx.lineTo(x, y));
    bandBot.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fillStyle = "rgba(47,91,255,.10)"; ctx.fill();
    // history
    ctx.beginPath();
    hist.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = "#2f5bff"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    // forecast dashed
    ctx.beginPath();
    fc.forEach((v, i) => { const x = X(hist.length - 1 + i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.setLineDash([6, 5]); ctx.strokeStyle = "#0ea5e9"; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    // forecast boundary marker
    const bx = X(hist.length - 1);
    ctx.strokeStyle = "rgba(0,0,0,.15)";
    ctx.beginPath(); ctx.moveTo(bx, padT); ctx.lineTo(bx, H - padB); ctx.stroke();
  }

  function avg(a) { return a.reduce((s, v) => s + v, 0) / a.length; }

  function renderInsights(parsed, data) {
    const out = [];
    const label = parsed.label;
    const k = Math.max(7, Math.min(30, Math.floor(parsed.values.length / 4)));
    const trend = ((avg(parsed.values.slice(-k)) - avg(parsed.values.slice(0, k))) / (avg(parsed.values.slice(0, k)) || 1)) * 100;
    out.push(label + ": " + (Math.abs(trend) > 3 ? (trend > 0 ? "growing" : "declining") + " trend (" + Math.abs(trend).toFixed(0) + "%)" : "broadly stable"));
    const peakIdx = data.forecast.indexOf(Math.max(...data.forecast));
    const fcAvg = avg(data.forecast);
    out.push("Forecast peak: day " + (peakIdx + 1) + " runs ~" + (((data.forecast[peakIdx] - fcAvg) / (fcAvg || 1)) * 100).toFixed(0) + "% above average");
    const lastQ = data.quantiles[data.quantiles.length - 1];
    out.push("80% range at horizon end: ±" + (((lastQ[8] - lastQ[0]) / (fcAvg || 1)) * 100 / 2).toFixed(0) + "% — earlier weeks are more reliable");
    $("insightList").innerHTML = "";
    out.forEach((t) => {
      const li = document.createElement("li"); li.textContent = t;
      $("insightList").appendChild(li);
    });
  }

  /* ── file handling ────────────────────────────────────── */

  const dropZone = $("dropZone"), fileInput = $("fileInput");
  $("pickFile").addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("click", (e) => { if (e.target.id !== "pickFile") fileInput.click(); });
  fileInput.addEventListener("change", (e) => { handleFile(e.target.files[0]); fileInput.value = ""; });
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("is-drag"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-drag"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault(); dropZone.classList.remove("is-drag");
    handleFile(e.dataTransfer.files[0]);
  });
  $("horizonSelect").addEventListener("change", () => {
    if (state.lastForecast) runForecast({ values: state.lastForecast.values, dates: null, label: state.lastForecast.label });
  });

  async function handleFile(file) {
    if (!file) return;
    setStatus(wsStatus, "Reading " + file.name + "…", "is-loading");
    try {
      const parsed = await parseFile(file);
      runForecast(parsed);
    } catch (e) {
      setStatus(wsStatus, "⚠ " + e.message, "is-error");
    }
  }

  // sample file download
  $("sampleBtn").addEventListener("click", () => {
    let csv = "date,sales\n";
    const start = new Date(); start.setDate(start.getDate() - 120);
    for (let i = 0; i < 120; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const dow = d.getDay();
      const weekend = dow === 5 || dow === 6 ? 1.45 : dow === 0 ? 1.3 : 0.85;
      const noise = 0.9 + Math.random() * 0.2;
      csv += d.toISOString().slice(0, 10) + "," + Math.round(80 * weekend * noise) + "\n";
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "sample.csv"; a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ── save / list ─────────────────────────────────────── */

  $("saveBtn").addEventListener("click", async () => {
    const f = state.lastForecast;
    if (!f) return;
    const name = ($("forecastName").value || "").trim() || (f.label + " forecast");
    setStatus(saveStatus, "Saving…", "is-loading");
    try {
      await api("/forecasts", {
        method: "POST",
        body: JSON.stringify({
          name, horizon: f.horizon, values: f.values,
          forecast: f.forecast, quantiles: f.quantiles,
        }),
      });
      setStatus(saveStatus, "Saved ✓", "is-ok");
      track("forecast_saved");
      loadSaved();
    } catch (e) {
      setStatus(saveStatus, e.message + (e.message.includes("402") || /limit|upgrade/i.test(e.message) ? " — upgrade to save more" : ""), "is-error");
    }
  });

  async function loadSaved() {
    try {
      const data = await api("/forecasts");
      const list = data.forecasts || [];
      $("savedCount").textContent = list.length ? "(" + list.length + ")" : "";
      const box = $("savedList");
      if (!list.length) {
        box.innerHTML = '<p class="app__hint">No saved forecasts yet — run one and hit Save.</p>';
        return;
      }
      box.innerHTML = "";
      list.forEach((f) => {
        const el = document.createElement("div");
        el.className = "saved-item";
        el.innerHTML = "<strong></strong><span></span>";
        el.querySelector("strong").textContent = f.name;
        el.querySelector("span").textContent =
          new Date(f.created_at * 1000).toLocaleDateString() + " · " + f.horizon + "-day horizon · " + f.context_len + " pts";
        el.addEventListener("click", () => loadForecast(f.id, el));
        box.appendChild(el);
      });
    } catch (e) { /* stay quiet */ }
  }

  async function loadForecast(id, el) {
    document.querySelectorAll(".saved-item").forEach((x) => x.classList.remove("is-active"));
    el.classList.add("is-active");
    setStatus(wsStatus, "Loading…", "is-loading");
    try {
      const f = await api("/forecasts/" + id);
      const p = f.payload;
      state.lastForecast = {
        name: f.name, horizon: f.horizon,
        values: p.values, forecast: p.forecast, quantiles: p.quantiles, label: "saved",
      };
      renderChart(p.values, p.forecast, p.quantiles);
      $("forecastName").value = f.name;
      $("resultBox").hidden = false;
      $("insightList").innerHTML = "";
      setStatus(wsStatus, "Loaded saved forecast: " + f.name, "is-ok");
    } catch (e) {
      setStatus(wsStatus, e.message, "is-error");
    }
  }

  /* ── pending plan from pricing page ───────────────────── */

  const urlPlan = new URLSearchParams(location.search).get("plan");
  if (urlPlan && (urlPlan === "growth" || urlPlan === "scale")) {
    sessionStorage.setItem(PENDING_PLAN_KEY, urlPlan);
  }

  boot();
})();
