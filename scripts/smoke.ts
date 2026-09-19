// End-to-end check without the dashboard: runs commands through the full pipeline (Jev decides,
// Playwright executes) and prints every event. Usage: npm run smoke -- "command one" "command two"
import "dotenv/config";
import { WikiBrowser } from "../src/browser.js";
import { createClient } from "../src/jev.js";
import { Pipeline } from "../src/pipeline.js";
import { bus, type JevEvent } from "../src/events.js";

const commands = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["open the page about the industrial revolution", "jump to the causes section", "search for Ada Lovelace", "scroll down a bit", "go back"];

const client = createClient();
const browser = new WikiBrowser();
await browser.start(process.env.HEADLESS !== "false", "https://en.wikipedia.org/wiki/Steam_engine");
const pipeline = new Pipeline(client, browser);

bus.on("event", (ev: JevEvent) => {
  switch (ev.type) {
    case "page":
      return console.log(`  page: ${ev.title} · ${ev.linkCount} candidates · extract ${ev.extractMs} ms`);
    case "model_call": {
      const c = ev.call;
      return console.log(`  [${c.model}] ${c.purpose}\n     ${c.questionCount} q · ${c.candidateCount} options · ${c.inputTokens} in / ${c.outputTokens} out · $${c.costUsd.toFixed(6)} · ${c.latencyMs} ms`);
    }
    case "decision": {
      const top = (ev.target ?? ev.searchQuery)?.candidates.slice(0, 3).map((c) => `“${c.label}” ${(c.probability * 100).toFixed(0)}%`).join(" | ");
      return console.log(`  decision: ${ev.intent} (${(ev.intentConfidence * 100).toFixed(0)}%) → ${ev.routing} · goal_satisfied ${(ev.goalSatisfied * 100).toFixed(0)}%${top ? `\n     ${top}` : ""}`);
    }
    case "action":
      return console.log(`  action: ${ev.ok ? "✔" : "✖"} ${ev.description}${ev.detail ? ` (${ev.detail})` : ""} ${ev.durationMs ? `· ${ev.durationMs} ms` : ""}`);
    case "run_done":
      return console.log(`  done: ${ev.totalMs} ms end-to-end · $${ev.totalCostUsd.toFixed(6)}`);
    case "error":
      return console.log(`  ERROR: ${ev.message}`);
    case "totals":
      return;
  }
});

for (const text of commands) {
  console.log(`\n> "${text}"`);
  await pipeline.handle(text, "text");
}
const t = bus.totals;
console.log(`\nTotals: ${t.runs} runs · ${t.calls} calls · ${t.inputTokens} input tokens · $${t.costUsd.toFixed(6)} · model ${t.modelMs} ms · wall ${t.wallMs} ms`);
await browser.stop();
