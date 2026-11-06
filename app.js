/* ══════════════════════════════════════════════════
   SuperBrains — superbrains.dev
   Canvas chart engine + interactions (demo mode)
   ══════════════════════════════════════════════════ */

(() => {
  "use strict";

  /* ── Helpers ─────────────────────────────────── */
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Deterministic PRNG so the demo looks the same every visit
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothPath(ctx, pts) {
    if (pts.length < 2) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      const mx = (p0.x + p1.x) / 2;
      ctx.bezierCurveTo(mx, p0.y, mx, p1.y, p1.x, p1.y);
    }
  }

  function setupCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width;
    const h = rect.height || canvas.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  /* ── Demo datasets ────────────────────────────── */
  // Each generator returns { history: number[], forecast: number[], unit: string }
  // history = 180 daily points, forecast = next 30 days.
  const DAY = 86400000;

  const DATASETS = {
    bakery: {
      label: "Sourdough loaves / day",
      unit: "loaves",
      peakDay: "Friday",
      seed: 7,
      insights: [
        "Strong weekend cycle detected: demand peaks ~38% every Friday–Saturday.",
        "A 12-week upward trend suggests steady neighborhood growth (+9% MoM).",
        "Forecast calls for a pre-holiday surge the last week of December — plan +25% production.",
      ],
      gen(rand) {
        const hist = [], fc = [];
        const base = 84;
        for (let i = 0; i < 180; i++) {
          const dow = i % 7;
          const weekend = dow >= 5 ? 1.55 : dow === 4 ? 1.18 : 0.82;
          const trend = 1 + i * 0.0009;
          const noise = 0.9 + rand() * 0.2;
          hist.push(base * weekend * trend * noise);
        }
        for (let i = 0; i < 30; i++) {
          const idx = 180 + i, dow = idx % 7;
          const weekend = dow >= 5 ? 1.55 : dow === 4 ? 1.18 : 0.82;
          const holiday = idx >= 205 ? 1.22 : 1; // December bump
          fc.push(base * weekend * (1 + idx * 0.0009) * holiday * (1 + (rand() - 0.5) * 0.04));
        }
        return { hist, fc };
      },
    },
    coffee: {
      label: "Bags of beans / week",
      unit: "bags",
      peakDay: "Ramadan",
      seed: 21,
      insights: [
        "Ramadan pattern identified: expect +34% demand in the first two weeks of the holy month.",
        "Cold-brew season starts trending in April — historical lift of ~22%.",
        "Thursday is your weakest day (-18%). Consider a midweek promo to smooth demand.",
      ],
      gen(rand) {
        const hist = [], fc = [];
        const base = 132;
        for (let i = 0; i < 180; i++) {
          const month = Math.floor(i / 30);
          const season = 1 + 0.18 * Math.sin((month / 12) * Math.PI * 2 - 1.2);
          const weekCycle = 1 + 0.12 * Math.sin((i % 30) / 30 * Math.PI * 2);
          const ramadan = month === 8 ? 1.4 : 1;
          const noise = 0.92 + rand() * 0.16;
          hist.push(base * season * weekCycle * ramadan * noise);
        }
        for (let i = 0; i < 30; i++) {
          const idx = 180 + i, month = Math.floor(idx / 30);
          const season = 1 + 0.18 * Math.sin((month / 12) * Math.PI * 2 - 1.2);
          const ramadan = month === 9 ? 1.34 : 1;
          fc.push(base * season * ramadan * (1 + (rand() - 0.5) * 0.05));
        }
        return { hist, fc };
      },
    },
    skincare: {
      label: "Units sold / day",
      unit: "units",
      peakDay: "BFCM",
      seed: 42,
      insights: [
        "Steady growth trend: +11% month over month for 6 straight months.",
        "Promo spikes are 4.2× baseline — Black Friday/Cyber Monday will dominate Q4.",
        "Forecast flags a mid-January dip (-16%). Plan inventory accordingly.",
      ],
      gen(rand) {
        const hist = [], fc = [];
        const base = 47;
        for (let i = 0; i < 180; i++) {
          const month = Math.floor(i / 30);
          const growth = 1 + i * 0.0022;
          const weekly = 1 + 0.22 * Math.sin((i % 7) / 7 * Math.PI * 2 + 1);
          const promo = (i % 30 === 12 || i % 30 === 26) ? 2.1 : 1;
          const noise = 0.9 + rand() * 0.2;
          hist.push(base * growth * weekly * promo * noise);
        }
        for (let i = 0; i < 30; i++) {
          const idx = 180 + i;
          const growth = 1 + idx * 0.0022;
          const janDip = idx >= 210 ? 0.84 : 1;
          const bfc = idx >= 218 ? 2.4 : 1;
          fc.push(base * growth * janDip * bfc * (1 + (rand() - 0.5) * 0.06));
        }
        return { hist, fc };
      },
    },
    restaurant: {
      label: "Covers / night",
      unit: "covers",
      peakDay: "Saturday",
      seed: 99,
      insights: [
        "Friday–Saturday drive 61% of weekly revenue — staff accordingly.",
        "Detects a lunch slump on Mondays (-31%). A fixed lunch menu could fill seats.",
        "Summer terrace season lifts weekend covers ~19%. Don't under-schedule staff.",
      ],
      gen(rand) {
        const hist = [], fc = [];
        const base = 58;
        for (let i = 0; i < 180; i++) {
          const dow = i % 7;
          const shape = dow === 5 ? 1.6 : dow === 6 ? 1.45 : dow === 4 ? 1.2 : dow === 1 ? 0.62 : 0.85;
          const month = Math.floor(i / 30);
          const summer = (month >= 5 && month <= 7) ? 1.16 : 1;
          const noise = 0.88 + rand() * 0.24;
          hist.push(base * shape * summer * noise);
        }
        for (let i = 0; i < 30; i++) {
          const idx = 180 + i, dow = idx % 7;
          const shape = dow === 5 ? 1.6 : dow === 6 ? 1.45 : dow === 4 ? 1.2 : dow === 1 ? 0.62 : 0.85;
          const month = Math.floor(idx / 30);
          const summer = (month >= 5 && month <= 7) ? 1.16 : 1;
          fc.push(base * shape * summer * (1 + (rand() - 0.5) * 0.07));
        }
        return { hist, fc };
      },
    },
  };

  /* ── Chart renderer (shared by hero + demo) ──── */
  const PALETTE = {
    hist: "#5b8cff",
    forecast: "#c8f542",
    forecastLine: "#e4ff8a",
    band: "rgba(200,245,66,.16)",
    bandStroke: "rgba(200,245,66,.35)",
    grid: "rgba(255,255,255,.06)",
    text: "#8b8b98",
    ink: "#141310",
  };

  function drawForecastChart(canvas, data, opts = {}) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    // draw-in animation: clip to a growing horizontal window
    const prog = opts.progress ?? 1;
    ctx.save();
    if (prog < 1) {
      ctx.beginPath();
      ctx.rect(0, 0, w * prog, h);
      ctx.clip();
    }

    const padL = opts.padL ?? 8, padR = opts.padR ?? 8, padT = opts.padT ?? 14, padB = opts.padB ?? 8;
    const iw = w - padL - padR, ih = h - padT - padB;

    const hist = data.hist, fc = data.fc;
    const n = hist.length, m = fc.length, total = n + m;
    const hasBand = Array.isArray(data.bandHi) && data.bandHi.length === m &&
                    Array.isArray(data.bandLo) && data.bandLo.length === m;

    // Value bounds — include real quantile extremes when provided
    let max = -Infinity, min = Infinity;
    const consider = (v) => { if (v > max) max = v; if (v < min) min = v; };
    hist.forEach(consider); fc.forEach(consider);
    if (hasBand) { data.bandHi.forEach(consider); data.bandLo.forEach(consider); }
    const spread = (max - min) || 1;
    max += spread * 0.08; min = Math.max(0, min - spread * 0.08);

    const X = i => padL + (i / (total - 1)) * iw;
    const Y = v => padT + ih - ((v - min) / (max - min)) * ih;

    // Confidence band — real quantiles when provided, synthetic otherwise
    const bandTop = [], bandBot = [];
    for (let i = 0; i < m; i++) {
      const v = fc[i];
      const up = hasBand ? data.bandHi[i] : v * (1 + 0.04 + (i / m) * 0.11);
      const dn = hasBand ? data.bandLo[i] : v * (1 - 0.04 - (i / m) * 0.11);
      bandTop.push({ x: X(n + i), y: Y(up) });
      bandBot.push({ x: X(n + i), y: Y(Math.max(0, dn)) });
    }
    ctx.beginPath();
    smoothPath(ctx, bandTop);
    for (let i = bandBot.length - 1; i >= 0; i--) ctx.lineTo(bandBot[i].x, bandBot[i].y);
    ctx.closePath();
    ctx.fillStyle = PALETTE.band;
    ctx.fill();
    // band edge strokes
    ctx.beginPath(); smoothPath(ctx, bandTop); ctx.strokeStyle = PALETTE.bandStroke; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); smoothPath(ctx, bandBot); ctx.stroke();

    // History area fill (subtle)
    const histPts = hist.map((v, i) => ({ x: X(i), y: Y(v) }));
    ctx.beginPath();
    smoothPath(ctx, histPts);
    ctx.lineTo(histPts[histPts.length - 1].x, padT + ih);
    ctx.lineTo(histPts[0].x, padT + ih);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, "rgba(91,140,255,.22)");
    grad.addColorStop(1, "rgba(91,140,255,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // History line
    ctx.beginPath();
    smoothPath(ctx, histPts);
    ctx.strokeStyle = PALETTE.hist;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Forecast line (extends from last history point)
    const joint = { x: X(n - 1), y: Y(hist[n - 1]) };
    const fcPts = [joint, ...fc.map((v, i) => ({ x: X(n + i), y: Y(v) }))];
    ctx.beginPath();
    smoothPath(ctx, fcPts);
    ctx.strokeStyle = PALETTE.forecast;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // "Now" marker
    ctx.beginPath();
    ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#0e0e12";
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = PALETTE.forecast;
    ctx.stroke();

    // End dot on forecast
    const last = fcPts[fcPts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.forecast;
    ctx.fill();

    // Optional y gridlines + labels
    if (opts.grid) {
      ctx.strokeStyle = PALETTE.grid;
      ctx.fillStyle = PALETTE.text;
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      for (let g = 0; g <= 3; g++) {
        const v = min + ((max - min) * g) / 3;
        const y = Y(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillText(Math.round(v).toLocaleString(), w - padR - 6, y - 4);
      }
    }
    ctx.restore();
    return { X, Y, joint, last };
  }

  // Animate a chart drawing itself left → right
  function animateChart(canvas, data, opts = {}, dur = 1100) {
    const t0 = performance.now();
    const frame = (t) => {
      const p = clamp((t - t0) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      drawForecastChart(canvas, data, { ...opts, progress: eased });
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ── Nav scroll state ────────────────────────── */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 30);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ── Scroll progress bar ─────────────────────── */
  const scrollBar = document.getElementById("scrollProgress");
  const onProgress = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollBar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + "%";
  };
  window.addEventListener("scroll", onProgress, { passive: true });
  onProgress();

  /* ── 3D tilt on the hero forecast card ───────── */
  const tiltCard = document.getElementById("heroCard");
  if (tiltCard && matchMedia("(pointer: fine)").matches) {
    tiltCard.addEventListener("mousemove", (e) => {
      const r = tiltCard.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      tiltCard.style.transform = `perspective(900px) rotateY(${px * 7}deg) rotateX(${-py * 7}deg) translateY(-4px)`;
    });
    tiltCard.addEventListener("mouseleave", () => { tiltCard.style.transform = ""; });
  }

  /* ── Stagger reveal delays within each section ─ */
  document.querySelectorAll(".features, .quotes, .pricing, .steps, .stats__grid").forEach((group) => {
    [...group.children].forEach((el, i) => {
      if (el.classList.contains("reveal")) el.style.transitionDelay = `${Math.min(i * 90, 360)}ms`;
    });
  });

  /* ── Reveal on scroll ────────────────────────── */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("is-visible")),
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ── Animated stat counters ──────────────────── */
  const statIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target, target = +el.dataset.count, dur = 1600, t0 = performance.now();
      const tick = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      statIO.unobserve(el);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll(".stat__num").forEach((el) => statIO.observe(el));

  /* ── Hero card: pre-generated bakery-like series ─ */
  const heroRand = mulberry32(1337);
  const heroHist = [];
  for (let i = 0; i < 90; i++) {
    const dow = i % 7;
    const weekend = dow >= 5 ? 1.5 : dow === 4 ? 1.15 : 0.85;
    const trend = 1 + i * 0.002;
    heroHist.push(100 * weekend * trend * (0.92 + heroRand() * 0.16));
  }
  const heroFc = [];
  for (let i = 0; i < 21; i++) {
    const idx = 90 + i, dow = idx % 7;
    const weekend = dow >= 5 ? 1.5 : dow === 4 ? 1.15 : 0.85;
    heroFc.push(100 * weekend * (1 + idx * 0.002) * (1 + (heroRand() - 0.5) * 0.05));
  }
  animateChart(document.getElementById("heroChart"), { hist: heroHist, fc: heroFc }, {}, 1400);

  // Hero background path — a soft echo of the same curve
  const bgPath = document.getElementById("heroPath");
  if (bgPath) {
    const pts = heroHist.concat(heroFc).map((v, i, arr) => {
      const x = (i / (arr.length - 1)) * 1440;
      const y = 300 - (v / Math.max(...arr)) * 240 - 30;
      return `${i === 0 ? "M" : "L"}${x.toFixed(0)},${y.toFixed(0)}`;
    });
    bgPath.setAttribute("d", pts.join(" "));
  }

  /* ── Demo: dataset switching + render ─────────── */
  const demoCanvas = document.getElementById("demoChart");
  const insightList = document.getElementById("insightList");
  const tabs = document.querySelectorAll(".demo__tab");
  let currentData = null;

  function renderDemo(key) {
    const ds = DATASETS[key];
    const rand = mulberry32(ds.seed);
    currentData = ds.gen(rand);

    // Labels under the chart handled by legend; render with y grid
    animateChart(demoCanvas, currentData, { grid: true, padL: 46, padR: 14 }, 700);

    insightList.innerHTML = "";
    ds.insights.forEach((text, i) => {
      const li = document.createElement("li");
      li.textContent = text;
      li.style.animationDelay = `${i * 90}ms`;
      insightList.appendChild(li);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      renderDemo(tab.dataset.set);
    });
  });

  renderDemo("bakery");

  /* ── CSV upload → real TimesFM forecast ──────── */
  const API_URL = "http://localhost:8000";
  const demoEl = document.querySelector(".demo");
  const statusEl = document.getElementById("demoStatus");
  const uploadBtn = document.getElementById("uploadBtn");
  const csvInput = document.getElementById("csvInput");
  const sampleCsvBtn = document.getElementById("sampleCsvBtn");
  const horizonSelect = document.getElementById("horizonSelect");
  let lastUpload = null; // { values, dates, label }

  function setStatus(msg, kind = "") {
    statusEl.textContent = msg;
    statusEl.className = "demo__status" + (msg ? " is-show " + kind : "");
  }

  function setBusy(on) { demoEl.classList.toggle("is-busy", on); }

  function looksLikeDate(v) {
    if (v == null || v === "") return false;
    const s = String(v).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return !isNaN(Date.parse(s.length === 10 ? s + "T00:00:00Z" : s));
    const t = Date.parse(s);
    return !isNaN(t) && /[a-zA-Z]{3,}|\//.test(s) && s.length > 5;
  }

  // Rows (array of arrays) → { dates, values, label }
  function rowsToSeries(rows) {
    rows = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
    if (rows.length < 3) throw new Error("File needs at least a header + a few rows");

    const header = rows[0].map((c) => String(c).trim().toLowerCase());
    const body = rows.slice(1);
    const ncols = Math.max(...body.map((r) => r.length));

    // pick date column and first numeric column
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

    // aggregate by day when dates exist (POS exports often have intraday rows)
    const daily = new Map();
    const values = [];
    const dates = [];
    for (const r of body) {
      const raw = r[numCol];
      const num = parseFloat(String(raw ?? "").replace(/,/g, ""));
      if (isNaN(num)) continue;
      if (dateCol !== -1) {
        const d = new Date(r[dateCol]);
        if (isNaN(d)) continue;
        const key = d.toISOString().slice(0, 10);
        daily.set(key, (daily.get(key) || 0) + num);
      } else {
        values.push(num);
      }
    }
    if (dateCol !== -1) {
      const keys = [...daily.keys()].sort();
      keys.forEach((k) => { dates.push(k); values.push(daily.get(k)); });
    }
    if (values.length < 8) throw new Error(`Only ${values.length} usable data points — need at least 8`);

    const label = header[numCol] || "sales";
    return { values, dates: dateCol !== -1 ? dates : null, label };
  }

  // Delimited text: CSV, TSV, TXT, PSV — Papa auto-detects the separator
  function parseDelimitedText(text) {
    const res = Papa.parse(text.trim(), { skipEmptyLines: true });
    return rowsToSeries(res.data);
  }

  // Excel / ODS: first worksheet → array-of-arrays
  function parseSpreadsheet(buf) {
    if (typeof XLSX === "undefined") throw new Error("Excel parser failed to load — check your connection");
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("No worksheets found in file");
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
    return rowsToSeries(rows);
  }

  const SPREADSHEET_EXT = /\.(xlsx?|ods)$/i;

  function parseFile(file) {
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read file"));
      if (SPREADSHEET_EXT.test(file.name)) {
        reader.onload = () => {
          try { resolve(parseSpreadsheet(reader.result)); }
          catch (e) { reject(e); }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = () => {
          try { resolve(parseDelimitedText(String(reader.result))); }
          catch (e) { reject(e); }
        };
        reader.readAsText(file);
      }
    });
  }

  function avg(a) { return a.reduce((s, v) => s + v, 0) / a.length; }

  function buildInsights(values, forecast, quantiles, dates, label) {
    const out = [];
    const k = Math.max(7, Math.min(30, Math.floor(values.length / 4)));
    const early = avg(values.slice(0, k)), late = avg(values.slice(-k));
    const trendPct = ((late - early) / (early || 1)) * 100;
    if (Math.abs(trendPct) > 3) {
      out.push(`${label}: ${trendPct > 0 ? "growing" : "declining"} trend detected — ${Math.abs(trendPct).toFixed(0)}% ${trendPct > 0 ? "up" : "down"} over the recent period.`);
    } else {
      out.push(`${label}: demand is broadly stable over the recent period (±${Math.abs(trendPct).toFixed(0)}%).`);
    }

    if (dates && dates.length >= 14) {
      const byDow = Array.from({ length: 7 }, () => []);
      dates.forEach((d, i) => byDow[new Date(d + "T00:00:00Z").getUTCDay()].push(values[i]));
      const means = byDow.map((a) => a.length ? avg(a) : NaN);
      const valid = means.map((m, i) => ({ m, i })).filter((x) => !isNaN(x.m));
      if (valid.length >= 5) {
        valid.sort((a, b) => b.m - a.m);
        const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        out.push(`Weekly rhythm: ${names[valid[0].i]}s are your strongest day (+${(((valid[0].m - avg(means.filter((x) => !isNaN(x)))) / avg(means.filter((x) => !isNaN(x))) * 100) || 0).toFixed(0)}% vs average).`);
      }
    }

    const fcAvg = avg(forecast);
    let peakIdx = 0;
    forecast.forEach((v, i) => { if (v > forecast[peakIdx]) peakIdx = i; });
    const peakPct = ((forecast[peakIdx] - fcAvg) / (fcAvg || 1)) * 100;
    out.push(`Forecast peak: day ${peakIdx + 1} of the horizon runs ~${peakPct.toFixed(0)}% above the forecast average — plan stock and staff around it.`);

    const endWidth = ((quantiles[quantiles.length - 1][8] - quantiles[quantiles.length - 1][0]) / (fcAvg || 1)) * 100;
    out.push(`Model confidence: the 80% range widens to ±${(endWidth / 2).toFixed(0)}% by the end of the horizon — earlier weeks are more reliable.`);
    return out.slice(0, 4);
  }

  async function runForecast(parsed) {
    const horizon = parseInt(horizonSelect.value, 10);
    setBusy(true);
    setStatus(`Sending ${parsed.values.length} data points to the AI engine…`, "is-loading");
    tabs.forEach((t) => t.classList.remove("is-active"));

    try {
      const res = await fetch(`${API_URL}/forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: parsed.values, horizon }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`);
      const data = await res.json();

      currentData = {
        hist: parsed.values,
        fc: data.forecast,
        bandLo: data.quantiles.map((q) => q[0]),
        bandHi: data.quantiles.map((q) => q[8]),
      };
      animateChart(demoCanvas, currentData, { grid: true, padL: 46, padR: 14 }, 900);

      insightList.innerHTML = "";
      buildInsights(parsed.values, data.forecast, data.quantiles, parsed.dates, parsed.label)
        .forEach((text, i) => {
          const li = document.createElement("li");
          li.textContent = text;
          li.style.animationDelay = `${i * 90}ms`;
          insightList.appendChild(li);
        });

      const span = parsed.dates ? `${parsed.dates[0]} → ${parsed.dates[parsed.dates.length - 1]}` : `${parsed.values.length} periods`;
      setStatus(`✓ Real AI forecast · ${span} · ${horizon}-step horizon · neural forecasting engine`, "is-ok");
      lastUpload = parsed;
    } catch (err) {
      console.error("forecast failed:", err);
      setStatus(`⚠ Forecast service is offline right now — the sample forecasts above still work.`, "is-error");
      // keep whatever was on screen; re-activate first tab visually
      tabs[0].classList.add("is-active");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file) {
    if (!file) return;
    setStatus(`Reading ${file.name}…`, "is-loading");
    try {
      const parsed = await parseFile(file);
      runForecast(parsed);
    } catch (e) {
      setStatus(`⚠ ${e.message}`, "is-error");
    }
  }

  uploadBtn.addEventListener("click", () => csvInput.click());
  csvInput.addEventListener("change", (e) => { handleFile(e.target.files[0]); csvInput.value = ""; });
  // drag & drop onto the demo card
  demoEl.addEventListener("dragover", (e) => { e.preventDefault(); demoEl.style.outline = "2px dashed var(--lime)"; });
  demoEl.addEventListener("dragleave", () => { demoEl.style.outline = ""; });
  demoEl.addEventListener("drop", (e) => {
    e.preventDefault(); demoEl.style.outline = "";
    handleFile(e.dataTransfer.files[0]);
  });

  horizonSelect.addEventListener("change", () => {
    if (lastUpload) runForecast(lastUpload);
    else renderDemo(document.querySelector(".demo__tab.is-active")?.dataset.set || "bakery");
  });

  // sample CSV — 180 days of bakery-like sales ending today
  sampleCsvBtn.addEventListener("click", () => {
    const rand = mulberry32(7);
    const rows = ["date,sales"];
    const today = new Date();
    for (let i = 179; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY);
      const dow = d.getDay();
      const weekend = dow >= 5 ? 1.55 : dow === 4 ? 1.18 : 0.82;
      const v = Math.round(84 * weekend * (1 + (179 - i) * 0.0009) * (0.9 + rand() * 0.2));
      rows.push(`${d.toISOString().slice(0, 10)},${v}`);
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sample-sales.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Re-render charts on resize (debounced)
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawForecastChart(document.getElementById("heroChart"), { hist: heroHist, fc: heroFc });
      if (currentData) drawForecastChart(demoCanvas, currentData, { grid: true, padL: 46, padR: 14 });
    }, 150);
  });
})();
