import type { JsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type {
  KnowledgeEntry,
  KnowledgeFile,
  KnowledgeIntent,
} from "../../shared/project-knowledge";
import type { ProjectWriteResult } from "../../shared/project-event";
import type { ProjectDatabase } from "../database/database-operations";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import type { ProjectSessionState } from "./project-session-state";
import type { ProjectWriteStore } from "./project-write-store";
import {
  normalize_knowledge_path,
  project_knowledge_entry,
  project_knowledge_fingerprint,
} from "./project-knowledge";

/** 工程知识按需读取，写入复用工程互斥和唯一事务入口。 */
export class ProjectKnowledgeService {
  /** 复用当前工程会话、写入管线和运行占用。 */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly session: ProjectSessionState,
    private readonly writes: ProjectWriteStore,
    private readonly gate: RuntimeOperationGate,
  ) {}

  /** 列表按需读取数据库，不持有页面之外的知识缓存。 */
  public list(): Promise<KnowledgeEntry[]> {
    const project = this.session.require_loaded_project_path();
    return this.database.read(project, (db) =>
      db.list_knowledge(project).map(project_knowledge_entry),
    );
  }

  /** 路径比较忽略大小写，回包保留持久化路径和当前指纹。 */
  public async read(request: JsonRecord): Promise<KnowledgeFile> {
    const path = this.read_path(request);
    const project = this.session.require_loaded_project_path();
    return this.database.read(project, (db) => {
      const document = db
        .list_knowledge(project)
        .find((doc) => doc.path.toLowerCase() === path.toLowerCase());
      if (!document) throw new AppError("file.not_found");
      return { ...document, fp: project_knowledge_fingerprint(document.path, document.text) };
    });
  }

  /** 缺省指纹表示新建，已有文档必须通过指纹校验。 */
  public save(request: JsonRecord): Promise<ProjectWriteResult & { document: KnowledgeFile }> {
    return this.gate.run_project_write(async () => {
      const path = this.read_path(request);
      if (
        typeof request.text !== "string" ||
        (request.fp !== undefined && typeof request.fp !== "string")
      )
        throw new AppError("request.validation_failed");
      const intent: KnowledgeIntent =
        typeof request.fp === "string"
          ? { op: "update", line: 1, path, text: request.text, fp: request.fp }
          : { op: "create", line: 1, path, text: request.text };
      const write = await this.writes.apply_knowledge_changes({
        projectPath: this.session.require_loaded_project_path(),
        intents: [intent],
      });
      return { ...write, document: await this.read({ path }) };
    });
  }

  /** 删除与保存共用工程互斥，防止覆盖运行任务的事实。 */
  public delete(request: JsonRecord): Promise<ProjectWriteResult> {
    return this.gate.run_project_write(() => {
      const path = this.read_path(request);
      if (typeof request.fp !== "string") throw new AppError("request.validation_failed");
      return this.writes.apply_knowledge_changes({
        projectPath: this.session.require_loaded_project_path(),
        intents: [{ op: "delete", line: 1, path, fp: request.fp }],
      });
    });
  }

  /** 在 API 边界拒绝非字符串和不可投影的路径。 */
  private read_path(request: JsonRecord): string {
    if (typeof request.path !== "string") throw new AppError("request.validation_failed");
    return normalize_knowledge_path(request.path);
  }
}
