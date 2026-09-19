// Orchestration: transcript -> page snapshot -> one Jev request -> confidence routing -> browser action.
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { WikiBrowser, type PageLink, type PageSnapshot } from "./browser.js";
import { bus, type Candidate, type Intent } from "./events.js";
import { decide, topK, NO_LINK } from "./jev.js";

// Thresholds on the top probability of the chosen candidate. Tune on real usage.
export const THRESHOLDS = {
  link: { execute: 0.55, confirm: 0.15 },
  query: { execute: 0.35, confirm: 0.1 },
};

interface Pending {
  runId: string;
  page: PageSnapshot;
  intent: Intent;
  startedAt: number;
}

export class Pipeline {
  private pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private client: TypeSafeClient, private browser: WikiBrowser) {}

  async handle(transcript: string, source: "voice" | "text"): Promise<string> {
    const runId = `run-${Date.now().toString(36)}-${++this.seq}`;
    const startedAt = performance.now();
    bus.publish({ type: "transcript", runId, text: transcript, source });

    try {
      const page = await this.browser.snapshot();
      bus.publish({ type: "page", runId, title: page.title, url: page.url, linkCount: page.links.length, extractMs: page.extractMs });

      const d = await decide(this.client, runId, transcript, page);
      const intent = d.intent.choice as Intent;
      const goal = d.goalSatisfied;

      const linkTop = topK(d.targetLink.probabilities, 5);
      const linkCandidates: Candidate[] = linkTop.map((c) => {
        const l = page.links.find((x) => x.id === c.id);
        return { id: c.id, label: c.id === NO_LINK ? "No matching link" : `${l?.text ?? c.id}`, probability: c.probability, href: l?.href };
      });
      const queryTop = topK(d.searchQuery.probabilities, 5);
      const queryCandidates: Candidate[] = queryTop.map((c) => ({ id: c.id, label: c.id, probability: c.probability }));

      // Confidence routing: code decides what a probability means for this action.
      let routing: "execute" | "confirm" | "escalate" = "execute";
      if (intent === "click_link") {
        const best = linkTop[0];
        if (!best || best.id === NO_LINK || best.probability < THRESHOLDS.link.confirm) routing = "escalate";
        else if (best.probability < THRESHOLDS.link.execute) routing = "confirm";
      } else if (intent === "search") {
        const best = queryTop[0];
        if (!best || best.probability < THRESHOLDS.query.confirm) routing = "escalate";
        else if (best.probability < THRESHOLDS.query.execute) routing = "confirm";
      } else if (intent === "unclear") {
        routing = "escalate";
      }

      bus.publish({
        type: "decision",
        runId,
        intent,
        intentProbabilities: d.intent.probabilities,
        intentConfidence: d.intent.confidence,
        goalSatisfied: goal,
        target: intent === "click_link" ? { candidates: linkCandidates, confidence: d.targetLink.confidence } : undefined,
        searchQuery: intent === "search" ? { candidates: queryCandidates, confidence: d.searchQuery.confidence } : undefined,
        routing,
      });

      if (routing === "execute") {
        await this.execute(runId, page, intent, linkTop[0]?.id, queryTop[0]?.id);
        this.finish(runId, startedAt);
      } else {
        this.pending.set(runId, { runId, page, intent, startedAt });
        bus.publish({
          type: "action",
          runId,
          description: routing === "confirm" ? "Waiting for confirmation of the highlighted candidate" : "Nothing matched confidently — pick a candidate or rephrase",
          durationMs: 0,
          ok: routing === "confirm",
        });
      }
    } catch (err) {
      bus.publish({ type: "error", runId, message: err instanceof Error ? err.message : String(err) });
      this.finish(runId, startedAt);
    }
    return runId;
  }

  /** Dashboard confirmation of a candidate for a run that was routed to confirm/escalate. */
  async confirm(runId: string, candidateId: string) {
    const p = this.pending.get(runId);
    if (!p) throw new Error(`No pending run ${runId}`);
    this.pending.delete(runId);
    if (p.intent === "click_link") await this.execute(runId, p.page, "click_link", candidateId, undefined);
    else if (p.intent === "search") await this.execute(runId, p.page, "search", undefined, candidateId);
    else await this.execute(runId, p.page, p.intent, undefined, undefined);
    this.finish(runId, p.startedAt);
  }

  private async execute(runId: string, page: PageSnapshot, intent: Intent, linkId?: string, query?: string) {
    const t0 = performance.now();
    let description = "";
    let ok = true;
    let detail: string | undefined;
    try {
      switch (intent) {
        case "click_link": {
          const link: PageLink | undefined = page.links.find((l) => l.id === linkId);
          if (!link) throw new Error(`Link ${linkId} not on page`);
          description = link.href.startsWith("#") ? `Jump to section “${link.text}”` : `Open “${link.text}”`;
          detail = link.href;
          await this.browser.clickLink(link);
          break;
        }
        case "search":
          if (!query) throw new Error("No search query");
          description = `Search Wikipedia for “${query}”`;
          await this.browser.search(query);
          break;
        case "scroll_down":
          description = "Scroll down";
          await this.browser.scroll("down");
          break;
        case "scroll_up":
          description = "Scroll up";
          await this.browser.scroll("up");
          break;
        case "go_back":
          description = "Go back";
          await this.browser.back();
          break;
        default:
          description = "No action (request unclear)";
          ok = false;
      }
    } catch (err) {
      ok = false;
      detail = err instanceof Error ? err.message : String(err);
      description ||= "Action failed";
    }
    bus.publish({ type: "action", runId, description, durationMs: Math.round(performance.now() - t0), ok, detail });
  }

  private finish(runId: string, startedAt: number) {
    const totalCostUsd = bus
      .snapshot()
      .reduce((s, e) => (e.type === "model_call" && e.runId === runId ? s + e.call.costUsd : s), 0);
    bus.publish({ type: "run_done", runId, totalMs: Math.round(performance.now() - startedAt), totalCostUsd });
  }
}
