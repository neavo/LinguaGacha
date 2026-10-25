import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { create_item } from "../../domain/item";
import { ProjectDatabase } from "../database/database-operations";
import { build_project_committed_change } from "./project-committed-change";

it("规范行增量与修订使用提交快照，不受后续数据库变化影响", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lg-committed-change-"));
  const project = path.join(directory, "project.lg");
  const database = new ProjectDatabase("1.0.0");
  try {
    await database.create_project(project, "test");
    await database.transaction(project, (writer) =>
      writer.set_items(project, [
        create_item({
          id: 1,
          src: "原文",
          dst: "译文",
          status: "PROCESSED",
          file_path: "script.txt",
        }),
      ]),
    );
    const committed = await database.read(project, (database) =>
      build_project_committed_change(
        database,
        {
          projectPath: project,
          source: "test",
          updatedSections: ["items"],
          changedItemIds: [1],
          qualityStatisticsScope: "post_replacement",
        },
        database.get_all_meta(project),
      ),
    );
    await database.transaction(project, (writer) => writer.set_items(project, []));
    await database.transaction(project, (writer) =>
      writer.set_meta(project, "project_runtime_revision.items", 99),
    );
    expect(committed.sectionRevisions.items).toBe(0);
    expect(committed.items).toMatchObject({
      mode: "delta",
      records: [{ item_id: 1, src: "原文", dst: "译文" }],
    });
  } finally {
    await database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it.each(["items", "files", "pdf"] as const)("提交快照只读取实际变化的 %s 分区", async (section) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-commit-sections-"));
  const project = path.join(temp.path, "project.lg");
  const database = new ProjectDatabase("1.0.0");
  try {
    await database.create_project(project, "test");
    await database.transaction(project, (writer) =>
      writer.add_asset(project, "script.txt", Buffer.from("original"), "TXT", null),
    );
    await database.read(project, (reader) => {
      const assets = vi.spyOn(reader, "get_all_asset_records");
      const pdf = vi.spyOn(reader, "read_pdf_summaries");
      const change = build_project_committed_change(
        reader,
        {
          projectPath: project,
          source: "test",
          updatedSections: [section],
          qualityStatisticsScope: "none",
        },
        reader.get_all_meta(project),
      );
      expect(assets).toHaveBeenCalledTimes(section === "files" ? 1 : 0);
      expect(pdf).toHaveBeenCalledTimes(section === "pdf" ? 1 : 0);
      expect(change.files === undefined).toBe(section !== "files");
      expect(change.pdf === undefined).toBe(section !== "pdf");
      if (section === "items") {
        expect(change.items).toEqual({ mode: "full", records: [] });
        expect(change.qualityStatisticsScope).toBe("all");
      }
    });
  } finally {
    await database.close();
  }
});
