import { describe, expect, it } from "vitest";

import { resolve_task_terminal_transition } from "./terminal-prompt-suppression";

const is_active_status = (status: string): boolean =>
  status === "requested" || status === "running" || status === "stopping";

describe("resolve_task_terminal_transition", () => {
  it.each([
    {
      previous_status: "running",
      next_status: "done",
      has_result: true,
      expected: { feedback: "done", prompt_boundary: true },
    },
    {
      previous_status: "stopping",
      next_status: "idle",
      has_result: true,
      expected: { feedback: "stopped", prompt_boundary: true },
    },
    {
      previous_status: "idle",
      next_status: "done",
      has_result: true,
      expected: { feedback: null, prompt_boundary: false },
    },
    {
      previous_status: "running",
      next_status: "idle",
      has_result: false,
      expected: { feedback: null, prompt_boundary: true },
    },
  ])(
    "$previous_status → $next_status 解析一次终态反馈",
    ({ previous_status, next_status, has_result, expected }) => {
      expect(
        resolve_task_terminal_transition({
          previous_status,
          next_status,
          has_result,
          is_active_status,
        }),
      ).toEqual(expected);
    },
  );
});
