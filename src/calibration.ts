// Measured calibration: we do not take the model's word for its own confidence.
//
// Every decision is logged with the probability the model assigned to the option it picked.
// Ground truth arrives for free from normal use:
//   - routed to confirm/escalate -> the candidate the human actually picks is the truth
//   - routed to execute          -> the human marks it right or wrong in the dashboard
// From those pairs we compute the reliability curve: when this model says 0.7, how often is
// it actually right? Thresholds are then set from OUR curve, not from a vendor's claim.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DecisionKind = "link" | "query" | "intent";

export interface Prediction {
  runId: string;
  ts: number;
  kind: DecisionKind;
  predictedId: string;
  predictedLabel: string;
  probability: number;
  routing: "execute" | "confirm" | "escalate";
  risk?: string;
  resolved: boolean;
  correct?: boolean;
  /** how the truth arrived: the human confirmed a candidate, or gave explicit feedback */
  via?: "confirm" | "feedback";
}

export interface Bucket {
  lo: number;
  hi: number;
  label: string;
  n: number;
  meanPredicted: number;
  observed: number;
}

export interface CalibrationSummary {
  total: number;
  resolved: number;
  correct: number;
  accuracy: number;
  ece: number;
  brier: number;
  buckets: Bucket[];
  /** accuracy on the most-confident X% of resolved decisions */
  riskCoverage: { coverage: number; accuracy: number; threshold: number }[];
}

const BINS = 5; // 5 bins, not 10: a live demo produces tens of decisions, not thousands

export class Calibration {
  private preds = new Map<string, Prediction>();

  constructor(private file = "data/calibration.json") {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Prediction[];
      for (const p of raw) this.preds.set(p.runId + ":" + p.kind, p);
    } catch {
      /* first run */
    }
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify([...this.preds.values()], null, 2));
    } catch (err) {
      console.warn("calibration: could not persist", err instanceof Error ? err.message : err);
    }
  }

  record(p: Omit<Prediction, "ts" | "resolved">) {
    const key = p.runId + ":" + p.kind;
    if (this.preds.has(key)) return;
    this.preds.set(key, { ...p, ts: Date.now(), resolved: false });
    this.save();
  }

  /** The human picked `chosenId` for this run: that is ground truth for the link/query prediction. */
  resolveByChoice(runId: string, chosenId: string) {
    for (const kind of ["link", "query"] as DecisionKind[]) {
      const p = this.preds.get(runId + ":" + kind);
      if (p && !p.resolved) {
        p.resolved = true;
        p.correct = p.predictedId === chosenId;
        p.via = "confirm";
      }
    }
    this.save();
  }

  /** Explicit thumbs up/down on an executed run. */
  resolveByFeedback(runId: string, correct: boolean) {
    let hit = false;
    for (const kind of ["link", "query", "intent"] as DecisionKind[]) {
      const p = this.preds.get(runId + ":" + kind);
      if (p && !p.resolved) {
        p.resolved = true;
        p.correct = correct;
        p.via = "feedback";
        hit = true;
      }
    }
    if (hit) this.save();
    return hit;
  }

  private resolvedList(): Prediction[] {
    return [...this.preds.values()].filter((p) => p.resolved && typeof p.correct === "boolean");
  }

  summary(): CalibrationSummary {
    const rs = this.resolvedList();
    const n = rs.length;
    const correct = rs.filter((p) => p.correct).length;

    const buckets: Bucket[] = [];
    let ece = 0;
    for (let b = 0; b < BINS; b++) {
      const lo = b / BINS;
      const hi = (b + 1) / BINS;
      const sel = rs.filter((p) => (b === 0 ? p.probability >= lo : p.probability > lo) && p.probability <= hi);
      const meanPredicted = sel.length ? sel.reduce((s, p) => s + p.probability, 0) / sel.length : 0;
      const observed = sel.length ? sel.filter((p) => p.correct).length / sel.length : 0;
      if (sel.length && n) ece += (sel.length / n) * Math.abs(observed - meanPredicted);
      buckets.push({ lo, hi, label: `${lo.toFixed(1)}–${hi.toFixed(1)}`, n: sel.length, meanPredicted, observed });
    }

    const brier = n ? rs.reduce((s, p) => s + (p.probability - (p.correct ? 1 : 0)) ** 2, 0) / n : 0;

    const sorted = [...rs].sort((a, b) => b.probability - a.probability);
    const riskCoverage: CalibrationSummary["riskCoverage"] = [];
    let hits = 0;
    sorted.forEach((p, i) => {
      hits += p.correct ? 1 : 0;
      riskCoverage.push({ coverage: (i + 1) / sorted.length, accuracy: hits / (i + 1), threshold: p.probability });
    });

    return {
      total: this.preds.size,
      resolved: n,
      correct,
      accuracy: n ? correct / n : 0,
      ece,
      brier,
      buckets,
      riskCoverage,
    };
  }

  /** Lowest probability at which observed accuracy still meets `target`, from our own data.
   *  Returns null when there is not enough evidence to claim a threshold — which is the honest answer. */
  suggestThreshold(target: number, minSamples = 8): number | null {
    const rs = this.resolvedList().sort((a, b) => b.probability - a.probability);
    if (rs.length < minSamples) return null;
    let hits = 0;
    let best: number | null = null;
    rs.forEach((p, i) => {
      hits += p.correct ? 1 : 0;
      if (i + 1 >= minSamples && hits / (i + 1) >= target) best = p.probability;
    });
    return best;
  }

  reset() {
    this.preds.clear();
    this.save();
  }
}

export const calibration = new Calibration();
