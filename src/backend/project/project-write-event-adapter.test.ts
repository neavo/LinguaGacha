import { expect, it } from "vitest";
import { adapt_project_change } from "./project-write-event-adapter";
import { ProjectSessionState } from "./project-session-state";
import type { ProjectCommittedChange } from "./project-committed-change";

it("当前会话发布提交快照，只投影变化分区并保留工程最高修订", async () => {
  const session = new ProjectSessionState();
  const change: ProjectCommittedChange = {
    projectPath: "project.lg",
    source: "test",
    updatedSections: ["items"],
    sectionRevisions: { items: 2, quality: 9 },
    items: { payloadMode: "section-invalidated" },
    sections: {},
  };
  expect(adapt_project_change(session, change)).toBeNull();
  await session.mark_loaded("project.lg");
  expect(adapt_project_change(session, change)).toMatchObject({
    type: "project.changed",
    projectRevision: 9,
    sectionRevisions: { items: 2 },
    items: change.items,
  });
  expect(adapt_project_change(session, change)).not.toHaveProperty("sections");
  await session.mark_loaded("another.lg");
  expect(adapt_project_change(session, change)).toBeNull();
});
