import { expect, it } from "vitest";
import { normalize_project_change_event } from "./desktop-project-change-normalizer";

const base = {
  eventId: "event",
  source: "write",
  projectPath: "project.lg",
  projectRevision: 2,
  updatedSections: ["items"],
  sectionRevisions: { items: 2 },
  qualityStatisticsScope: "post_replacement",
};
it("通知入口接纳规范全量或增量，并隔离 ID 数组", () => {
  const changedIds = [1, 1, 2];
  const event = normalize_project_change_event({ ...base, items: { mode: "delta", changedIds } });
  changedIds.push(3);
  expect(event?.items).toEqual({ mode: "delta", changedIds: [1, 2] });
  expect(event?.qualityStatisticsScope).toBe("post_replacement");
  expect(normalize_project_change_event({ ...base, items: { mode: "full" } })?.items).toEqual({
    mode: "full",
  });
});
it.each([
  { mode: "delta", changedIds: [0] },
  { mode: "delta", changedIds: ["1"] },
  { mode: "delta" },
  { mode: "unknown" },
  undefined,
])("拒绝损坏条目通知 %j", (items) => {
  expect(normalize_project_change_event({ ...base, items })).toBeNull();
});
it("拒绝未知统计范围和缺失身份，非条目通知允许省略条目", () => {
  expect(
    normalize_project_change_event({
      ...base,
      updatedSections: ["files"],
      qualityStatisticsScope: "unknown",
    }),
  ).toBeNull();
  expect(
    normalize_project_change_event({ ...base, eventId: "", updatedSections: ["files"] }),
  ).toBeNull();
  expect(
    normalize_project_change_event({
      ...base,
      updatedSections: ["files"],
      qualityStatisticsScope: "none",
    })?.items,
  ).toBeUndefined();
});
