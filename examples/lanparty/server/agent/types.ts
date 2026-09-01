import type { StepAction } from "../../shared/types.js";
import type { SeatDriver } from "../seats/types.js";
import type { Semaphore } from "../util.js";

export interface AgentEvents {
  /** Fired before an action executes. */
  onAction?: (action: StepAction, n: number) => void;
  /** Fired after an action executed (or failed). */
  onStep?: (step: { n: number; action: StepAction; error?: string; url?: string; target?: string }) => void;
  /** The model's text (its "thought bubble"). */
  onText?: (text: string) => void;
  onUsage?: (usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
  onLog?: (level: "info" | "warn" | "error", text: string) => void;
  /** Fired while the seat is waiting for a free model slot (rate-limit gate). */
  onWaiting?: (waiting: boolean) => void;
}

export interface AgentOptions {
  model: string;
  seat: SeatDriver;
  instruction: string;
  /** Extra task-specific guidance appended to the system prompt. */
  hints?: string;
  maxSteps: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  signal?: AbortSignal;
  events?: AgentEvents;
  /** Gate on concurrent model calls so 20 seats don't 429 each other. */
  gate?: Semaphore;
}

export interface AgentOutcome {
  /** How the loop ended. */
  reason: "done" | "gave_up" | "max_steps" | "cancelled" | "error" | "refusal";
  finalText: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  error?: string;
}

export const SYSTEM_PROMPT = `You are an autonomous computer-use agent sitting at one of several identical machines in a reliability test. There is no human to ask; complete the task exactly as instructed, then stop.

Rules:
- Look before you act: start from the screenshot you are given, and end each group of actions with a screenshot so you can verify the result before continuing.
- Prefer keyboard shortcuts for tricky widgets (dropdowns, scrollbars). Native <select> menus can be driven by clicking them and typing the option text.
- If the page needs scrolling to reveal a button, scroll. Read dialogs and banners carefully; some buttons look primary but are not what you want.
- Never enter real credentials or payment details. Only use information that appears in the task or on screen.
- When you are confident the task is complete, reply with a one-line message starting with "DONE:" and do not call any tool.
- If the task is genuinely impossible, reply with a one-line message starting with "GIVE UP:" and the reason, and do not call any tool.`;

export const HALT_TEXT = "Not executed: an earlier computer action in this turn failed.";

export const OBSERVATION_ONLY = new Set(["screenshot", "zoom", "cursor_position"]);
