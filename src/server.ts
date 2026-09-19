import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { noul } from "@typesafe-ai/sdk";
import { WikiBrowser } from "./browser.js";
import { createClient } from "./jev.js";
import { Pipeline } from "./pipeline.js";
import { bus } from "./events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HEADLESS = process.env.HEADLESS === "true";

const client = createClient();
const browser = new WikiBrowser();
const pipeline = new Pipeline(client, browser);

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
