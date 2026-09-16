import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { MigrationOrchestrator } from "../migration-orchestrator";
import { project_schema_migration } from "./project-schema-migration";
import { pdf_section_kind_migration } from "./pdf-section-kind-migration";

it("旧 PDF 译稿在打开事务中迁移一次，保留正文、核对信息和当前段", () => {
  using db = new DatabaseSync(":memory:");
  project_schema_migration.run_project_database_schema!({ db });
  const translation = {
    sections: [
      { page_start: 1, page_end: 2, markdown: "旧正文" },
      { kind: "omit", page_start: 3, page_end: 3, reason: "空页" },
    ],
    reviewed_pages: [1],
    notes: "待继续",
  };
  const put = db.prepare("INSERT INTO pdf_documents VALUES (?, ?)");
  put.run("book.pdf", JSON.stringify({ source: { digest: "source" }, translation }));
  put.run("original.pdf", JSON.stringify({ translation: null }));
  const orchestrator = new MigrationOrchestrator([pdf_section_kind_migration]);
  orchestrator.run_project_database_migrations(db);
  const first = db.prepare("SELECT * FROM pdf_documents ORDER BY file_path").all();
  expect(JSON.parse(String(first[0]!["data"]))).toEqual({
    source: { digest: "source" },
    translation: {
      ...translation,
      sections: [{ ...translation.sections[0], kind: "translate" }, translation.sections[1]],
    },
  });
  expect(JSON.parse(String(first[1]!["data"]))).toEqual({ translation: null });
  orchestrator.run_project_database_migrations(db);
  expect(db.prepare("SELECT * FROM pdf_documents ORDER BY file_path").all()).toEqual(first);
});
