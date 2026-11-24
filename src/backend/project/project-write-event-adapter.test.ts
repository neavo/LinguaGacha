import { expect, it } from "vitest";
import { adapt_project_change } from "./project-write-event-adapter";
import type { ProjectCommittedChange } from "./project-committed-change";

it("按工程身份发布提交快照，只投影变化分区并保留工程最高修订", async () => {
  const change: ProjectCommittedChange = {
    projectPath: "project.lg",
    source: "test",
    updatedSections: ["items"],
    sectionRevisions: { items: 2, quality: 9 },
    items: { mode: "full", records: [] },
    qualityStatisticsScope: "all",
  };
  expect(adapt_project_change("fixture", change)).toMatchObject({
    type: "project.changed",
    projectId: "fixture",
    projectRevision: 9,
    sectionRevisions: { items: 2 },
    items: { mode: "full" },
  });
  expect(adapt_project_change("fixture", change)).not.toHaveProperty("sections");
});
