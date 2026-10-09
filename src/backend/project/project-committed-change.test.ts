import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_item } from "../../domain/item";
import { ProjectDatabase } from "../database/database-operations";
import { build_project_committed_change } from "./project-committed-change";

it("规范行增量与修订使用提交快照，不受后续数据库变化影响", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lg-committed-change-"));
  const project = path.join(directory, "project.lg");
  const database = new ProjectDatabase();
  try {
    database.create_project(project, "test");
    database.set_items(project, [
      create_item({
        id: 1,
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
        file_path: "script.txt",
      }),
    ]);
    const committed = build_project_committed_change(
      database,
      {
        projectPath: project,
        source: "test",
        updatedSections: ["items"],
        changedItemIds: [1],
      },
      database.get_all_meta(project),
    );
    database.set_items(project, []);
    database.set_meta(project, "project_runtime_revision.items", 99);
    expect(committed.sectionRevisions.items).toBe(0);
    expect(committed.items).toMatchObject({
      payloadMode: "canonical-delta",
      changedIds: [1],
      upsert: { "1": { item_id: 1, src: "原文", dst: "译文" } },
    });
    expect(committed.itemRecords).toMatchObject([{ item_id: 1, src: "原文", dst: "译文" }]);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
