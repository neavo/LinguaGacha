import { expect, it } from "vitest";
import {
  build_project_translation_stats,
  calculate_completion_percent,
} from "./project-translation-stats";

it("统一成功、跳过、失败与待处理状态的计数和完成率取整", () => {
  const statuses = [
    "PROCESSED",
    "EXCLUDED",
    "RULE_SKIPPED",
    "LANGUAGE_SKIPPED",
    "DUPLICATED",
    "ERROR",
    "NONE",
  ];
  expect(build_project_translation_stats(statuses.map((status) => ({ status })))).toEqual({
    total_items: 7,
    completed_count: 1,
    skipped_count: 4,
    failed_count: 1,
    pending_count: 1,
    completion_percent: 71,
  });
});

it("空工程的完成率为零", () => {
  expect(build_project_translation_stats([]).completion_percent).toBe(0);
});

it("仍有待处理对象时最高为 99%，成功与跳过覆盖全部对象才为 100%", () => {
  expect(calculate_completion_percent(201, 199, 1)).toBe(99);
  expect(calculate_completion_percent(201, 199, 2)).toBe(100);
});
