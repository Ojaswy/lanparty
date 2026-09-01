import type { TaskDef } from "../shared/types.js";

/**
 * Built-in task cards. `{portal}` is replaced with the public preview URL of
 * the sandbox-hosted insurance portal; `{seat}` with the seat key so every
 * seat has its own grader state.
 */
export const TASKS: TaskDef[] = [
  {
    id: "denial-appeal",
    name: "FILE THE APPEAL",
    blurb: "A 1998 insurance portal denied claim CLM-2026-004471. Read the letter, file the appeal, cite the auth number, survive the traps.",
    kind: "browser",
    startUrl: "{portal}/?seat={seat}",
    instruction:
      "You are a billing specialist at Lakeside Orthopedic Associates. The Meridian Mutual provider portal shows a denial letter for claim CLM-2026-004471. File an appeal for this claim through the portal: dismiss any notice, start the appeal, enter the claim number and the patient's date of birth exactly as printed on the letter, choose the appeal reason that matches the situation described in the letter's provider notes, write a justification that cites the authorization number from the letter, attest that records are attached, review, and SUBMIT the appeal (not save a draft, not cancel). The task is complete only when the portal shows an appeal reference number.",
    successCheck: { type: "grader_endpoint", url: "{portal}/state/{seat}" },
    maxSteps: 30,
    needsPortal: true,
    tags: ["pinetree", "forms", "traps"],
  },
  {
    id: "saucedemo-checkout",
    name: "BUY THE BACKPACK",
    blurb: "Log in to the Sauce Labs demo store, buy the backpack, finish checkout. Real site, real forms.",
    kind: "browser",
    startUrl: "https://www.saucedemo.com/",
    instruction:
      "Log in to this demo store with username standard_user and password secret_sauce. Add the 'Sauce Labs Backpack' to the cart, open the cart, click Checkout, enter first name Ada, last name Lovelace, postal code 10115, continue, and finish the order. The task is complete when the page says 'Thank you for your order!'.",
    successCheck: { type: "text_present", value: "Thank you for your order" },
    maxSteps: 25,
    tags: ["real site", "e-commerce"],
  },
  {
    id: "wiki-navigate",
    name: "FIND THE YEAR",
    blurb: "Open Wikipedia, find when the first LAN party era classic 'Counter-Strike' was first released, and land on its article.",
    kind: "browser",
    startUrl: "https://en.wikipedia.org/wiki/Main_Page",
    instruction:
      "Using only the on-screen Wikipedia interface (no URL typing), search for the video game Counter-Strike (the original 2000 game), open its article, and make sure the article page for the original Counter-Strike game is showing. The task is complete when you are on that article.",
    successCheck: { type: "url_contains", value: "/wiki/Counter-Strike" },
    maxSteps: 15,
    tags: ["real site", "navigation"],
  },
  {
    id: "todo-add",
    name: "THREE TODOS",
    blurb: "The classic TodoMVC app. Add three items, complete one. Simple, but agents still fumble it.",
    kind: "browser",
    startUrl: "https://demo.playwright.dev/todomvc/",
    instruction:
      "Add exactly three todo items in this order: 'buy pizza', 'set up the LAN', 'frag noobs'. Then mark 'set up the LAN' as completed (click its checkbox). Do not delete anything. The task is complete when three items exist and only 'set up the LAN' is completed.",
    successCheck: { type: "llm_judge", rubric: "Three todo items are visible: 'buy pizza', 'set up the LAN', 'frag noobs'. Only 'set up the LAN' shows as completed (checked / struck through). The footer says '2 items left' (or equivalent)." },
    maxSteps: 15,
    tags: ["real site", "judge"],
  },
  {
    id: "libreoffice-sum",
    name: "SUM IT UP (DESKTOP)",
    blurb: "A real Ubuntu desktop. Open LibreOffice Calc, type three numbers, put their sum below, save as sum.ods.",
    kind: "desktop",
    openApp: { name: "libreoffice", args: ["--calc", "--norestore"] },
    instruction:
      "LibreOffice Calc is opening on this desktop. In cells A1, A2 and A3 type the numbers 12, 30 and 58. In cell A4 enter a formula that sums A1:A3 (it should display 100). Then save the spreadsheet with Ctrl+S as 'sum' in the default folder, keep the ODF format if asked. The task is complete when the file is saved.",
    successCheck: { type: "llm_judge", rubric: "A spreadsheet shows 12, 30, 58 in A1:A3 and 100 in A4, and the window title or a dialog indicates it was saved as sum.ods (or the save dialog has been completed)." },
    maxSteps: 25,
    desktopTemplate: "default",
    tags: ["desktop", "office"],
  },
];

export function findTask(id: string): TaskDef | undefined {
  return TASKS.find((t) => t.id === id);
}
