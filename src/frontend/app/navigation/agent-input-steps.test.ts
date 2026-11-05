import { expect, it } from "vitest";
import { format_agent_input_steps } from "./agent-input-steps";

it("多步骤预置指令统一前缀、编号与技能引用", () => {
  expect(
    format_agent_input_steps(
      (key) => key,
      [
        { label_key: "app.action.confirm", skill: "test-first" },
        { label_key: "app.action.cancel", skill: "test-second" },
      ],
    ),
  ).toBe(
    'app.agent_input.steps_intro\n1. app.action.confirm @skill("test-first")\n2. app.action.cancel @skill("test-second")',
  );
});
