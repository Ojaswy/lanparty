/**
 * Deterministic-first grading. The agent saying "DONE" is not a pass; the
 * success check is. Only `llm_judge` asks a model, and it only sees the final
 * screenshot and the rubric.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SuccessCheck } from "../shared/types.js";
import type { SeatDriver } from "./seats/types.js";

export interface Verdict {
  pass: boolean;
  detail: string;
}

const JudgeSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
});

export async function grade(
  check: SuccessCheck,
  seat: SeatDriver,
  ctx: { seatKey: string; runId: string; client?: Anthropic; model?: string; instruction: string },
): Promise<Verdict> {
  switch (check.type) {
    case "url_contains": {
      const url = (await seat.url()) ?? "";
      const pass = url.includes(check.value);
      return { pass, detail: pass ? `URL contains "${check.value}"` : `URL is ${url || "(unknown)"}; expected it to contain "${check.value}"` };
    }
    case "text_present": {
      const text = await seat.pageText();
      const pass = text.toLowerCase().includes(check.value.toLowerCase());
      return { pass, detail: pass ? `Found "${check.value}" on the page` : `"${check.value}" not found on the final page` };
    }
    case "selector_present": {
      const pass = await seat.hasSelector(check.value);
      return { pass, detail: pass ? `Selector ${check.value} present` : `Selector ${check.value} absent` };
    }
    case "grader_endpoint": {
      const url = check.url.replace("{seat}", encodeURIComponent(ctx.seatKey)).replace("{run}", encodeURIComponent(ctx.runId));
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          const body = (await res.json()) as { pass?: boolean; detail?: string };
          return { pass: Boolean(body.pass), detail: body.detail ?? (body.pass ? "grader: pass" : "grader: fail") };
        } catch (err) {
          if (attempt === 2) return { pass: false, detail: `grader unreachable: ${(err as Error).message}` };
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      return { pass: false, detail: "grader unreachable" };
    }
    case "llm_judge": {
      if (!ctx.client) return { pass: false, detail: "llm_judge needs an Anthropic client" };
      const png = await seat.screenshot();
      const response = await ctx.client.messages.parse({
        model: ctx.model ?? "claude-opus-5",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are grading whether an autonomous agent completed a task, using only its final screenshot.\n\nTASK: ${ctx.instruction}\n\nRUBRIC: ${check.rubric}\n\nBe strict: only pass if the screenshot itself shows the rubric is satisfied.`,
              },
              { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(JudgeSchema) },
      });
      const parsed = response.parsed_output;
      if (!parsed) return { pass: false, detail: "judge returned no verdict" };
      return { pass: parsed.pass, detail: parsed.reason };
    }
  }
}
