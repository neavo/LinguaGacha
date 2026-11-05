import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../database/database-operations";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "./project-session-state";
import { ProjectWriteStore } from "./project-write-store";
import { ProjectKnowledgeService } from "./project-knowledge-service";
import { project_knowledge_file } from "./project-knowledge";
import { adapt_project_change } from "./project-write-event-adapter";

it("旧工程读取时补模板，首次保存才落盘，之后按指纹保存并发布分区事件", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-knowledge-"));
  const project = path.join(temporary.path, "test.lg");
  const db = new ProjectDatabase("1.0.0");
  try {
    await db.create_project(project);
    const session = new ProjectSessionState();
    await session.mark_loaded(project);
    const gate = new RuntimeOperationGate();
    const writes = new ProjectWriteStore(
      db,
      () => undefined,
      (change) => adapt_project_change(session, change),
    );
    const service = new ProjectKnowledgeService(db, session, writes, gate, {
      read_app_language: () => "EN",
    });
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
    await expect(service.save({ fp: created.document.fp, text: "stale" })).rejects.toMatchObject({
      code: "data.revision_conflict",
    });
    await expect(service.save({ text: "missing fp" })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    const lease = gate.begin_runtime("agent");
    await expect(service.save({ fp: updated.document.fp, text: "busy" })).rejects.toMatchObject({
      code: "runtime.busy",
    });
    gate.finish_runtime(lease);
    expect((await service.read()).text).toBe("second");
  } finally {
    await db.close();
  }
});
