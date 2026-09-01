/**
 * The Claude brain: the computer-use toolset driving one seat.
 *
 * One loop per seat. Each iteration sends the transcript, executes every
 * computer action Claude returned (in order, stopping at the first failure),
 * and feeds the results back. Screenshots go back as PNG image blocks. The
 * loop ends when Claude stops calling tools, when the step budget is spent,
 * or when the seat is cancelled.
 *
 * Context editing (server-side) keeps the transcript small: old screenshots
 * are cleared once the input grows past a threshold, keeping the last few
 * tool uses intact, so 20 parallel seats don't each drag 25 screenshots along.
 * Assistant turns (including thinking blocks) are never rewritten client-side.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { StepAction } from "../../shared/types.js";
import { estimateCostUsd } from "../pricing.js";
import { HALT_TEXT, OBSERVATION_ONLY, SYSTEM_PROMPT, type AgentOptions, type AgentOutcome } from "./types.js";

function pngBlock(png: Buffer): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } };
}

/** Haiku 4.5 rejects adaptive thinking, effort and the fallback beta. */
function supportsEffort(model: string): boolean {
  return !/haiku/.test(model);
}

export async function runClaudeAgent(client: Anthropic, opts: AgentOptions): Promise<AgentOutcome> {
  const { model, seat, events, signal, gate } = opts;
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const log = (level: "info" | "warn" | "error", text: string) => events?.onLog?.(level, text);

  const tools: Anthropic.Beta.BetaToolUnion[] = [{ type: "computer_toolset_20260801", cache_control: { type: "ephemeral" } }];
  const betas: string[] = ["context-management-2025-06-27"];
  if (supportsEffort(model)) betas.push("server-side-fallback-2026-07-01");

  const first = await seat.screenshot();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: `TASK:\n${opts.instruction}\n\nThe screen is ${seat.width}x${seat.height}. Here is the current screen.` },
        pngBlock(first),
      ],
    },
  ];

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT + (opts.hints ? `\n\nTask notes:\n${opts.hints}` : ""), cache_control: { type: "ephemeral" } },
  ];

  const call = async (maxTokens: number): Promise<Anthropic.Beta.BetaMessage> => {
    events?.onWaiting?.(true);
    const release = await gate?.acquire(signal);
    events?.onWaiting?.(false);
    try {
      return await client.beta.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system,
          tools,
          messages,
          // Cache the prefix (system + tools + the stable head of the transcript):
          // 20 seats re-send near-identical context every step.
          cache_control: { type: "ephemeral" },
          betas,
          // If a safety classifier declines a turn, let the API re-run it on a
          // fallback model inside the same call instead of killing the seat.
          ...(supportsEffort(model) ? { fallbacks: "default" as const } : {}),
          context_management: {
            edits: [
              {
                type: "clear_tool_uses_20250919",
                trigger: { type: "input_tokens", value: 36_000 },
                keep: { type: "tool_uses", value: 6 },
                clear_tool_inputs: false,
              },
            ],
          },
          ...(opts.effort && supportsEffort(model) ? { output_config: { effort: opts.effort } } : {}),
        },
        { signal },
      );
    } finally {
      release?.();
    }
  };

  let steps = 0;
  let finalText = "";

  for (let iteration = 0; iteration < opts.maxSteps + 5; iteration++) {
    if (signal?.aborted) return { reason: "cancelled", finalText, steps, usage };

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await call(4096);
    } catch (err) {
      if (signal?.aborted) return { reason: "cancelled", finalText, steps, usage };
      const message = err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : (err as Error).message;
      log("error", `model call failed: ${message}`);
      return { reason: "error", finalText, steps, usage, error: message };
    }

    usage.inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += response.usage.output_tokens;
    usage.costUsd += estimateCostUsd(model, response.usage);
    events?.onUsage?.({ ...usage });

    const texts = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text.trim()).filter(Boolean);
    if (texts.length) {
      finalText = texts[texts.length - 1];
      events?.onText?.(texts.join(" "));
    }

    if (response.stop_reason === "refusal") {
      log("warn", `model refused: ${response.stop_details?.explanation ?? "no explanation"}`);
      return { reason: "refusal", finalText, steps, usage, error: "model refused" };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });

    if (toolUses.length === 0 || response.stop_reason === "end_turn") {
      const upper = finalText.toUpperCase();
      if (upper.startsWith("GIVE UP")) return { reason: "gave_up", finalText, steps, usage };
      return { reason: "done", finalText, steps, usage };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let failed = false;
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const action: StepAction = { name: tu.name, input };
      const mk = (content: string | Anthropic.Beta.BetaImageBlockParam[], isError?: boolean): Anthropic.Beta.BetaToolResultBlockParam => ({
        type: "tool_result",
        tool_use_id: tu.id,
        toolset_name: "computer",
        content,
        ...(isError ? { is_error: true } : {}),
      });

      if (tu.toolset_name !== "computer" && tu.toolset_name != null) {
        results.push(mk(`Unknown toolset ${tu.toolset_name}`, true));
        continue;
      }
      if (failed) {
        results.push(mk(HALT_TEXT, true));
        continue;
      }
      if (signal?.aborted) {
        results.push(mk("Cancelled", true));
        failed = true;
        continue;
      }

      const observationOnly = OBSERVATION_ONLY.has(tu.name);
      if (!observationOnly && steps >= opts.maxSteps) {
        results.push(mk(`Step budget of ${opts.maxSteps} actions exhausted. Reply with DONE: or GIVE UP: now.`, true));
        failed = true;
        continue;
      }

      const n = observationOnly ? steps : ++steps;
      events?.onAction?.(action, n);
      try {
        if (tu.name === "screenshot") {
          results.push(mk([pngBlock(await seat.screenshot())]));
        } else if (tu.name === "zoom") {
          const region = input.region;
          if (!Array.isArray(region) || region.length !== 4) throw new Error("zoom needs region [x0,y0,x1,y1]");
          results.push(mk([pngBlock(await seat.zoom(region.map(Number) as [number, number, number, number]))]));
        } else {
          const text = await seat.act(action);
          results.push(mk(text ?? "OK"));
        }
        if (!observationOnly) events?.onStep?.({ n, action, url: await seat.url(), target: seat.lastTarget() });
      } catch (err) {
        failed = true;
        const message = (err as Error).message ?? String(err);
        log("warn", `action ${tu.name} failed: ${message}`);
        results.push(mk(`Error: ${message}`, true));
        if (!observationOnly) events?.onStep?.({ n, action, error: message, url: await seat.url().catch(() => undefined), target: seat.lastTarget() });
      }
    }

    messages.push({ role: "user", content: results });

    if (steps >= opts.maxSteps && failed) {
      // Give the model one last turn to declare DONE/GIVE UP, then stop regardless.
      const last = await call(512).catch(() => null);
      if (last) {
        usage.inputTokens += last.usage.input_tokens;
        usage.outputTokens += last.usage.output_tokens;
        usage.costUsd += estimateCostUsd(model, last.usage);
        const t = last.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text.trim()).join(" ");
        if (t) {
          finalText = t;
          events?.onText?.(t);
        }
      }
      return { reason: "max_steps", finalText, steps, usage };
    }
  }
  return { reason: "max_steps", finalText, steps, usage };
}
