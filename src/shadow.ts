// Shadow baseline: send the SAME decision to a frontier LLM and measure what it costs.
//
// This is where the "how much faster / cheaper" numbers come from. We do not quote a
// vendor's multiples: we run both models on the identical question and measure.
// Optional — if ANTHROPIC_API_KEY is unset the app behaves exactly as before.
import { bus, type ShadowResult } from "./events.js";
import type { PageSnapshot } from "./browser.js";

const MODEL = process.env.SHADOW_MODEL ?? "claude-sonnet-4-5";
// Fill these from the provider's pricing page to get a cost multiple; tokens and
// latency are measured regardless.
const IN_PER_M = Number(process.env.SHADOW_PRICE_IN_PER_M ?? 0);
const OUT_PER_M = Number(process.env.SHADOW_PRICE_OUT_PER_M ?? 0);

export function shadowEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function buildPrompt(transcript: string, page: PageSnapshot): string {
  const options = page.links.map((l) => `${l.id}\t${l.text}${l.context ? `\t(${l.context})` : ""}`).join("\n");
  return [
    "You are choosing what a browser should do next on a Wikipedia page.",
    "",
    `USER REQUEST: "${transcript}"`,
    "",
    `PAGE TITLE: ${page.title}`,
    `PAGE SUMMARY: ${page.summary}`,
    "",
    "CANDIDATE TARGETS (id, text, context). NONE means nothing here matches:",
    "NONE\tNo link or section on this page matches",
    options,
    "",
    "Pick the single id the user wants, and give a calibrated probability that your pick is correct.",
    "Calibrated means: if you say 0.7, you should be right about 70% of the time.",
  ].join("\n");
}

/** Fire-and-forget: never let the baseline slow down or break the real pipeline. */
export function shadowCompare(runId: string, transcript: string, page: PageSnapshot, jev: { id: string; probability: number; latencyMs: number; inputTokens: number; costUsd: number }) {
  if (!shadowEnabled()) return;
  void run(runId, transcript, page, jev).catch((err) => {
    bus.publish({ type: "shadow", runId, error: err instanceof Error ? err.message : String(err) });
  });
}

async function run(runId: string, transcript: string, page: PageSnapshot, jev: { id: string; probability: number; latencyMs: number; inputTokens: number; costUsd: number }) {
  const tool = {
    name: "pick",
    description: "Return the chosen candidate id and your calibrated confidence.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The candidate id, e.g. L042, S003, or NONE" },
        confidence: { type: "number", description: "Probability in [0,1] that this pick is correct" },
      },
      required: ["id", "confidence"],
    },
  };

  const t0 = performance.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      tools: [tool],
      tool_choice: { type: "tool", name: "pick" },
      messages: [{ role: "user", content: buildPrompt(transcript, page) }],
    }),
  });
  const latencyMs = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 180)}`);

  const body = (await res.json()) as {
    content: { type: string; input?: { id?: string; confidence?: number } }[];
    usage: { input_tokens: number; output_tokens: number };
  };
  const call = body.content.find((c) => c.type === "tool_use")?.input ?? {};
  const inputTokens = body.usage.input_tokens;
  const outputTokens = body.usage.output_tokens;
  const costUsd = (inputTokens * IN_PER_M + outputTokens * OUT_PER_M) / 1_000_000;

  const result: ShadowResult = {
    model: MODEL,
    pickedId: call.id ?? "?",
    confidence: typeof call.confidence === "number" ? call.confidence : NaN,
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd,
    agrees: (call.id ?? "?") === jev.id,
    speedup: jev.latencyMs > 0 ? latencyMs / jev.latencyMs : 0,
    costRatio: jev.costUsd > 0 && costUsd > 0 ? costUsd / jev.costUsd : 0,
  };
  bus.publish({ type: "shadow", runId, result });
}
