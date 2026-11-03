import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../database/database-operations";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "./project-session-state";
import { ProjectWriteStore } from "./project-write-store";
import { ProjectKnowledgeService } from "./project-knowledge-service";
import { adapt_project_change } from "./project-write-event-adapter";

it("知识接口按单篇指纹保存并发布分区事件，运行占用拒绝写入", async () => {
  using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-knowledge-"));
  const project = path.join(temporary.path, "test.lg");
  const db = new ProjectDatabase("1.0.0");
  try {
    await db.create_project(project, "test");
    const session = new ProjectSessionState();
    await session.mark_loaded(project);
    const gate = new RuntimeOperationGate();
    const writes = new ProjectWriteStore(
      db,
      () => undefined,
      (change) => adapt_project_change(session, change),
    );
    const service = new ProjectKnowledgeService(db, session, writes, gate);
    const created = await service.save({ path: "a.md", text: "first" });
    expect(created.changes[0]).toMatchObject({
      updatedSections: ["knowledge"],
      sectionRevisions: { knowledge: 1 },
    });
    await service.save({ path: "b.md", text: "unrelated" });
    const updated = await service.save({ path: "a.md", text: "second", fp: created.document.fp });
    expect(updated.document.text).toBe("second");
    expect(await service.list()).toEqual([
      { path: "a.md", fp: updated.document.fp },
      { path: "b.md", fp: expect.any(String) },
    ]);
    await expect(
      service.save({ path: "a.md", text: "stale", fp: created.document.fp }),
    ).rejects.toMatchObject({ code: "data.revision_conflict" });
    await expect(service.save({ path: "A.md", text: "collision" })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    const lease = gate.begin_runtime("agent");
    await expect(service.delete({ path: "a.md", fp: updated.document.fp })).rejects.toMatchObject({
      code: "runtime.busy",
    });
    expect((await service.read({ path: "a.md" })).text).toBe("second");
    gate.finish_runtime(lease);
    await service.delete({ path: "a.md", fp: updated.document.fp });
    await expect(
      service.save({ path: "a.md", text: "stale", fp: updated.document.fp }),
    ).rejects.toMatchObject({ code: "data.revision_conflict" });
    await expect(service.read({ path: "a.md" })).rejects.toMatchObject({ code: "file.not_found" });
  } finally {
    await db.close();
  }
});
