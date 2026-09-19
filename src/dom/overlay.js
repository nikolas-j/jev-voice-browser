// In-page assistant overlay, Grammarly-style. Injected into every page via addInitScript.
// Plain JS on purpose (no bundler helpers exist in page context) and wrapped in a shadow
// root so the host page's CSS can never touch it, and ours can never touch the host.
(() => {
  // addInitScript runs at document-start, when <body> does not exist yet. Chrome does not
  // render elements parented outside <body>, so wait for it before mounting.
  const boot = () => { if (!window.__sxMounted) mount(); };
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });

  function mount() {
  window.__sxMounted = true;
  console.log('[koda] mounting, readyState=' + document.readyState);

  const ACCENT = "#2D6A4F"; // forest green
  const host = document.createElement("div");
  host.id = "sx-host";
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
<style>
  :host, * { box-sizing: border-box; }
  .wrap { font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          color: #1A1A18; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }

  /* collapsed pill */
  .pill { display: inline-flex; align-items: center; gap: 9px; border: 1px solid #E8E4DE;
          background: #fff; border-radius: 9999px; padding: 10px 16px 10px 12px; cursor: pointer;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,.10), 0 2px 4px -2px rgba(0,0,0,.10);
          transition: transform .15s ease, box-shadow .15s ease; }
  .pill:hover { transform: translateY(-1px); box-shadow: 0 8px 18px -6px rgba(0,0,0,.18); }
  .pill .mark { width: 22px; height: 22px; flex: 0 0 22px; border-radius: 50%;
                background: ${ACCENT}; display: grid; place-items: center; color: #fff; }
  .pill .mark svg { width: 13px; height: 13px; }
  .pill .lbl { font-weight: 550; letter-spacing: .01em; }
  .pill .sub { color: #6B6560; font-size: 12px; }
  .pill.busy .mark { animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }

  /* expanded panel */
  .panel { width: 372px; max-width: calc(100vw - 40px); background: #fff; border: 1px solid #E8E4DE;
           border-radius: 16px; box-shadow: 0 18px 40px -12px rgba(0,0,0,.22), 0 4px 10px -4px rgba(0,0,0,.10);
           overflow: hidden; }
  .hd { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #F0EDE8;
        background: #FAF8F5; }
  .hd .mark { width: 24px; height: 24px; border-radius: 50%; background: ${ACCENT}; display: grid;
              place-items: center; color: #fff; }
  .hd .mark svg { width: 14px; height: 14px; }
  .hd h1 { margin: 0; font: 600 15px/1.2 Lora, Georgia, serif; letter-spacing: .01em; flex: 1; }
  .hd .x { border: 0; background: none; cursor: pointer; color: #6B6560; font-size: 18px; line-height: 1;
           padding: 2px 4px; border-radius: 6px; }
  .hd .x:hover { background: #F0EDE8; color: #1A1A18; }

  .bd { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
  .lead { color: #6B6560; font-size: 13px; margin: 0; }

  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .chip { border: 1px solid #E8E4DE; background: #fff; border-radius: 9999px; padding: 6px 12px;
          font-size: 12.5px; color: #1A1A18; cursor: pointer; transition: all .12s; text-align: left; }
  .chip:hover { border-color: ${ACCENT}; color: ${ACCENT}; background: #F1F7F4; }

  .row { display: flex; gap: 8px; align-items: center; }
  .inp { flex: 1; border: 1px solid #E8E4DE; border-radius: 10px; padding: 10px 12px; font: inherit;
         color: #1A1A18; outline: none; background: #fff; min-width: 0; }
  .inp:focus { border-color: ${ACCENT}; box-shadow: 0 0 0 3px rgba(45,106,79,.16); }
  .inp::placeholder { color: #A8A29B; }
  .btn { border: 0; background: ${ACCENT}; color: #fff; border-radius: 10px; padding: 10px 14px;
         font: inherit; font-weight: 550; cursor: pointer; white-space: nowrap; }
  .btn:hover { filter: brightness(.96); }
  .btn[disabled] { opacity: .5; cursor: default; }
  .mic { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 50%; border: 1px solid #E8E4DE;
         background: #fff; color: #6B6560; cursor: pointer; display: grid; place-items: center; }
  .mic:hover { color: ${ACCENT}; border-color: ${ACCENT}; }
  .mic.on { background: ${ACCENT}; color: #fff; border-color: ${ACCENT}; animation: pulse 1.1s infinite; }
  .mic svg { width: 17px; height: 17px; }

  /* uncertainty */
  .ask { border: 1px solid #DCE9E2; background: #F5FAF7; border-radius: 12px; padding: 12px; }
  .ask .t { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
  .ask .s { color: #6B6560; font-size: 12.5px; margin-bottom: 10px; }
  .cand { display: flex; flex-direction: column; gap: 6px; }
  .cand button { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
                 border: 1px solid #E8E4DE; background: #fff; border-radius: 10px; padding: 8px 10px;
                 cursor: pointer; font: inherit; }
  .cand button:hover { border-color: ${ACCENT}; background: #F1F7F4; }
  .cand .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cand .meter { width: 46px; height: 5px; border-radius: 3px; background: #F0EDE8; overflow: hidden; flex: 0 0 46px; }
  .cand .meter i { display: block; height: 100%; background: ${ACCENT}; border-radius: 3px; }
  .cand .p { font-variant-numeric: tabular-nums; color: #6B6560; font-size: 12px; width: 30px; text-align: right; }

  .note { font-size: 12px; color: #6B6560; display: flex; align-items: center; gap: 7px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #9BBF9E; flex: 0 0 6px; }
  .dot.warn { background: #E0A24A; }
  .dot.bad { background: #CC7A6A; }

  .done { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .done .txt { flex: 1; }
  .passage { border-left: 3px solid #2D6A4F; background: #F5FAF7; border-radius: 0 8px 8px 0;
             padding: 10px 12px; font-size: 13px; line-height: 1.55; color: #1A1A18; }
  .passage .src { display: block; margin-top: 6px; font-size: 11px; color: #6B6560; }
  .rate { display: flex; gap: 6px; }
  .rate button { border: 1px solid #E8E4DE; background: #fff; border-radius: 8px; padding: 4px 9px;
                 font-size: 12px; cursor: pointer; color: #6B6560; }
  .rate button:hover { border-color: ${ACCENT}; color: ${ACCENT}; }
  .wake { border: 1px solid #DCE9E2; background: #fff; color: #6B6560; border-radius: 9999px;
          padding: 3px 10px; font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
  .wake.on { background: #2D6A4F; border-color: #2D6A4F; color: #fff; }
  .wake.on::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
                     background: #fff; margin-right: 6px; vertical-align: middle; animation: pulse 1.6s ease-in-out infinite; }
  .pill .ear { width: 6px; height: 6px; border-radius: 50%; background: #2D6A4F; margin-left: 2px;
               animation: pulse 1.6s ease-in-out infinite; }
  .gauge { border: 1px solid #E8E4DE; border-radius: 10px; padding: 10px 12px; background: #FCFBF9; }
  .glabel { display: flex; justify-content: space-between; font-size: 11.5px; color: #6B6560; margin-bottom: 7px; }
  .glabel span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; color: #1A1A18; }
  .gtrack { position: relative; height: 8px; background: #EFEBE5; border-radius: 4px; }
  .gfill { position: absolute; left: 0; top: 0; bottom: 0; background: #2D6A4F; border-radius: 4px; transition: width .35s ease; }
  .gfill.under { background: #C9A227; }
  .gbar { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #1A1A18; border-radius: 1px; }
  .gbar::after { content: "act alone"; position: absolute; top: -15px; left: 50%; transform: translateX(-50%);
                 font-size: 9px; color: #6B6560; white-space: nowrap; }
  .gfoot { margin-top: 9px; font-size: 11px; color: #6B6560; line-height: 1.45; }
  .gfoot b { color: #1A1A18; font-variant-numeric: tabular-nums; }
  .hidden { display: none !important; }
</style>

<div class="wrap">
  <div class="panel hidden" id="panel">
    <div class="hd">
      <span class="mark">${micSvg()}</span>
      <h1 id="title">KODA</h1>
      <button class="wake" id="wake" title="Wake word: say “hey KODA”">hey KODA</button>
      <button class="x" id="close" title="Collapse">&times;</button>
    </div>
    <div class="bd">
      <p class="lead" id="lead">Say or type what you want. I act on my own only when I am sure enough.</p>

      <div id="suggest">
        <div class="chips" id="chips"></div>
      </div>

      <div class="ask hidden" id="ask">
        <div class="t" id="askT">Which one did you mean?</div>
        <div class="s" id="askS"></div>
        <div class="cand" id="cand"></div>
      </div>

      <div class="done hidden" id="done">
        <span class="txt" id="doneTxt"></span>
        <span class="rate"><button data-ok="1">&#10003;</button><button data-ok="0">&#10007;</button></span>
      </div>

      <div class="row">
        <input class="inp" id="inp" placeholder="Say “hey KODA…” or type a command" autocomplete="off" />
        <button class="mic" id="mic" title="Speak">${micSvg()}</button>
        <button class="btn" id="go">Go</button>
      </div>

      <div class="gauge hidden" id="gauge">
        <div class="glabel"><span id="gTxt">confidence</span><span id="gPct">—</span></div>
        <div class="gtrack"><span class="gfill" id="gFill"></span><span class="gbar" id="gBar"></span></div>
        <div class="gfoot" id="gFoot"></div>
      </div>

      <div class="note" id="note"><span class="dot" id="dot"></span><span id="noteT">Ready</span></div>
    </div>
  </div>

  <button class="pill" id="pill">
    <span class="mark">${micSvg()}</span>
    <span class="lbl">KODA</span>
    <span class="sub" id="pillSub">ask this page</span>
    <span class="ear hidden" id="ear"></span>
  </button>
</div>`;

  function micSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/></svg>`;
  }

  document.body.appendChild(host);
  console.log('[koda] overlay mounted into <body>');
  const $ = (id) => root.getElementById(id);
  const send = (msg) => window.__sxBridge && window.__sxBridge(JSON.stringify(msg));

  // What KODA can actually do. The intent set is closed on purpose: it only ever picks from these.
  const CAPABILITIES = [
    "go to the history section",
    "open the page about steam engines",
    "search for Ada Lovelace",
    "scroll down",
    "jump to the bottom",
    "back to the top",
    "go back",
    "go forward",
    "reload the page",
  ];

  const SUGGESTIONS = [
    "go to the history section",
    "search for Ada Lovelace",
    "jump to the bottom",
    "scroll down",
    "go back",
  ];
  $("chips").innerHTML = SUGGESTIONS.map((s) => `<button class="chip">${s}</button>`).join("");
  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) submit(b.textContent);
  });

  let open = false;
  const setOpen = (v) => {
    open = v;
    $("panel").classList.toggle("hidden", !v);
    if (v) setTimeout(() => $("inp").focus(), 40);
  };
  $("pill").onclick = () => setOpen(!open);
  $("close").onclick = () => setOpen(false);

  // Hold the conversation open for a while so you do not have to say the name every time.
  function keepTalking() {
    armedUntil = Date.now() + CONVERSATION_MS;
    $("ear").classList.remove("hidden");
    const mine = armedUntil;
    setTimeout(() => {
      if (armedUntil !== mine) return;
      armedUntil = 0;
      $("ear").classList.add("hidden");
      setNote("Say “hey KODA” when you need me", null);
    }, CONVERSATION_MS);
  }

  function setNote(text, kind) {
    $("noteT").textContent = text;
    $("dot").className = "dot" + (kind ? " " + kind : "");
  }
  function busy(b) {
    $("pill").classList.toggle("busy", b);
    $("go").disabled = b;
    $("pillSub").textContent = b ? "thinking…" : "ask this page";
  }

  function submit(text) {
    if (!text || !text.trim()) return;
    $("inp").value = "";
    $("ask").classList.add("hidden");
    $("done").classList.add("hidden");
    $("suggest").classList.add("hidden");
    busy(true);
    setNote(`Working on “${text.trim()}”`, null);
    send({ t: "command", text: text.trim() });
  }
  $("go").onclick = () => submit($("inp").value);
  $("inp").addEventListener("keydown", (e) => { if (e.key === "Enter") submit($("inp").value); });

  let currentRun = null;
  let pendingCands = [];   // what the clarify card is offering, for voice selection

  // Hands-free means the clarification is answered by voice too, not by a click.
  const ORDINAL = [
    [/\b(first|one|1st|number one|top one|top)\b/i, 0],
    [/\b(second|two|2nd|number two)\b/i, 1],
    [/\b(third|three|3rd|number three)\b/i, 2],
    [/\b(fourth|four|4th)\b/i, 3],
    [/\b(fifth|five|5th)\b/i, 4],
  ];
  const DISMISS = /\b(neither|none|nothing|no thanks|cancel|never ?mind|forget it|stop)\b/i;
  // Rating the last action by voice, so building the calibration curve is hands-free too.
  const RATE_OK = /\b(that'?s? )?(right|correct|good|perfect|yes|yep|nice|spot on|exactly)\b/i;
  const RATE_BAD = /\b(wrong|no+pe?|not (that|it|right)|bad|incorrect|that'?s wrong)\b/i;
  let awaitingRating = null;   // runId whose result is on screen and unrated

  function rateByVoice(text) {
    if (!awaitingRating) return false;
    const ok = RATE_OK.test(text);
    const bad = RATE_BAD.test(text);
    if (!ok && !bad) return false;
    send({ t: "feedback", runId: awaitingRating, correct: ok && !bad });
    awaitingRating = null;
    $("done").classList.add("hidden");
    setNote(ok && !bad ? "Logged as right — that sets my bar" : "Logged as wrong — that lowers my bar", null);
    return true;
  }

  function resolveByVoice(text) {
    if (!pendingCands.length) return false;
    if (DISMISS.test(text)) {
      $("ask").classList.add("hidden");
      pendingCands = [];
      setNote("Dropped it", null);
      return true;
    }
    for (const [re, i] of ORDINAL) {
      if (re.test(text) && pendingCands[i]) { pickCandidate(pendingCands[i].id); return true; }
    }
    if (/\b(last|bottom)\b/i.test(text)) { pickCandidate(pendingCands[pendingCands.length - 1].id); return true; }
    // otherwise match the words they said against the candidate labels
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (!words.length) return false;
    let best = null, bestScore = 0;
    for (const c of pendingCands) {
      const label = String(c.label).toLowerCase();
      const score = words.reduce((n, w) => n + (label.includes(w) ? w.length : 0), 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= 4) { pickCandidate(best.id); return true; }
    return false;
  }

  function pickCandidate(id) {
    $("ask").classList.add("hidden");
    pendingCands = [];
    busy(true);
    setNote("Thanks — doing that now", null);
    send({ t: "confirm", runId: currentRun, candidateId: id });
  }
  $("cand").addEventListener("click", (e) => {
    const retry = e.target.closest("button[data-try]");
    if (retry) { $("ask").classList.add("hidden"); submit(retry.dataset.try); return; }
    const b = e.target.closest("button[data-id]");
    if (!b || !currentRun) return;
    pendingCands = [];
    $("ask").classList.add("hidden");
    busy(true);
    setNote("Thanks — doing that now", null);
    send({ t: "confirm", runId: currentRun, candidateId: b.dataset.id });
  });
  $("done").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ok]");
    if (!b || !currentRun) return;
    $("done").classList.add("hidden");
    setNote(b.dataset.ok === "1" ? "Logged as correct — thank you" : "Logged as wrong — that improves the curve", null);
    send({ t: "feedback", runId: currentRun, correct: b.dataset.ok === "1" });
  });

  // Called from Node after every decision / action.
  function paintGauge(s) {
    if (typeof s.top !== "number" || typeof s.bar !== "number") return;
    const pctOf = (x) => Math.max(2, Math.min(100, Math.round(x * 100)));
    $("gauge").classList.remove("hidden");
    $("gPct").textContent = Math.round(s.top * 100) + "%";
    $("gTxt").textContent = s.confident ? "confident enough to act" : "not confident enough";
    $("gFill").style.width = pctOf(s.top) + "%";
    $("gFill").classList.toggle("under", !s.confident);
    $("gBar").style.left = pctOf(s.bar) + "%";
    $("gFoot").innerHTML = s.barSource === "measured"
      ? `Bar is <b>${Math.round(s.bar * 100)}%</b>, learned from <b>${s.resolved}</b> checked decisions — the lowest confidence where it was still right 90% of the time.`
      : `Bar is <b>${Math.round(s.bar * 100)}%</b>, a default. After <b>${Math.max(0, 8 - (s.resolved || 0))}</b> more checks it sets its own from measurement.`;
  }

  window.__sxUpdate = (s) => {
    currentRun = s.runId || currentRun;
    paintGauge(s);
    // Conversational window: it just did something, so the next thing you say is for it.
    if (wakeOn && (s.phase === "done" || s.phase === "clarify")) keepTalking();
    if (s.phase === "clarify" && s.intent === "unclear") {
      // Not an ambiguous target — a request KODA cannot carry out at all. Say so, and say what it can do.
      busy(false);
      setOpen(true);
      $("ask").classList.remove("hidden");
      $("askT").textContent = "I can move around this page, but I can't answer questions yet";
      $("askS").textContent = "I navigate, I don't read aloud or summarise. Try one of these instead:";
      $("cand").innerHTML = CAPABILITIES.map(
        (c) => `<button data-try="${escapeHtml(c)}"><span class="nm">${escapeHtml(c)}</span></button>`,
      ).join("");
      setNote("Out of scope — not a guess I'm willing to make", "warn");
    } else if (s.phase === "clarify") {
      busy(false);
      setOpen(true);
      $("ask").classList.remove("hidden");
      $("askT").textContent = s.escalated
        ? (s.intent === "answer" ? "I could not find a passage that answers that" : "I could not find a confident match")
        : (s.intent === "answer" ? "Which passage did you mean?" : "Which one did you mean?");
      $("askS").textContent = s.escalated
        ? "Nothing cleared the bar. Pick one, or rephrase."
        : `My best guess is only ${Math.round((s.top || 0) * 100)}% — below the bar I am allowed to act on.`;
      pendingCands = (s.candidates || []).filter((c) => c.id !== "NONE").slice(0, 5);
      $("cand").innerHTML = (s.candidates || [])
        .map((c) => `<button data-id="${c.id}"><span class="nm">${escapeHtml(c.label)}</span>
            <span class="meter"><i style="width:${Math.max(3, Math.round(c.probability * 100))}%"></i></span>
            <span class="p">${Math.round(c.probability * 100)}%</span></button>`)
        .join("");
      setNote(wakeOn ? "Say “the first one”, or name it — or click" : "Pick one, or rephrase", "warn");
      $("ear").classList.toggle("hidden", !wakeOn);
    } else if (s.phase === "done") {
      busy(false);
      $("ask").classList.add("hidden");
      $("done").classList.remove("hidden");
      awaitingRating = s.runId || currentRun;
      if (s.answer) {
        $("doneTxt").innerHTML = `<div class="passage">${escapeHtml(s.description || "")}<span class="src">from this page${
          s.top ? ` · ${Math.round(s.top * 100)}% confident this passage answers it` : ""}</span></div>`;
      } else {
        $("doneTxt").textContent = s.description || "Done";
      }
      setNote((s.confident ? `Acted on my own at ${Math.round((s.top || 0) * 100)}% confidence` : "Done") + (wakeOn ? " · say “right” or “wrong”, or just carry on" : ""), s.ok ? null : "bad");
    } else if (s.phase === "error") {
      busy(false);
      setNote(s.message || "Something went wrong", "bad");
    }
  };
  window.__sxReset = () => { $("suggest").classList.remove("hidden"); busy(false); setNote("Ready", null); };

  function escapeHtml(x) {
    return String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---- Voice ---------------------------------------------------------------
  // Two ways in: press the mic and speak, or just say "hey KODA …" while it listens
  // ambiently. Ambient speech that does not address KODA is ignored, never acted on.
  // Web Speech has never heard of "KODA", so it guesses: corta, Cora, quota, coda, kota…
  // Matching an exact list loses. Match the phonetic family instead: an address word,
  // then a short word starting with a k/c/q sound that is not ordinary English.
  const ADDRESS = /\b(?:hey|hi|hey there|ok|okay|hello)[,\s]+([a-z']{2,9})/i;
  const KNOWN = /^(?:koda|coda|kota|kora|corta|cora|kuda|khoda|cola|quota|cuda|kodak|quota|korda|chota|goda|soda)$/i;
  const NOT_A_NAME = new Set([
    "could", "come", "can", "cool", "call", "care", "keep", "know", "kind", "close",
    "check", "click", "come", "copy", "cancel", "clear", "quick", "quit", "cut",
  ]);
  function wakeMatch(text) {
    const m = ADDRESS.exec(text);
    if (!m) return null;
    const w = m[1].toLowerCase();
    const plausible = KNOWN.test(w) || (/^[kcqg]/.test(w) && w.length >= 3 && w.length <= 7 && !NOT_A_NAME.has(w));
    return plausible ? { index: m.index, length: m[0].length, heard: w } : null;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let wakeOn = true;      // ambient wake word armed
  let armedUntil = 0;     // after a bare "hey KODA", the NEXT utterance is the command
  const FOLLOW_MS = 9000;          // bare "hey KODA", waiting for the command
  const CONVERSATION_MS = 15000;   // after it acts, keep talking without saying the name again
  let manual = false;     // user pressed the mic, so the whole utterance is the command
  let listening = false;
  let denied = 0;
  let rec = null;

  function paintWake() {
    $("wake").classList.toggle("on", wakeOn && Boolean(rec));
    $("ear").classList.toggle("hidden", !(wakeOn && listening));
  }

  function startRec() {
    if (!rec || listening) return;
    try { rec.start(); } catch (_) { /* already starting */ }
  }

  if (!SR) {
    $("mic").style.display = "none";
    $("wake").style.display = "none";
  } else {
    rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;

    rec.onstart = () => { listening = true; $("mic").classList.toggle("on", manual); paintWake();
      console.log("[koda] rec start (wakeOn=" + wakeOn + ")"); };
    rec.onend = () => {
      listening = false;
      $("mic").classList.remove("on");
      paintWake();
      // Chrome ends the session on silence; re-arm so the wake word keeps working.
      console.log("[koda] rec end, rearm=" + wakeOn);
      if (wakeOn) setTimeout(startRec, 400);
    };
    rec.onerror = (e) => {
      listening = false;
      $("mic").classList.remove("on");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        denied += 1;
        console.log("[koda] rec error " + e.error + " (" + denied + ")");
        if (denied >= 3) { wakeOn = false; setNote("Microphone blocked — type instead", "warn"); }
        else setTimeout(startRec, 1200);
        console.log("[koda] rec error " + e.error);
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        console.log("[koda] rec error " + e.error);
        setNote("Mic: " + e.error, "warn");
      }
      paintWake();
    };

    rec.onresult = (e) => {
      let final = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      const armed = Date.now() < armedUntil;
      if ((manual || armed) && interim) $("inp").value = interim;
      if (interim) console.log("[koda] interim: " + interim);
      if (!final) return;
      console.log("[koda] FINAL: \"" + final + "\" manual=" + manual + " armed=" + armed + " wakeOn=" + wakeOn + " wakeMatch=" + JSON.stringify(wakeMatch(final)));

      if (manual) { manual = false; submit(final); return; }

      // A short "yes / no / wrong" right after an action is a rating, not a new command.
      if (awaitingRating && (armed || wakeMatch(final))) {
        const t0 = (() => { const w = wakeMatch(final); return w ? final.slice(w.index + w.length) : final; })();
        if (t0.trim().split(/\s+/).length <= 4 && rateByVoice(t0)) { keepTalking(); return; }
      }

      // If KODA is waiting on a clarification, the next thing said resolves it.
      if (pendingCands.length && (armed || wakeMatch(final))) {
        const stripped = (() => { const w = wakeMatch(final); return w ? final.slice(w.index + w.length) : final; })();
        if (resolveByVoice(stripped)) { armedUntil = 0; return; }
      }

      // Follow-up window: they already said the wake word, so this whole utterance is the command.
      if (armed) {
        armedUntil = 0;
        const t = final.trim();
        if (t) { submit(t); return; }
      }
      if (!wakeOn) return;

      const m = wakeMatch(final);
      if (!m) return;                             // ambient chatter: ignore entirely
      const cmd = final.slice(m.index + m.length).replace(/^[\s,.:;-]+/, "").trim();
      setOpen(true);
      if (cmd) { armedUntil = 0; submit(cmd); }
      else {
        // Bare wake word: stay open and keep listening for the next thing they say.
        armedUntil = Date.now() + FOLLOW_MS;
        $("inp").value = "";
        setNote("Listening — go ahead", null);
        $("pill").classList.add("busy");
        const mine = armedUntil;
        setTimeout(() => {
          if (armedUntil !== mine) return;   // a command already arrived
          armedUntil = 0;
          $("pill").classList.remove("busy");
          setNote("Still there — say it again or type", "warn");
        }, FOLLOW_MS);
      }
    };

    $("mic").onclick = () => {
      setOpen(true);
      manual = true;
      if (listening) { try { rec.stop(); } catch (_) {} setTimeout(startRec, 200); }
      else startRec();
    };

    $("wake").onclick = () => {
      wakeOn = !wakeOn;
      if (wakeOn) startRec();
      else if (listening) { try { rec.stop(); } catch (_) {} }
      setNote(wakeOn ? "Listening for “hey KODA”" : "Wake word off — press the mic or type", null);
      paintWake();
    };

    startRec();
    paintWake();
  }
  }
})()
