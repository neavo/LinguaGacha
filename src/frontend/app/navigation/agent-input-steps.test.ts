import { expect, it } from "vitest";
import { format_agent_input_steps, format_agent_path_request } from "./agent-input-steps";

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

it("路径草稿没有路径时选中占位行，有路径时逐行填入且不设选区", () => {
  const empty = format_agent_path_request((key) => key, "导入：", [], "后续");
  expect(empty.text).toBe("导入：\napp.agent_input.path_placeholder\n\n后续");
  expect(empty.text.slice(empty.selection!.from, empty.selection!.to)).toBe(
    "app.agent_input.path_placeholder",
  );
  expect(format_agent_path_request((key) => key, "导入：", ["a", "b"], "后续")).toEqual({
    text: "导入：\na\nb\n\n后续",
  });
});
