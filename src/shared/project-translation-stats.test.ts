import { expect, it } from "vitest";
import { build_project_translation_stats } from "./project-translation-stats";

it("统一成功、跳过与待处理状态的计数和完成率取整", () => {
  const statuses = [
    "PROCESSED",
    "EXCLUDED",
    "RULE_SKIPPED",
    "LANGUAGE_SKIPPED",
    "DUPLICATED",
    "NONE",
  ];
  expect(build_project_translation_stats(statuses.map((status) => ({ status })))).toEqual({
    total_items: 6,
    completed_count: 1,
    skipped_count: 4,
    pending_count: 1,
    completion_percent: 83,
  });
});

it("空工程的完成率为零", () => {
  expect(build_project_translation_stats([]).completion_percent).toBe(0);
});

it("仍有待处理对象时最高为 99%，成功与跳过覆盖全部对象才为 100%", () => {
  const nearly_done = [
    ...Array.from({ length: 199 }, () => ({ status: "PROCESSED" })),
    { status: "EXCLUDED" },
    { status: "NONE" },
  ];
  expect(build_project_translation_stats(nearly_done).completion_percent).toBe(99);
  expect(
    build_project_translation_stats([...nearly_done.slice(0, -1), { status: "EXCLUDED" }])
      .completion_percent,
  ).toBe(100);
});
