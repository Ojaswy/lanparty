/** Rough $/MTok so the scoreboard can show what a run cost. Update as prices change. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Models offered in the dropdown. Haiku 4.5 is priced but not offered: it
 * rejects adaptive thinking / effort / the fallback beta, so it would need its
 * own request shape.
 */
export const SELECTABLE_CLAUDE_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-fable-5-1"];

export const KNOWN_MODELS = Object.keys(PRICES);

/** Per-MTok prices for the OpenAI-compatible provider, overridable via env. */
export function openaiPrices(): { input: number; output: number } {
  return {
    input: Number(process.env.LANPARTY_OPENAI_PRICE_IN ?? 2.5),
    output: Number(process.env.LANPARTY_OPENAI_PRICE_OUT ?? 10),
  };
}

export function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-");
}

export function estimateCostUsd(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
): number {
  const p = isClaudeModel(model) ? (PRICES[model] ?? PRICES["claude-opus-5"]) : openaiPrices();
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const input = usage.input_tokens;
  return (
    (input * p.input + cacheRead * p.input * 0.1 + cacheWrite * p.input * 1.25 + usage.output_tokens * p.output) / 1_000_000
  );
}

/**
 * Ballpark cost of one seat on a ~25-step task, shown next to START so
 * nobody is surprised. Assumes ~8k tokens of screenshot+transcript per step
 * with most of the prefix cached, ~300 output tokens per step. It is an
 * estimate; the scoreboard shows the real number from usage.
 */
export function estimateSeatCostUsd(model: string, steps = 25): number {
  const p = isClaudeModel(model) ? (PRICES[model] ?? PRICES["claude-opus-5"]) : openaiPrices();
  const perStepInput = 2_000; // uncached
  const perStepCached = 6_000; // cache reads
  const perStepOutput = 350;
  const perStep = (perStepInput * p.input + perStepCached * p.input * 0.1 + perStepOutput * p.output) / 1_000_000;
  return perStep * steps;
}
