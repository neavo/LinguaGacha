import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import {
  build_project_mutation_ack_from_meta,
  get_runtime_section_revision,
} from "../project/project-section-revision";
import { ProjectSessionState } from "../project/project-session-state";
import { Item } from "../../base/item";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

/**
 * 承载校对同步写入口，把 finalized payload 直接持久化到 Electron main 数据库。
 */
export class ProofreadingService {
  // 校对同步保存直接写 .lg，但仍只能通过 ProjectDatabase workflow 触达数据库。
  private readonly database: ProjectDatabase;

  // 校对同步写入口只以 公开会话状态定位当前工程。
  private readonly session_state: ProjectSessionState;

  /**
   * 注入数据库与运行时桥，保证写库和读侧缓存同步都可被测试替换。
   */
  public constructor(database: ProjectDatabase, session_state: ProjectSessionState) {
    this.database = database;
    this.session_state = session_state;
  }

  /**
   * 保存单条校对结果，使用 finalized payload 语义。
   */
  public async save_item(request: JsonRecord): Promise<JsonRecord> {
    return this.persist_finalized_items(request);
  }

  /**
   * 保存批量校对结果，响应形状保持稳定。
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
    return this.build_project_mutation_ack(project_path);
  }

  /**
   * 当前 loaded 工程是校对保存的唯一目标。
   */
  private async require_loaded_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载");
    }
    return state.projectPath;
  }

  /**
   * 缺失期望值时宽容跳过；给出期望值时使用冲突消息。
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
   * 按 finalized item 白名单，把 payload 合并到当前数据库事实上。
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
   * 只接受校对写入口允许覆盖的字段，避免校对页顺手写入其它 item 事实。
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
    return build_project_mutation_ack_from_meta(this.get_all_meta(project_path), [
      "items",
      "proofreading",
    ]);
  }

  /**
   * 项目运行态 revision 的坏值和负值读取为 0。
   */
  private get_project_runtime_revision(meta: JsonRecord, section: string): number {
    return get_runtime_section_revision(meta, section);
  }

  /**
   * 校对 revision 的坏值和负值读取为 0。
   */
  private get_proofreading_revision(meta: JsonRecord): number {
    return get_runtime_section_revision(meta, "proofreading");
  }

  /**
   * 归一期望 section revisions；非对象视为缺失，坏 revision 值直接报错。
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
   * 校对写入口只接受当前状态域，非法值按未处理状态兜底。
   */
  private normalize_item_status(value: ApiJsonValue | undefined): string {
    return Item.normalize_status(value);
  }

  /**
   * 写入字段和 expected revision 使用严格转换，转换失败时保持失败语义。
   */
  private parse_integer_or_throw(value: ApiJsonValue | undefined): number {
    const parsed = this.parse_integer_like(value);
    if (parsed === null) {
      throw new Error(`整数值无效：${String(value)}`);
    }
    return parsed;
  }

  /**
   * 模拟 int：数字截断，整数字符串可转，布尔值按 1/0，null 和非整数字符串失败。
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
