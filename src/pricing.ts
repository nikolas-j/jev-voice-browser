// Pricing per model, USD per one million tokens.
// Jev: https://docs.typesafe.ai/models — $0.042 / M input tokens, output tokens free.
export interface Price {
  inputPerM: number;
  outputPerM: number;
}

const PRICES: Record<string, Price> = {
  "jev-1.13.0": { inputPerM: 0.042, outputPerM: 0 },
  "jev-latest": { inputPerM: 0.042, outputPerM: 0 },
  "jev-preview": { inputPerM: 0.042, outputPerM: 0 },
};

export function priceFor(model: string): Price {
  return PRICES[model] ?? PRICES["jev-latest"];
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1_000_000;
}
