/**
 * The "now do GPT" brain: any OpenAI-compatible chat-completions endpoint
 * (OpenAI, Gemini's compat layer, a local model), driving the same seats with
 * the same action vocabulary as the Claude toolset, so a re-run with another
 * model is an apples-to-apples comparison on identical machines.
 *
 * Plain fetch, no SDK. Configure with OPENAI_API_KEY, OPENAI_BASE_URL
 * (default https://api.openai.com/v1) and OPENAI_MODELS (comma list shown in
 * the dropdown). Screenshots are sent as data-URL images; old screenshots are
 * trimmed client-side since there is no server-side context editing here.
 */
import type { StepAction } from "../../shared/types.js";
import { estimateCostUsd } from "../pricing.js";
import { HALT_TEXT, OBSERVATION_ONLY, SYSTEM_PROMPT, type AgentOptions, type AgentOutcome } from "./types.js";

export interface OpenAICompatConfig {
  apiKey: string;
  baseUrl: string;
  models: string[];
}

type Msg =
  | { role: "system"; content: string }
  | { role: "user"; content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> | string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const COMPUTER_TOOL = {
  type: "function",
  function: {
    name: "computer",
    description:
      "Perform one action on the computer. Actions: screenshot, zoom (region [x0,y0,x1,y1]), left_click, right_click, middle_click, double_click, triple_click (coordinate [x,y], optional text = held modifier keys like 'ctrl'), left_click_drag (start_coordinate, coordinate), mouse_move (coordinate), scroll (coordinate, scroll_direction up|down|left|right, scroll_amount clicks), type (text), key (text = xdotool key name or combo like 'ctrl+s' or 'Return', optional repeat), hold_key (text, duration seconds), wait (duration seconds), cursor_position.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["screenshot", "zoom", "left_click", "right_click", "middle_click", "double_click", "triple_click", "left_click_drag", "mouse_move", "scroll", "type", "key", "hold_key", "wait", "cursor_position"],
        },
        coordinate: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
        start_coordinate: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
        region: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
        text: { type: "string" },
        scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
        scroll_amount: { type: "integer" },
        duration: { type: "number" },
        repeat: { type: "integer" },
      },
      required: ["action"],
    },
  },
} as const;

function img(png: Buffer) {
  return { type: "image_url" as const, image_url: { url: `data:image/png;base64,${png.toString("base64")}` } };
}

/** Keep only the last N images in the transcript; replace older ones with a note. */
function trimImages(messages: Msg[], keep = 3): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if ((m.role === "user" || m.role === "tool") && Array.isArray(m.content)) {
      for (let j = m.content.length - 1; j >= 0; j--) {
        const part = m.content[j];
        if (part.type === "image_url") {
          seen++;
          if (seen > keep) m.content[j] = { type: "text", text: "[earlier screenshot omitted]" };
        }
      }
    }
  }
}

export async function runOpenAICompatAgent(cfg: OpenAICompatConfig, opts: AgentOptions): Promise<AgentOutcome> {
  const { model, seat, events, signal, gate } = opts;
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const log = (level: "info" | "warn" | "error", text: string) => events?.onLog?.(level, text);

  const first = await seat.screenshot();
  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT + (opts.hints ? `\n\nTask notes:\n${opts.hints}` : "") + "\n\nCall the `computer` function for every action. After a group of actions, call it with action=screenshot to verify." },
    {
      role: "user",
      content: [{ type: "text", text: `TASK:\n${opts.instruction}\n\nThe screen is ${seat.width}x${seat.height}. Here is the current screen.` }, img(first)],
    },
  ];

  const call = async (): Promise<{ message: { content: string | null; tool_calls?: ToolCall[] }; usage?: { prompt_tokens: number; completion_tokens: number } }> => {
    events?.onWaiting?.(true);
    const release = await gate?.acquire(signal);
    events?.onWaiting?.(false);
    try {
      trimImages(messages);
      let lastErr: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model, messages, tools: [COMPUTER_TOOL], tool_choice: "auto", max_tokens: 2048 }),
          signal,
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
        const body = (await res.json()) as { choices: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }>; usage?: { prompt_tokens: number; completion_tokens: number } };
        return { message: body.choices[0].message, usage: body.usage };
      }
      throw lastErr instanceof Error ? lastErr : new Error("model call failed");
    } finally {
      release?.();
    }
  };

  let steps = 0;
  let finalText = "";

  for (let iteration = 0; iteration < opts.maxSteps + 5; iteration++) {
    if (signal?.aborted) return { reason: "cancelled", finalText, steps, usage };
    let reply: Awaited<ReturnType<typeof call>>;
    try {
      reply = await call();
    } catch (err) {
      if (signal?.aborted) return { reason: "cancelled", finalText, steps, usage };
      const message = (err as Error).message;
      log("error", `model call failed: ${message}`);
      return { reason: "error", finalText, steps, usage, error: message };
    }
    if (reply.usage) {
      usage.inputTokens += reply.usage.prompt_tokens;
      usage.outputTokens += reply.usage.completion_tokens;
      usage.costUsd += estimateCostUsd(model, { input_tokens: reply.usage.prompt_tokens, output_tokens: reply.usage.completion_tokens });
      events?.onUsage?.({ ...usage });
    }
    const text = (reply.message.content ?? "").trim();
    if (text) {
      finalText = text;
      events?.onText?.(text);
    }
    const calls = reply.message.tool_calls ?? [];
    messages.push({ role: "assistant", content: reply.message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      if (finalText.toUpperCase().startsWith("GIVE UP")) return { reason: "gave_up", finalText, steps, usage };
      return { reason: "done", finalText, steps, usage };
    }

    let failed = false;
    for (const tc of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        /* malformed */
      }
      const name = String(args.action ?? "");
      const { action: _a, ...input } = args;
      const action: StepAction = { name, input };
      const push = (content: string | ReturnType<typeof img>) =>
        messages.push({ role: "tool", tool_call_id: tc.id, content: typeof content === "string" ? content : [content] });

      if (failed) {
        push(HALT_TEXT);
        continue;
      }
      if (tc.function.name !== "computer" || !name) {
        push("Error: unknown tool; call `computer` with an `action`.");
        failed = true;
        continue;
      }
      const observationOnly = OBSERVATION_ONLY.has(name);
      if (!observationOnly && steps >= opts.maxSteps) {
        push(`Step budget of ${opts.maxSteps} actions exhausted. Reply with DONE: or GIVE UP: now.`);
        failed = true;
        continue;
      }
      const n = observationOnly ? steps : ++steps;
      events?.onAction?.(action, n);
      try {
        if (name === "screenshot") push(img(await seat.screenshot()));
        else if (name === "zoom") {
          const region = input.region;
          if (!Array.isArray(region) || region.length !== 4) throw new Error("zoom needs region [x0,y0,x1,y1]");
          push(img(await seat.zoom(region.map(Number) as [number, number, number, number])));
        } else {
          push((await seat.act(action)) ?? "OK");
        }
        if (!observationOnly) events?.onStep?.({ n, action, url: await seat.url(), target: seat.lastTarget() });
      } catch (err) {
        failed = true;
        const message = (err as Error).message ?? String(err);
        log("warn", `action ${name} failed: ${message}`);
        push(`Error: ${message}`);
        if (!observationOnly) events?.onStep?.({ n, action, error: message, url: await seat.url().catch(() => undefined), target: seat.lastTarget() });
      }
    }
    if (steps >= opts.maxSteps && failed) return { reason: "max_steps", finalText, steps, usage };
  }
  return { reason: "max_steps", finalText, steps, usage };
}
