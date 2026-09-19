// Dashboard: mic (Web Speech API) + text input -> POST /command; SSE /events -> timeline.
const $ = (id) => document.getElementById(id);
const timeline = $("timeline");
const runs = new Map(); // runId -> { el, body }

const fmtUsd = (n) => `$${n.toFixed(6)}`;
const fmtMs = (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
const pct = (p) => `${(p * 100).toFixed(0)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function getRun(runId) {
  let r = runs.get(runId);
  if (r) return r;
  const el = $("run-tpl").content.firstElementChild.cloneNode(true);
  const body = el.querySelector(".run-body");
  timeline.prepend(el);
  r = { el, body, runId };
  runs.set(runId, r);
  return r;
}

function step(run, label, html) {
  const s = document.createElement("div");
  s.className = "step";
  s.innerHTML = `<div class="label">${label}</div><div class="content">${html}</div>`;
  run.body.appendChild(s);
  return s;
}

function bars(cands, { clickable, runId, best } = {}) {
  return `<div class="bars">${cands
    .map(
      (c, i) => `<div class="bar${clickable ? " clickable" : ""}" data-run="${runId}" data-id="${esc(c.id)}" title="${esc(c.href ?? c.id)}">
        <span class="name">${esc(c.label)}</span>
        <span class="track"><span class="fill${i === 0 && best ? " top" : ""}" style="width:${Math.max(1, c.probability * 100)}%"></span></span>
        <span class="pct">${pct(c.probability)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

// ---- Measured calibration -------------------------------------------------
// Reliability: for each confidence bucket, what Jev claimed vs how often it was right.
function renderCalibration(sum) {
  $("c-total").textContent = sum.total;
  $("c-ece").textContent = sum.resolved ? sum.ece.toFixed(3) : "—";
  $("c-brier").textContent = sum.resolved ? sum.brier.toFixed(3) : "—";
  $("c-acc").textContent = sum.resolved ? pct(sum.accuracy) : "—";
  $("c-basis").textContent = sum.resolved
    ? `on ${sum.resolved} decision${sum.resolved === 1 ? "" : "s"} with ground truth`
    : "no ground truth yet";

  const used = sum.buckets.filter((b) => b.n > 0);
  $("c-legend").style.display = used.length ? "flex" : "none";
  if (!used.length) {
    $("c-buckets").innerHTML = `<div class="rel-empty">Confirm a candidate or rate a run to start the curve.</div>`;
  } else {
    $("c-buckets").innerHTML = used
      .map(
        (b) => `<div class="rel-row">
          <span class="rng">${b.label}<b>n=${b.n}</b></span>
          <span class="rel-pair">
            <span class="rel-bar"><span class="rel-track"><span class="rel-fill pred" style="width:${Math.max(1, b.meanPredicted * 100)}%"></span></span><span class="rel-val">${pct(b.meanPredicted)}</span></span>
            <span class="rel-bar"><span class="rel-track"><span class="rel-fill obs" style="width:${Math.max(1, b.observed * 100)}%"></span></span><span class="rel-val">${pct(b.observed)}</span></span>
          </span>
        </div>`,
      )
      .join("");
  }

  // Plain-language read of the gap, which is the whole point of the panel.
  const note = $("c-note");
  if (!sum.resolved) {
    note.innerHTML = "Confirm a candidate, or rate an executed run, and this fills in. Thresholds should come from this curve, not from a vendor's claim.";
  } else if (sum.resolved < 8) {
    note.innerHTML = `Too few samples to claim a threshold yet — <b>${sum.resolved}</b> so far, want at least 8.`;
  } else {
    const gap = sum.buckets.filter((b) => b.n > 0).reduce((w, b) => Math.max(w, Math.abs(b.observed - b.meanPredicted)), 0);
    note.innerHTML = gap <= 0.1
      ? `Stated confidence tracks reality to within <b>${pct(gap)}</b> on this run. The numbers mean what they say.`
      : `Worst bucket is off by <b>${pct(gap)}</b> — stated confidence is not yet matching outcomes here.`;
  }
}

// Running medians of the measured Jev-vs-LLM comparison.
const shadowRuns = [];
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

function renderShadow(ev) {
  const r = getRun(ev.runId);
  if (ev.error) { step(r, "baseline", `<div class="metrics"><span>baseline unavailable: ${esc(ev.error)}</span></div>`); return; }
  const s = ev.result;
  shadowRuns.push(s);
  step(r, "baseline", `<div class="shadow-line">
      <span><span class="model-tag">${esc(s.model)}</span> picked <b>${esc(s.pickedId)}</b> ${Number.isFinite(s.confidence) ? `at ${pct(s.confidence)}` : ""}</span>
      <span class="${s.agrees ? "win" : "disagree"}">${s.agrees ? "same answer" : "different answer"}</span>
    </div>
    <div class="metrics">
      <span>latency <b>${fmtMs(s.latencyMs)}</b> vs <b>${fmtMs(s.latencyMs / (s.speedup || 1))}</b></span>
      <span><b>${s.inputTokens.toLocaleString()}</b> in / <b>${s.outputTokens}</b> out</span>
      ${s.costUsd > 0 ? `<span class="cost"><b>${fmtUsd(s.costUsd)}</b></span>` : ""}
      ${s.speedup > 0 ? `<span class="win"><b>${s.speedup.toFixed(1)}×</b> faster</span>` : ""}
      ${s.costRatio > 0 ? `<span class="win"><b>${s.costRatio.toFixed(0)}×</b> cheaper</span>` : ""}
    </div>`);

  $("baseline").hidden = false;
  const sp = median(shadowRuns.map((x) => x.speedup).filter(Boolean));
  const co = median(shadowRuns.map((x) => x.costRatio).filter(Boolean));
  const ag = shadowRuns.filter((x) => x.agrees).length;
  $("b-speed").textContent = sp ? `${sp.toFixed(1)}×` : "—";
  $("b-cost").textContent = co ? `${co.toFixed(0)}×` : "—";
  $("b-agree").textContent = `${ag}/${shadowRuns.length}`;
  $("b-note").innerHTML = co
    ? `Median over <b>${shadowRuns.length}</b> decision${shadowRuns.length === 1 ? "" : "s"}, same question to both models.`
    : `Set <b>SHADOW_PRICE_IN_PER_M</b> in .env to get a cost multiple.`;
}

function handle(ev) {
  switch (ev.type) {
    case "calibration":
      renderCalibration(ev.summary);
      return;
    case "shadow":
      renderShadow(ev);
      return;
    case "totals":
      $("t-runs").textContent = ev.runs;
      $("t-calls").textContent = ev.calls;
      $("t-tokens").textContent = ev.inputTokens.toLocaleString();
      $("t-model").textContent = fmtMs(ev.modelMs);
      $("t-cost").textContent = fmtUsd(ev.costUsd);
      return;
    case "transcript": {
      const r = getRun(ev.runId);
      r.el.querySelector(".badge.src").textContent = ev.source;
      r.el.querySelector(".transcript").textContent = `“${ev.text}”`;
      return;
    }
    case "page":
      step(getRun(ev.runId), "page", `<div>${esc(ev.title)}</div><div class="metrics"><span><b>${ev.linkCount}</b> candidates</span><span>DOM extract <b>${fmtMs(ev.extractMs)}</b></span></div>`);
      return;
    case "model_call": {
      const c = ev.call;
      step(
        getRun(ev.runId),
        "model call",
        `<div><span class="model-tag">${esc(c.model)}</span> ${esc(c.purpose)}</div>
         <div class="metrics">
           <span><b>${c.questionCount}</b> questions</span>
           <span><b>${c.candidateCount}</b> options</span>
           <span><b>${c.inputTokens.toLocaleString()}</b> in / <b>${c.outputTokens}</b> out</span>
           <span class="cost"><b>${fmtUsd(c.costUsd)}</b></span>
           <span>latency <b>${fmtMs(c.latencyMs)}</b></span>
           ${c.requestId ? `<span>req ${esc(c.requestId)}</span>` : ""}
         </div>`,
      );
      return;
    }
    case "decision": {
      const r = getRun(ev.runId);
      const intents = Object.entries(ev.intentProbabilities)
        .map(([id, probability]) => ({ id, label: id, probability }))
        .sort((a, b) => b.probability - a.probability);
      step(
        r,
        "decision",
        `<div><b>${esc(ev.intent)}</b> <span class="routing ${ev.routing}">${ev.routing}</span>
           <span class="metrics" style="display:inline-flex;margin-left:10px">intent confidence <b>${pct(ev.intentConfidence)}</b> · goal already satisfied <b>${pct(ev.goalSatisfied)}</b></span></div>
         ${bars(intents.slice(0, 4))}`,
      );
      const clickable = ev.routing !== "execute";
      if (ev.target) step(r, "link choice", `<div class="metrics">confidence <b>${pct(ev.target.confidence)}</b>${clickable ? " · click a candidate to execute" : ""}</div>${bars(ev.target.candidates, { clickable, runId: ev.runId, best: true })}`);
      if (ev.searchQuery) step(r, "search span", `<div class="metrics">confidence <b>${pct(ev.searchQuery.confidence)}</b>${clickable ? " · click a candidate to execute" : ""}</div>${bars(ev.searchQuery.candidates, { clickable, runId: ev.runId, best: true })}`);
      return;
    }
    case "action":
      step(getRun(ev.runId), "action", `<div class="action ${ev.durationMs === 0 && ev.ok ? "wait" : ev.ok ? "ok" : "fail"}">${esc(ev.description)}</div>${ev.detail ? `<div class="metrics"><span>${esc(ev.detail)}</span></div>` : ""}${ev.durationMs ? `<div class="metrics"><span>browser <b>${fmtMs(ev.durationMs)}</b></span></div>` : ""}`);
      return;
    case "run_done": {
      const r = getRun(ev.runId);
      r.el.querySelector(".run-meta").innerHTML =
        `<span class="done">end-to-end <b>${fmtMs(ev.totalMs)}</b> · <span class="cost">${fmtUsd(ev.totalCostUsd)}</span></span>` +
        `<span class="rate" data-run="${ev.runId}" title="Did it do what you meant? This is the ground truth the calibration curve is built from.">` +
        `<button data-correct="1">✓ right</button><button data-correct="0">✗ wrong</button></span>`;
      setBusy(false);
      return;
    }
    case "error":
      step(getRun(ev.runId), "error", `<div class="error">${esc(ev.message)}</div>`);
      setBusy(false);
      return;
  }
}

// Ground-truth feedback on an executed run
timeline.addEventListener("click", async (e) => {
  const btn = e.target.closest(".rate button");
  if (!btn) return;
  const wrap = btn.closest(".rate");
  if (wrap.classList.contains("done")) return;
  const correct = btn.dataset.correct === "1";
  wrap.classList.add("done");
  btn.classList.add(correct ? "picked-ok" : "picked-bad");
  await fetch("/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: wrap.dataset.run, correct }),
  });
});

// Candidate confirmation
timeline.addEventListener("click", async (e) => {
  const bar = e.target.closest(".bar.clickable");
  if (!bar) return;
  bar.classList.remove("clickable");
  await fetch("/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: bar.dataset.run, candidateId: bar.dataset.id }) });
});

// SSE
function connect() {
  const es = new EventSource("/events");
  es.onopen = () => $("conn").classList.add("on");
  es.onerror = () => $("conn").classList.remove("on");
  es.onmessage = (m) => handle(JSON.parse(m.data));
}
connect();

// Commands
let busy = false;
function setBusy(b) {
  busy = b;
  $("mic").classList.toggle("busy", b);
  $("send").disabled = b;
}
async function send(text, source) {
  if (!text.trim() || busy) return;
  setBusy(true);
  $("interim").textContent = "";
  const res = await fetch("/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, source }) });
  if (!res.ok) setBusy(false);
}
$("send").onclick = () => { send($("text").value, "text"); $("text").value = ""; };
$("text").addEventListener("keydown", (e) => { if (e.key === "Enter") $("send").click(); });
$("clear").onclick = () => { timeline.innerHTML = ""; runs.clear(); };
$("calib-reset").onclick = async () => {
  if (!confirm("Clear the measured calibration ledger?")) return;
  await fetch("/calibration/reset", { method: "POST" });
};

// Voice: Web Speech API
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  $("hint").textContent = "Web Speech API not available in this browser — use Chrome or Edge, or type commands.";
  $("mic").disabled = true;
} else {
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let listening = false;
  rec.onstart = () => { listening = true; $("mic").classList.add("listening"); $("hint").textContent = "Listening…"; };
  rec.onend = () => { listening = false; $("mic").classList.remove("listening"); $("hint").textContent = "Click the mic and speak."; };
  rec.onerror = (e) => { $("hint").textContent = `Speech error: ${e.error}`; };
  rec.onresult = (e) => {
    let final = "";
    let interim = "";
    for (const r of e.results) (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
    $("interim").textContent = interim || final;
    if (final) send(final, "voice");
  };
  $("mic").onclick = () => (listening ? rec.stop() : rec.start());
  document.addEventListener("keydown", (e) => { if (e.code === "Space" && document.activeElement === document.body) { e.preventDefault(); $("mic").click(); } });
}
