// Event log shared by the pipeline, server, and dashboard.
import { EventEmitter } from "node:events";

export type Intent =
  | "click_link"
  | "search"
  | "scroll_down"
  | "scroll_up"
  | "go_back"
  | "unclear";

export interface ModelCall {
  id: string;
  model: string;
  purpose: string;
  questionCount: number;
  candidateCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  requestId?: string;
}

export interface Candidate {
  id: string;
  label: string;
  probability: number;
  href?: string;
}

export type JevEvent =
  | { type: "transcript"; runId: string; text: string; source: "voice" | "text" }
  | { type: "page"; runId: string; title: string; url: string; linkCount: number; extractMs: number }
  | { type: "model_call"; runId: string; call: ModelCall }
  | {
      type: "decision";
      runId: string;
      intent: Intent;
      intentProbabilities: Record<string, number>;
      intentConfidence: number;
      goalSatisfied: number;
      target?: { candidates: Candidate[]; confidence: number };
      searchQuery?: { candidates: Candidate[]; confidence: number };
      routing: "execute" | "confirm" | "escalate";
    }
  | { type: "action"; runId: string; description: string; durationMs: number; ok: boolean; detail?: string }
  | { type: "run_done"; runId: string; totalMs: number; totalCostUsd: number }
  | { type: "error"; runId: string; message: string }
  | { type: "totals"; runs: number; calls: number; inputTokens: number; costUsd: number; modelMs: number; wallMs: number };

export class EventBus extends EventEmitter {
  private history: JevEvent[] = [];
  totals = { runs: 0, calls: 0, inputTokens: 0, costUsd: 0, modelMs: 0, wallMs: 0 };

  publish(ev: JevEvent) {
    if (ev.type === "model_call") {
      this.totals.calls += 1;
      this.totals.inputTokens += ev.call.inputTokens;
      this.totals.costUsd += ev.call.costUsd;
      this.totals.modelMs += ev.call.latencyMs;
    }
    if (ev.type === "run_done") {
      this.totals.runs += 1;
      this.totals.wallMs += ev.totalMs;
    }
    this.history.push(ev);
    if (this.history.length > 500) this.history.shift();
    this.emit("event", ev);
    if (ev.type === "model_call" || ev.type === "run_done") {
      const t: JevEvent = { type: "totals", ...this.totals };
      this.emit("event", t);
    }
  }

  snapshot(): JevEvent[] {
    return [...this.history, { type: "totals", ...this.totals }];
  }
}

export const bus = new EventBus();
