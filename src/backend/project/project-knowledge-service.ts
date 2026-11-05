import { resolve_app_locale } from "../../domain/app-language";
import type { JsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type { KnowledgeFile } from "../../shared/project-knowledge";
import type { ProjectWriteResult } from "../../shared/project-event";
import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import type { ProjectSessionState } from "./project-session-state";
import type { ProjectWriteStore } from "./project-write-store";
import { project_knowledge_file } from "./project-knowledge";

/** 工程知识按需读取，写入复用工程互斥和唯一事务入口。 */
export class ProjectKnowledgeService {
  /** 复用当前工程会话、写入管线和运行占用，界面语言只用于补位模板。 */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly session: ProjectSessionState,
    private readonly writes: ProjectWriteStore,
    private readonly gate: RuntimeOperationGate,
    private readonly settings: Pick<AppSettingService, "read_app_language">,
  ) {}

  /** 页面与 AGENT 工作区共用的读取入口，旧工程尚未保存时返回模板。 */
  public async read(project = this.session.require_loaded_project_path()): Promise<KnowledgeFile> {
    const stored = await this.database.read_knowledge(project);
    return project_knowledge_file(stored, resolve_app_locale(this.settings.read_app_language()));
  }

  /** 保存须携带读取时的指纹，旧工程首次保存时才落盘。 */
  public save(request: JsonRecord): Promise<ProjectWriteResult & { document: KnowledgeFile }> {
    return this.gate.run_project_write(async () => {
      if (typeof request.text !== "string" || typeof request.fp !== "string")
        throw new AppError("request.validation_failed");
      const write = await this.writes.save_knowledge({
        projectPath: this.session.require_loaded_project_path(),
        fp: request.fp,
        text: request.text,
      });
      return { ...write, document: await this.read() };
    });
  }
}
