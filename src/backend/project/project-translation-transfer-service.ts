import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import type { JsonRecord, JsonValue } from "../../domain/json";
import {
  read_project_language_settings,
  read_project_prefilter_settings,
} from "../../domain/project-settings";
import { default_native_fs, type NativeFs } from "../../native/native-fs";
import { AppError } from "../../shared/error";
import {
  TRANSLATION_INHERITANCE_MODES,
  type TranslationInheritanceMode,
} from "../../shared/translation-inheritance";
import type { ProjectDatabase, ProjectItemTranslationWrite } from "../database/database-operations";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectDataReader } from "./project-data-reader";
import type { ProjectSessionState } from "./project-session-state";
import { inherit_completed_translations } from "./project-translation-inheritance";
import { compute_project_prefilter_write } from "./project-write-state";

type TranslationTransferRequest = Readonly<{
  source_path: string; // 迁出工程，提供已完成译文。
  base_path: string; // 迁入工程，新工程的基础。
  output_path: string; // 另存为对话框已确认覆盖。
  mode: TranslationInheritanceMode;
}>;

/**
 * 以迁入工程快照生成新工程。
 * 迁移持有工程写入门禁，避免与任务运行和工程切换交错。
 */
export class ProjectTranslationTransferService {
  /** 数据库拥有工程文件操作，服务共享运行门禁和当前会话。 */
  public constructor(
    private readonly database: ProjectDatabase,
    private readonly runtime_gate: RuntimeOperationGate,
    private readonly session_state: ProjectSessionState,
    private readonly native_fs: NativeFs = default_native_fs,
  ) {}

  /** 返回填充、替换与生成后仍待翻译的条目数。 */
  public async apply(body: JsonRecord): Promise<JsonRecord> {
    const request = this.read_request(body);
    return this.runtime_gate.run_project_write(async (signal) => {
      this.assert_output_path(request);
      const directory = path.dirname(request.output_path);
      const output_snapshot = path.join(directory, `.${randomUUID()}.tmp`); // 迁入工程快照，最终改名为输出工程。
      const source_snapshot = path.join(directory, `.${randomUUID()}.tmp`);
      try {
        // 先导出快照：直接复制会漏掉 WAL，直接 `prepare()` 会升级原工程。
        await this.database.export_snapshot(request.base_path, output_snapshot);
        await this.database.export_snapshot(request.source_path, source_snapshot);
        signal.throwIfAborted();
        await this.database.prepare(output_snapshot);
        await this.database.prepare(source_snapshot);
        const source_items = await this.database.read(source_snapshot, (reader) =>
          new ProjectDataReader(reader).read_items(source_snapshot),
        );
        const base = await this.database.read(output_snapshot, (reader) => {
          const data = new ProjectDataReader(reader);
          return {
            items: data.read_items(output_snapshot),
            files: data.build_files_record_block(output_snapshot),
            meta: data.get_all_meta(output_snapshot),
          };
        });
        signal.throwIfAborted();

        const next_items = base.items.map((item) => ({ ...item })); // 继承原地改写，保留 `base.items` 作为比较基准。
        const { filled, replaced } = inherit_completed_translations(
          source_items,
          next_items,
          request.mode,
        );
        const output = compute_project_prefilter_write({
          state: {
            files: base.files,
            items: Object.fromEntries(next_items.map((item) => [String(item.item_id), item])),
          },
          progress: normalize_batch_translation_progress(base.meta["translation_extras"]),
          source_language: read_project_language_settings(base.meta).source_language,
          ...read_project_prefilter_settings(base.meta),
        });
        const patches: ProjectItemTranslationWrite[] = base.items.flatMap((before) => {
          const after = output.items[String(before.item_id)]!;
          return after.status === before.status &&
            after.dst === before.dst &&
            after.name_dst === before.name_dst
            ? []
            : [
                {
                  item_id: before.item_id,
                  next: { dst: after.dst, name_dst: after.name_dst, status: after.status },
                },
              ];
        });
        await this.database.transaction(output_snapshot, (writer) => {
          writer.patch_item_translation_fields(output_snapshot, patches);
          writer.upsert_meta_entries(output_snapshot, {
            prefilter_config: output.prefilter_config,
            translation_extras: output.translation_extras as unknown as JsonValue,
          });
        });
        const agent_store = this.database.open_agent_store(output_snapshot);
        try {
          // 新工程使用独立对话，避免共用迁入工程的本机工作目录。
          await agent_store.reset();
        } finally {
          await agent_store.close();
        }
        signal.throwIfAborted();

        await this.database.replace_project_file(output_snapshot, request.output_path);
        return {
          filled,
          replaced,
          unmatched: Object.values(output.items).filter(
            (item) => item.status === "NONE" || item.status === "ERROR",
          ).length,
        };
      } finally {
        await this.database.remove_project_file(output_snapshot);
        await this.database.remove_project_file(source_snapshot);
      }
    });
  }

  /** 请求只接收有效模式和非空路径。迁出与迁入必须是不同工程。 */
  private read_request(body: JsonRecord): TranslationTransferRequest {
    const mode = TRANSLATION_INHERITANCE_MODES.find((value) => value === body["mode"]);
    const source_path = read_path(body["source_path"]);
    const base_path = read_path(body["base_path"]);
    if (
      mode === undefined ||
      this.native_fs.to_identity_path(source_path) === this.native_fs.to_identity_path(base_path)
    )
      throw new AppError("request.validation_failed");
    return { source_path, base_path, output_path: read_path(body["output_path"]), mode };
  }

  /** 在门禁内读取已加载工程，避免与工程打开、新建交错。 */
  private assert_output_path(request: TranslationTransferRequest): void {
    const session = this.session_state.snapshot();
    const output = this.native_fs.to_identity_path(request.output_path);
    const reserved = [request.source_path, request.base_path];
    if (session.loaded) reserved.push(session.projectPath);
    if (reserved.some((file) => this.native_fs.to_identity_path(file) === output))
      throw new AppError("project.path_conflict");
  }
}

/** 路径须为非空字符串，文件有效性由数据库读取时检查。 */
function read_path(value: JsonValue | undefined): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new AppError("request.validation_failed");
  return value;
}
