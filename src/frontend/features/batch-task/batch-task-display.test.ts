import { expect, it } from "vitest";
import { build_batch_task_summary_display } from "./batch-task-display";

it("摘要随批次组合切换语义，停止时保留同一类别", () => {
  const summary = (kind: "translation" | "request" | "mixed", stopping = false) =>
    build_batch_task_summary_display({ kind, stopping }, 12, (key) => key).status_text;
  expect(summary("translation")).toBe("batch_translation.summary.translation.running");
  expect(summary("request")).toBe("batch_translation.summary.request.running");
  expect(summary("mixed", true)).toBe("batch_translation.summary.mixed.stopping");
});
