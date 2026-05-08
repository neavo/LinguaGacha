import type { ApiJsonValue } from "../api/api-types";
import { CoreBridgeClient } from "../core/core-bridge-client";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

const RUNTIME_SECTIONS = [
  "project",
  "files",
  "items",
  "quality",
  "prompts",
  "analysis",
  "proofreading",
  "task",
] as const;
const QUALITY_RULE_TYPES = [
  "glossary",
  "text_preserve",
  "pre_replacement",
  "post_replacement",
] as const;
const PROMPT_TASK_TYPES = ["translation", "analysis"] as const;
const VALID_ITEM_STATUS_VALUES = new Set([
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

/**
 * 承载校对同步写入口，把 finalized payload 直接持久化到 Electron main 数据库。
 */
export class ProofreadingService {
  private readonly database: ProjectDatabase;
  private readonly core_bridge: CoreBridgeClient;

  /**
   * 注入数据库与运行时桥，保证写库和 Python 读侧缓存同步都可被测试替换。
   */
  public constructor(database: ProjectDatabase, core_bridge: CoreBridgeClient) {
    this.database = database;
    this.core_bridge = core_bridge;
  }

  /**
   * 保存单条校对结果，和旧入口共享同一 finalized payload 语义。
   */
  public async save_item(request: JsonRecord): Promise<JsonRecord> {
    return this.persist_finalized_items(request);
  }

  /**
   * 保存批量校对结果，响应形状与旧 Python app service 保持一致。
   */
  public async save_all(request: JsonRecord): Promise<JsonRecord> {
    return this.persist_finalized_items(request);
  }

  /**
   * 保存批量替换结果，落库语义仍然只看 finalized items 与 translation_extras。
   */
  public async replace_all(request: JsonRecord): Promise<JsonRecord> {
    return this.persist_finalized_items(request);
  }

  /**
   * 校对同步 mutation 的唯一写入口：校验 revision、merge 白名单字段、推进双 revision。
   */
  private async persist_finalized_items(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_loaded_project_path();
    const expected = this.normalize_expected_section_revisions(
      request["expected_section_revisions"],
    );
    const meta = this.get_all_meta(project_path);
    const current_items_revision = this.get_project_runtime_revision(meta, "items");
    const current_proofreading_revision = this.get_proofreading_revision(meta);
    this.assert_expected_revisions(expected, current_items_revision, current_proofreading_revision);

    const finalized_items = this.merge_finalized_items(project_path, request["items"]);
    const update_args: Record<string, DatabaseJsonValue> = {
      projectPath: project_path,
      meta: {
        translation_extras: this.normalize_object(request["translation_extras"]),
      },
    };
    if (finalized_items.length > 0) {
      update_args["items"] = finalized_items;
    }

    this.database.execute_transaction([
      this.op("updateBatch", update_args),
      this.op("setMeta", {
        projectPath: project_path,
        key: "project_runtime_revision.items",
        value: current_items_revision + 1,
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: "proofreading_revision.proofreading",
        value: current_proofreading_revision + 1,
      }),
    ]);
    await this.sync_project_data();
    return this.build_project_mutation_ack(project_path);
  }

  /**
   * 当前 loaded 工程是校对保存的唯一目标。
   */
  private async require_loaded_project_path(): Promise<string> {
    const state = await this.core_bridge.get_project_state();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载");
    }
    return state.projectPath;
  }

  /**
   * 缺失期望值时宽容跳过；给出期望值时使用旧 Python 冲突消息。
   */
  private assert_expected_revisions(
    expected: Record<string, number> | null,
    current_items_revision: number,
    current_proofreading_revision: number,
  ): void {
    if (expected === null) {
      return;
    }
    if ("items" in expected && expected["items"] !== current_items_revision) {
      throw new Error(
        `运行态 revision 冲突：section=items 当前=${current_items_revision.toString()} 期望=${expected["items"].toString()}`,
      );
    }
    if ("proofreading" in expected && expected["proofreading"] !== current_proofreading_revision) {
      throw new Error(
        `校对 revision 冲突：当前=${current_proofreading_revision.toString()}，期望=${expected["proofreading"].toString()}`,
      );
    }
  }

  /**
   * 按旧 Py 入口的 finalized item 白名单，把 payload 合并到当前数据库事实上。
   */
  private merge_finalized_items(
    project_path: string,
    value: ApiJsonValue | undefined,
  ): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const current_by_id = new Map<number, MutableJsonRecord>();
    for (const item of this.get_all_items(project_path)) {
      const item_id = this.parse_integer_like(item["id"]);
      if (item_id !== null) {
        current_by_id.set(item_id, item);
      }
    }

    const merged_items: MutableJsonRecord[] = [];
    for (const raw_item of value) {
      if (!this.is_record(raw_item)) {
        continue;
      }
      const item_id = this.parse_integer_like(raw_item["id"] ?? raw_item["item_id"]);
      if (item_id === null) {
        continue;
      }
      const current = current_by_id.get(item_id);
      if (current === undefined) {
        continue;
      }
      merged_items.push(this.merge_item_payload(current, raw_item, item_id));
    }
    return merged_items;
  }

  /**
   * 只接受旧 Py 写入口允许覆盖的字段，避免校对页顺手写入其它 item 事实。
   */
  private merge_item_payload(
    current: MutableJsonRecord,
    payload: JsonRecord,
    item_id: number,
  ): MutableJsonRecord {
    const item: MutableJsonRecord = { ...current, id: item_id };
    if ("file_path" in payload) {
      item["file_path"] = String(payload["file_path"] ?? "");
    }
    if ("row" in payload || "row_number" in payload) {
      item["row"] = this.parse_integer_or_throw(payload["row"] ?? payload["row_number"] ?? 0);
    }
    if ("src" in payload) {
      item["src"] = String(payload["src"] ?? "");
    }
    if ("dst" in payload) {
      item["dst"] = String(payload["dst"] ?? "");
    }
    if ("status" in payload) {
      item["status"] = this.normalize_item_status(payload["status"]);
    }
    if ("text_type" in payload) {
      item["text_type"] = String(payload["text_type"] ?? "");
    }
    if ("retry_count" in payload) {
      item["retry_count"] = this.parse_integer_or_throw(payload["retry_count"] ?? 0);
    }
    return item;
  }

  /**
   * 构建 ProjectMutationAck，固定回传 items 与 proofreading 两个 section revision。
   */
  private build_project_mutation_ack(project_path: string): JsonRecord {
    const meta = this.get_all_meta(project_path);
    return {
      accepted: true,
      projectRevision: Math.max(
        ...RUNTIME_SECTIONS.map((section) => this.get_section_revision(meta, section)),
        0,
      ),
      sectionRevisions: {
        items: this.get_project_runtime_revision(meta, "items"),
        proofreading: this.get_proofreading_revision(meta),
      },
    };
  }

  /**
   * 读取 section revision，和 Python ProjectRuntimeService 的 meta 口径保持一致。
   */
  private get_section_revision(meta: JsonRecord, section: string): number {
    if (section === "quality") {
      return Math.max(
        ...QUALITY_RULE_TYPES.map((rule_type) =>
          this.read_revision_meta(meta[`quality_rule_revision.${rule_type}`], 0),
        ),
        0,
      );
    }
    if (section === "prompts") {
      return Math.max(
        ...PROMPT_TASK_TYPES.map((task_type) =>
          this.read_revision_meta(meta[`quality_prompt_revision.${task_type}`], 0),
        ),
        0,
      );
    }
    if (section === "files" || section === "items" || section === "analysis") {
      return this.get_project_runtime_revision(meta, section);
    }
    if (section === "proofreading") {
      return this.get_proofreading_revision(meta);
    }
    return 0;
  }

  /**
   * 项目运行态 revision 的坏值和负值按旧服务读取为 0。
   */
  private get_project_runtime_revision(meta: JsonRecord, section: string): number {
    return this.read_revision_meta(meta[`project_runtime_revision.${section}`], 0);
  }

  /**
   * 校对 revision 的坏值和负值按旧 ProofreadingRevisionService 读取为 0。
   */
  private get_proofreading_revision(meta: JsonRecord): number {
    return this.read_revision_meta(meta["proofreading_revision.proofreading"], 0);
  }

  /**
   * 归一期望 section revisions；非对象视为缺失，坏 revision 值沿用旧入口直接报错。
   */
  private normalize_expected_section_revisions(
    value: ApiJsonValue | undefined,
  ): Record<string, number> | null {
    if (!this.is_record(value)) {
      return null;
    }
    const result: Record<string, number> = {};
    for (const [section, revision] of Object.entries(value)) {
      result[section] = this.parse_integer_or_throw(revision);
    }
    return result;
  }

  /**
   * 读取全部 item dict，供局部 merge 使用。
   */
  private get_all_items(project_path: string): MutableJsonRecord[] {
    const value = this.database.execute(this.op("getAllItems", { projectPath: project_path }));
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => this.is_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * 读取完整 meta，用于 revision 判断和 ack 构造。
   */
  private get_all_meta(project_path: string): MutableJsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })),
    );
  }

  /**
   * 通知 Python Core 丢弃 items 相关缓存；meta cache 会随 items section 一并失效。
   */
  private async sync_project_data(): Promise<void> {
    await this.core_bridge.sync_runtime("project_data_changed", {
      sections: ["items"],
    });
  }

  /**
   * 兼容当前状态域和两个历史状态值。
   */
  private normalize_item_status(value: ApiJsonValue | undefined): string {
    const status = String(value ?? "");
    if (status === "PROCESSED_IN_PAST") {
      return "PROCESSED";
    }
    if (status === "PROCESSING") {
      return "NONE";
    }
    return VALID_ITEM_STATUS_VALUES.has(status) ? status : "NONE";
  }

  /**
   * meta revision 读取沿用 Python int 语义，坏值和负数读作默认值。
   */
  private read_revision_meta(value: ApiJsonValue | undefined, fallback: number): number {
    const parsed = this.parse_integer_like(value);
    if (parsed === null || parsed < 0) {
      return fallback;
    }
    return parsed;
  }

  /**
   * 写入字段和 expected revision 使用严格转换，转换失败时保持旧接口失败语义。
   */
  private parse_integer_or_throw(value: ApiJsonValue | undefined): number {
    const parsed = this.parse_integer_like(value);
    if (parsed === null) {
      throw new Error(`整数值无效：${String(value)}`);
    }
    return parsed;
  }

  /**
   * 模拟 Python int：数字截断，整数字符串可转，布尔值按 1/0，null 和非整数字符串失败。
   */
  private parse_integer_like(value: ApiJsonValue | undefined): number | null {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.trunc(value) : null;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[+-]?\d+$/.test(trimmed)) {
        return Number.parseInt(trimmed, 10);
      }
    }
    return null;
  }

  /**
   * 把未知 JSON 收窄为对象，避免深层读取扩散类型断言。
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 收窄 JSON 对象，保护数组和 null 不被当作 record。
   */
  private is_record(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 创建 database workflow 操作，避免业务方法重复拼协议壳。
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }
}
