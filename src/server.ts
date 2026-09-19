import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { noul } from "@typesafe-ai/sdk";
import { WikiBrowser } from "./browser.js";
import { createClient } from "./jev.js";
import { Pipeline } from "./pipeline.js";
import { bus, type Candidate } from "./events.js";
import { calibration } from "./calibration.js";
import { THRESHOLDS } from "./pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HEADLESS = process.env.HEADLESS === "true";

const client = createClient();
const browser = new WikiBrowser();
const pipeline = new Pipeline(client, browser);

// ---- In-page overlay bridge -------------------------------------------------
// The overlay drives the pipeline, and the pipeline pushes its state back into the page,
// so the whole assistant lives on the site itself. The dashboard stays as the instrument panel.
browser.onCommand = (text) => { void pipeline.handle(text, "voice"); };
browser.onConfirm = (runId, candidateId) => { void pipeline.confirm(runId, candidateId).catch(() => {}); };
browser.onFeedback = (runId, correct) => {
  calibration.resolveByFeedback(runId, correct);
  bus.publish({ type: "calibration", summary: calibration.summary() });
};

// Remember the last decision per run so the "done" card can say how sure it was.
const lastDecision = new Map<string, { top: number; confident: boolean; answer: boolean; bar?: number; barSource?: "measured" | "default" }>();

bus.on("event", (ev) => {
  if (ev.type === "decision") {
    const cands: Candidate[] = (ev.target ?? ev.searchQuery)?.candidates ?? [];
    const top = cands[0]?.probability ?? ev.intentConfidence;
    lastDecision.set(ev.runId, { top, confident: ev.routing === "execute", answer: ev.intent === "answer", bar: ev.bar?.value, barSource: ev.bar?.source });
    const cal = calibration.summary();
    if (ev.routing !== "execute") {
      void browser.pushOverlay({
        phase: "clarify",
        runId: ev.runId,
        intent: ev.intent,
        top,
        escalated: ev.routing === "escalate",
        bar: ev.bar?.value ?? THRESHOLDS.link.execute,
        barSource: ev.bar?.source ?? "default",
        resolved: cal.resolved,
        accuracy: cal.accuracy,
        candidates: cands.map((c) => ({ id: c.id, label: c.label, probability: c.probability })),
      });
    }
  } else if (ev.type === "action" && ev.durationMs > 0) {
    const d = lastDecision.get(ev.runId);
    void browser.pushOverlay({
      phase: "done",
      runId: ev.runId,
      ok: ev.ok,
      description: ev.description,
      top: d?.top,
      confident: Boolean(d?.confident),
      answer: Boolean(d?.answer),
      bar: d?.bar,
      barSource: d?.barSource,
      resolved: calibration.summary().resolved,
      accuracy: calibration.summary().accuracy,
    });
  } else if (ev.type === "error") {
    void browser.pushOverlay({ phase: "error", runId: ev.runId, message: ev.message });
  }
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Live event stream for the dashboard.
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (ev: unknown) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  bus.snapshot().forEach(send);
  send({ type: "calibration", summary: calibration.summary() });
  bus.on("event", send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("event", send);
  });
});

app.post("/command", async (req, res) => {
  const { text, source } = req.body as { text?: string; source?: "voice" | "text" };
  if (!text?.trim()) return res.status(400).json({ error: "text required" });
  const runId = await pipeline.handle(text.trim(), source ?? "text");
  res.json({ runId });
});

app.post("/confirm", async (req, res) => {
  const { runId, candidateId } = req.body as { runId?: string; candidateId?: string };
  if (!runId || !candidateId) return res.status(400).json({ error: "runId and candidateId required" });
  try {
    await pipeline.confirm(runId, candidateId);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/goto", async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url || !/^https:\/\/en\.wikipedia\.org\//.test(url)) return res.status(400).json({ error: "en.wikipedia.org URL required" });
  await browser.goto(url);
  res.json({ ok: true });
});

// Explicit ground truth for a run that executed without asking.
app.post("/feedback", (req, res) => {
  const { runId, correct } = req.body as { runId?: string; correct?: boolean };
  if (!runId || typeof correct !== "boolean") return res.status(400).json({ error: "runId and correct required" });
  const hit = calibration.resolveByFeedback(runId, correct);
  bus.publish({ type: "calibration", summary: calibration.summary() });
  res.json({ ok: hit });
});

app.get("/calibration", (_req, res) => res.json(calibration.summary()));

app.post("/calibration/reset", (_req, res) => {
  calibration.reset();
  bus.publish({ type: "calibration", summary: calibration.summary() });
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true, model: client.defaultModel }));

// The first request to Jev can take much longer than steady state; warm up before the demo starts.
const warm = client
  .systemOne({ state: "warm up", questions: { ok: noul("Is this a warm-up?") } })
  .then(() => console.log("Jev warm-up done"))
  .catch((err: unknown) => console.warn("Jev warm-up failed:", err instanceof Error ? err.message : err));

await Promise.all([browser.start(HEADLESS), warm]);
app.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Model: ${client.defaultModel} · Browser: ${HEADLESS ? "headless" : "headed"}`);
});

process.on("SIGINT", async () => {
  await browser.stop();
  process.exit(0);
});
