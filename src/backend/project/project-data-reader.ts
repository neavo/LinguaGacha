import type { JsonRecord, JsonValue } from "../../domain/json";
import { ProjectDatabase } from "../database/database-operations";
import { TRANSLATION_PROMPT } from "../../domain/prompt";
import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import {
  collect_project_item_missing_public_fields,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../domain/item";
import { is_json_record, read_json_integer, read_json_record } from "../../domain/json";
import {
  isProjectDataSection,
  PROJECT_DATA_SECTIONS,
  type ProjectDataSection,
} from "../../shared/project-event";
import * as AppErrors from "../../shared/error";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";

export { PROJECT_DATA_SECTIONS };
export type { ProjectDataSection };

/**
 * 统一读取项目 section revision，供读取接口和同步写入事件共享口径
 */
export function get_section_revision(meta: JsonRecord, section: string): number {
  if (section.startsWith("quality:")) {
    return read_revision_meta(meta[`quality_rule_revision.${section.slice("quality:".length)}`]);
  }
  if (section.startsWith("prompts:")) {
    return read_revision_meta(meta[`quality_prompt_revision.${section.slice("prompts:".length)}`]);
  }
  if (section === "quality") {
    return Math.max(
      ...QualityRule.all().map((rule) => read_revision_meta(meta[rule.revision_meta_key])),
      0,
    );
  }
  if (section === "prompts") {
    return read_revision_meta(meta[TRANSLATION_PROMPT.revision_meta_key]);
  }
  if (section === "files" || section === "items") {
    return read_revision_meta(meta[`project_runtime_revision.${section}`]);
  }
  if (section === "proofreading") {
    return read_revision_meta(meta["proofreading_revision.proofreading"]);
  }
  return 0;
}

/**
 * 从一次 meta 快照构建全部公开 section revision，供 manifest 和事件共用。
 */
export function build_section_revisions_from_meta(
  meta: JsonRecord,
): Record<ProjectDataSection, number> {
  // manifest 与变更事件都需要全量项目数据 section revision，任务运行态必须走 task snapshot
  return Object.fromEntries(
    PROJECT_DATA_SECTIONS.map((section) => [section, get_section_revision(meta, section)]),
  ) as Record<ProjectDataSection, number>;
}

/**
 * 将旧项目或损坏 meta 归一为稳定的非负整数 revision。
 */
function read_revision_meta(value: JsonValue | undefined): number {
  const number_value = Number(value ?? 0);
  if (!Number.isFinite(number_value) || number_value < 0) {
    // 旧项目或坏 meta 不能把 revision 读成 NaN / 负数，否则乐观锁会失去稳定基线
    return 0;
  }
  return Math.trunc(number_value);
}

/**
 * items 快照同时服务 files 回退索引和 items section，调用方负责按需触发读取
 */
export type ProjectDataItemsSnapshot = {
  item_records: ProjectItemPublicRecord[];
  records_by_path: Map<string, { rel_path: string; file_type: string }>;
};

/**
 * 懒读取入口把大 section 读取限制在真正需要 items 事实的分支
 */
type ProjectDataItemsSnapshotReader = () => ProjectDataItemsSnapshot;

/**
 * 项目运行态读取服务统一从 `.lg` 事实生成公开 project data block，不持有长期缓存
 */
export class ProjectDataReader {
  private readonly database: ProjectDatabase; // workflow 是 `.lg` 事实唯一读取入口

  /**
   * 只注入 database workflow，调用方决定读取时机和 project path
   */
  public constructor(database: ProjectDatabase) {
    this.database = database;
  }

  /**
   * manifest 只暴露项目数据读取索引，不预热任何大 section
   */
  public build_manifest(project_state: { loaded: boolean; projectPath: string }): JsonRecord {
    const project_path = project_state.loaded ? project_state.projectPath : "";
    const meta = project_path === "" ? {} : this.get_all_meta(project_path);
    const section_revisions = this.build_section_revisions(meta);
    return {
      projectPath: project_path,
      project: {
        path: project_state.projectPath,
        loaded: project_state.loaded,
      },
      projectRevision: Math.max(...Object.values(section_revisions), 0),
      sectionRevisions: section_revisions as unknown as JsonValue,
      counts:
        project_path === ""
          ? { files: 0, items: 0 }
          : (this.build_manifest_counts(project_path) as unknown as JsonValue),
    };
  }

  /**
   * 按需读取 section 时直接返回公开变更可消费形状，避免渲染进程另建解码层
   */
  public build_section_payloads(args: {
    projectState: { loaded: boolean; projectPath: string };
    sections: ProjectDataSection[];
  }): JsonRecord {
    const project_path = args.projectState.loaded ? args.projectState.projectPath : "";
    const meta = project_path === "" ? {} : this.get_all_meta(project_path);
    let items_snapshot: ProjectDataItemsSnapshot | null = null;
    const read_items_snapshot = (): ProjectDataItemsSnapshot => {
      if (items_snapshot === null) {
        // 同一次 section 组装最多读取一次 items，避免 files/items 同取时重复扫表
        items_snapshot =
          project_path === ""
            ? this.empty_items_snapshot()
            : this.build_runtime_items_snapshot(project_path);
      }
      return items_snapshot;
    };
    const sections: JsonRecord = {};
    for (const section of args.sections.filter(isProjectDataSection)) {
      sections[section] = this.build_store_section_payload({
        section,
        projectState: args.projectState,
        projectPath: project_path,
        meta,
        readItemsSnapshot: read_items_snapshot,
      }) as unknown as JsonValue;
    }
    const section_revisions = this.build_section_revisions(meta);
    return {
      projectPath: project_path,
      sections,
      projectRevision: Math.max(...Object.values(section_revisions), 0),
      sectionRevisions: section_revisions as unknown as JsonValue,
    };
  }

  /**
   * files section 以 rel_path map 暴露；asset 表顺序优先，缺 asset 时回退 item 首次出现顺序
   */
  public build_files_record_block(
    project_path: string,
    snapshot = this.build_runtime_items_snapshot(project_path),
  ): JsonRecord {
    const asset_records = project_path === "" ? [] : this.get_asset_records(project_path);
    const files: JsonRecord = {};

    if (asset_records.length > 0) {
      for (const asset_record of asset_records) {
        const rel_path = asset_record.rel_path.trim();
        if (rel_path === "") {
          continue;
        }
        files[rel_path] = {
          rel_path,
          file_type: snapshot.records_by_path.get(rel_path)?.file_type ?? "NONE",
          sort_index: asset_record.sort_index,
        };
      }
      return files;
    }

    for (const [sort_index, record] of [...snapshot.records_by_path.values()].entries()) {
      files[record.rel_path] = {
        rel_path: record.rel_path,
        file_type: record.file_type,
        sort_index,
      };
    }
    return files;
  }

  /**
   * items section 使用 item_id map，保持公开变更可直接消费
   */
  public build_items_record_block(
    project_path: string,
    snapshot = this.build_runtime_items_snapshot(project_path),
  ): JsonRecord {
    const items: JsonRecord = {};
    for (const record of snapshot.item_records) {
      const item_id = String(record["item_id"] ?? "").trim();
      if (item_id !== "") {
        items[item_id] = record;
      }
    }
    return items;
  }

  /**
   * 行级规范化增量只回读指定 item，避免小变更退化成完整 items 替换
   */
  public build_item_records_by_ids(
    project_path: string,
    item_ids: number[],
  ): ProjectItemPublicRecord[] {
    const value = this.database.get_items_by_ids(project_path, item_ids);
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => is_json_record(item))
          .map((item) => this.normalize_item_record(item))
      : [];
  }

  /**
   * 质量块按公开 rule type 输出，避免页面理解数据库物理命名
   */
  public build_quality_block(project_path: string, meta: JsonRecord): JsonRecord {
    return Object.fromEntries(
      QualityRule.all().map((rule) => [
        rule.kind,
        this.build_quality_rule_slice(project_path, meta, rule.kind),
      ]),
    ) as JsonRecord;
  }

  /**
   * 工程未加载时仍返回完整质量块形状，保持 query 默认切片可消费
   */
  public build_empty_quality_block(): JsonRecord {
    return Object.fromEntries(
      QualityRule.all().map((rule) => [
        rule.kind,
        { entries: [], enabled: false, mode: "off", revision: 0 },
      ]),
    ) as JsonRecord;
  }

  /**
   * 提示词块按公开顶层字段输出，任务快照和项目 query 共用同一 DTO
   */
  public build_prompts_block(project_path: string, meta: JsonRecord): JsonRecord {
    return {
      [TRANSLATION_PROMPT.store_key]: {
        revision: get_section_revision(meta, "prompts"),
        enabled: Boolean(meta[TRANSLATION_PROMPT.enabled_meta_key] ?? false),
        text: this.get_rule_text(project_path, TRANSLATION_PROMPT.database_type),
      },
    };
  }

  /**
   * 工程未加载时仍返回固定提示词形状，避免前端为未加载态写特殊解析分支
   */
  public build_empty_prompts_block(): JsonRecord {
    return { [TRANSLATION_PROMPT.store_key]: { revision: 0, enabled: false, text: "" } };
  }

  /**
   * proofreading block 目前只需要 revision，真实条目事实仍由 items block 表达
   */
  public build_proofreading_block(meta: JsonRecord): JsonRecord {
    return {
      revision: get_section_revision(meta, "proofreading"),
    };
  }

  /**
   * 公开 section revisions 统一从 meta 解析，避免读取接口与写入结果口径分叉
   */
  public build_section_revisions(meta: JsonRecord): Record<ProjectDataSection, number> {
    return build_section_revisions_from_meta(meta);
  }

  /**
   * 一次读取 item 表并计算文件索引，让 files/items 在同一次组装中自洽
   */
  public build_runtime_items_snapshot(project_path: string): ProjectDataItemsSnapshot {
    const item_records: ProjectItemPublicRecord[] = [];
    const records_by_path = new Map<string, { rel_path: string; file_type: string }>();
    for (const item of this.get_all_items(project_path)) {
      const record = this.normalize_item_record(item);
      item_records.push(record);
      const file_path = String(record["file_path"] ?? "");
      if (file_path !== "") {
        records_by_path.set(file_path, {
          rel_path: file_path,
          file_type: String(record["file_type"] ?? "NONE"),
        });
      }
    }
    return { item_records, records_by_path };
  }

  /**
   * 未加载工程使用空快照，避免读取路径触碰空 projectPath 的数据库
   */
  public empty_items_snapshot(): ProjectDataItemsSnapshot {
    return { item_records: [], records_by_path: new Map() };
  }

  /**
   * meta 是 revision 与运行态 extras 的共同来源，读取后只在本次请求内复用
   */
  public get_all_meta(project_path: string): JsonRecord {
    return { ...read_json_record(this.database.get_all_meta(project_path)) };
  }

  /**
   * 数据库 item JSON 转成公开 item 行记录
   */
  private normalize_item_record(item: JsonRecord): ProjectItemPublicRecord {
    const record = normalize_project_item_public_record(item);
    if (record === null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: {
          source: "project-data-reader",
          missing_fields: collect_project_item_missing_public_fields(item),
          item_id: read_json_integer(item["id"] ?? item["item_id"], 0),
        },
      });
    }
    return record;
  }

  /**
   * manifest counts 只用于项目页概览，不替代真实 section payload
   */
  private build_manifest_counts(project_path: string): JsonRecord {
    const asset_count = this.database.get_asset_count(project_path);
    const item_count = this.database.get_item_count(project_path);
    return {
      files:
        asset_count > 0
          ? asset_count
          : this.build_runtime_items_snapshot(project_path).records_by_path.size,
      items: item_count,
    };
  }

  /**
   * section 读取统一在读取层转成渲染进程 store 的公开形状
   */
  private build_store_section_payload(args: {
    section: ProjectDataSection;
    projectState: { loaded: boolean; projectPath: string };
    projectPath: string;
    meta: JsonRecord;
    readItemsSnapshot: ProjectDataItemsSnapshotReader;
  }): JsonRecord {
    if (args.section === "project") {
      return {
        path: args.projectState.projectPath,
        loaded: args.projectState.loaded,
      };
    }
    if (args.section === "files") {
      return this.build_files_record_block(args.projectPath, args.readItemsSnapshot());
    }
    if (args.section === "items") {
      return this.build_items_record_block(args.projectPath, args.readItemsSnapshot());
    }
    if (args.section === "quality") {
      return args.projectPath === ""
        ? this.build_empty_quality_block()
        : this.build_quality_block(args.projectPath, args.meta);
    }
    if (args.section === "prompts") {
      return args.projectPath === ""
        ? this.build_empty_prompts_block()
        : this.build_prompts_block(args.projectPath, args.meta);
    }

    return this.build_proofreading_block(args.meta);
  }

  /**
   * 单个质量规则切片同时收口 entries、meta 与 revision，避免 UI 侧自行拼接
   */
  private build_quality_rule_slice(
    project_path: string,
    meta: JsonRecord,
    rule_type: QualityRuleKind,
  ): JsonRecord {
    const rule = QualityRule.from_json(rule_type);
    return {
      entries: this.get_rule_entries(project_path, rule) as unknown as JsonValue,
      enabled:
        rule.enabled_meta_key === null
          ? rule.default_enabled
          : rule.normalize_enabled(meta[rule.enabled_meta_key]),
      mode:
        rule.mode_meta_key === null
          ? rule.default_mode
          : rule.normalize_mode(meta[rule.mode_meta_key]),
      revision: get_section_revision(meta, "quality"),
    };
  }

  /**
   * 读取全部 item 仍只通过 ProjectDatabase workflow，保持 SQL 落点集中
   */
  private get_all_items(project_path: string): JsonRecord[] {
    const value = this.database.get_all_items(project_path);
    return Array.isArray(value)
      ? value
          .filter((item): item is JsonRecord => is_json_record(item))
          .map((item) => ({ ...item }))
      : [];
  }

  /**
   * asset 顺序来自 database workflow，读取层只读取当前 path/sort_order 字段
   */
  private get_asset_records(project_path: string): Array<{ rel_path: string; sort_index: number }> {
    const value = this.database.get_all_asset_records(project_path);
    if (!Array.isArray(value)) {
      return [];
    }
    const records: Array<{ rel_path: string; sort_index: number }> = [];
    const seen_rel_paths = new Set<string>();
    for (const raw_record of value) {
      if (!is_json_record(raw_record)) {
        continue;
      }
      const rel_path = String(raw_record["path"] ?? "").trim();
      if (rel_path === "" || seen_rel_paths.has(rel_path)) {
        continue;
      }
      seen_rel_paths.add(rel_path);
      records.push({
        rel_path,
        sort_index: Math.max(0, read_json_integer(raw_record["sort_order"], 0)),
      });
    }
    return records;
  }

  /** 规则事实读取后立即按具体 kind 归一验证，坏项目不能进入 cache。 */
  private get_rule_entries(project_path: string, rule: QualityRule): JsonRecord[] {
    return normalize_quality_rule_entries(
      rule,
      this.database.get_rules(project_path, rule.database_type),
    ) as JsonRecord[];
  }

  /**
   * 提示词文本走规则文本 workflow，避免读取层知道 rules 表物理细节
   */
  private get_rule_text(project_path: string, rule_type: string): string {
    return this.database.get_rule_text(project_path, rule_type);
  }
}
