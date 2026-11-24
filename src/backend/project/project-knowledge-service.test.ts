import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectOperationGate } from "../runtime-operation-gate";
import { ProjectWriteStore } from "./project-write-store";
import { ProjectKnowledgeService } from "./project-knowledge-service";
import { project_knowledge_file } from "./project-knowledge";
import { adapt_project_change } from "./project-write-event-adapter";
import type { AppLanguage } from "../../domain/app-language";

it("工程知识按指纹保存和重置，并仅在实际写入时推进修订", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-knowledge-"));
  const project = path.join(temporary.path, "test.lg");
  const db = new ProjectDatabase("1.0.0");
  try {
    await db.create_project(project);
    const gate = new ProjectOperationGate();
    const writes = new ProjectWriteStore(
      db,
      () => undefined,
      (change) => adapt_project_change(project, change),
    );
    let language: AppLanguage = "EN";
    const settings = { read_app_language: () => language };
    const service = new ProjectKnowledgeService(db, project, writes, gate, settings);
    const template = await service.read();
    expect(template).toEqual(project_knowledge_file(null, "en-US"));
    expect(await db.read_knowledge(project)).toBeNull();
    const created = await service.save({ fp: template.fp, text: "first" });
    expect(created.changes[0]).toMatchObject({
      updatedSections: ["knowledge"],
      sectionRevisions: { knowledge: 1 },
    });
    expect(created.document.text).toBe("first");
    const updated = await service.save({ fp: created.document.fp, text: "second" });
    expect(updated.document.text).toBe("second");
    await expect(service.save({ text: "missing fp" })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    const lease = gate.begin_runtime("batch_translation");
    await expect(service.save({ fp: updated.document.fp, text: "busy" })).rejects.toMatchObject({
      code: "runtime.busy",
    });
    gate.finish_runtime(lease);

    language = "ZH";
    const reset = await service.save({ fp: updated.document.fp, text: null });
    expect(reset.changes[0]).toMatchObject({
      updatedSections: ["knowledge"],
      sectionRevisions: { knowledge: 3 },
    });
    expect(reset.document).toEqual(project_knowledge_file(null, "zh-CN"));
    expect(await db.read_knowledge(project)).toBeNull();

    language = "EN";
    const repeated = await service.save({ fp: reset.document.fp, text: null });
    expect(repeated.changes).toEqual([]);
    expect(repeated.document).toEqual(template);
    expect((await db.get_all_meta(project))["project_runtime_revision.knowledge"]).toBe(3);
  } finally {
    await db.close();
  }
});
