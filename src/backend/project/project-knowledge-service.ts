import { resolve_app_locale } from "../../domain/app-language";
import type { JsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type { KnowledgeFile } from "../../shared/project-knowledge";
import type { ProjectWriteResult } from "../../shared/project-event";
import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectOperationGate } from "../runtime-operation-gate";
import type { ProjectWriteStore } from "./project-write-store";
import { project_knowledge_file } from "./project-knowledge";

/** 工程知识按需读取，写入复用工程互斥和唯一事务入口。 */
export class ProjectKnowledgeService {
  /** 复用当前工程会话、写入管线和运行占用，界面语言只用于补位模板。 */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly project_path: string,
    private readonly writes: ProjectWriteStore,
    private readonly gate: ProjectOperationGate,
    private readonly settings: Pick<AppSettingService, "read_app_language">,
  ) {}

  /** 页面与 AGENT 工作区共用的读取入口，旧工程尚未保存时返回模板。 */
  public async read(project = this.project_path): Promise<KnowledgeFile> {
    const stored = await this.database.read_knowledge(project);
    return this.make_document(stored);
  }

  /** 按读取时的指纹保存正文，或清除覆盖后回到默认模板。 */
  public save(request: JsonRecord): Promise<ProjectWriteResult & { document: KnowledgeFile }> {
    return this.gate.run_project_write(async () => {
      const { text, fp } = request;
      if ((text !== null && typeof text !== "string") || typeof fp !== "string")
        throw new AppError("request.validation_failed");
      const write = await this.writes.save_knowledge({
        projectPath: this.project_path,
        fp,
        text,
      });
      return { ...write, document: this.make_document(text) }; // 事务原样保存正文或清除覆盖。
    });
  }

  /** 读取与保存回执使用同一模板语言。 */
  private make_document(text: string | null): KnowledgeFile {
    return project_knowledge_file(text, resolve_app_locale(this.settings.read_app_language()));
  }
}
