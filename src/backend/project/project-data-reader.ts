import {
  type QualityRuleBlock,
  type QualityRuleSlice,
} from "../../shared/quality/quality-rule-state";
import { build_project_file_records, type ProjectFileRecord } from "./project-file-records";
import type { JsonRecord, JsonValue } from "../../domain/json";
import { ProjectDatabase } from "../database/database-operations";
import { TRANSLATION_PROMPT, type ProjectPrompts } from "../../domain/prompt";
import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import {
  collect_project_item_missing_public_fields,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
} from "../../domain/item";
import { read_json_integer } from "../../domain/json";
import { PROJECT_DATA_SECTIONS, type ProjectDataSection } from "../../shared/project-event";
import * as AppErrors from "../../shared/error";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import { read_project_revision } from "../../domain/project-revision";

export { PROJECT_DATA_SECTIONS };
export type { ProjectDataSection };

/**
 * 统一读取项目 section revision，供读取接口和同步写入事件共享口径
 */
export function get_section_revision(meta: JsonRecord, section: string): number {
  if (section.startsWith("quality:")) {
    return read_project_revision(meta[`quality_rule_revision.${section.slice("quality:".length)}`]);
  }
  if (section.startsWith("prompts:")) {
    return read_project_revision(
      meta[`quality_prompt_revision.${section.slice("prompts:".length)}`],
    );
  }
  if (section === "quality") {
    return Math.max(
      ...QualityRule.all().map((rule) => read_project_revision(meta[rule.revision_meta_key])),
      0,
    );
  }
  if (section === "prompts") {
    return read_project_revision(meta[TRANSLATION_PROMPT.revision_meta_key]);
  }
  if (section === "files" || section === "items" || section === "pdf") {
    return read_project_revision(meta[`project_runtime_revision.${section}`]);
  }
  if (section === "proofreading") {
    return read_project_revision(meta["proofreading_revision.proofreading"]);
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
 * items 快照同时服务 files 回退索引和 items section，调用方负责按需触发读取
 */
export type ProjectDataItemsSnapshot = {
  item_records: ProjectItemPublicRecord[]; // files/items 共用同次读取，类型由文件组装入口确定
  file_paths: Set<string>; // 缺少 asset 时按 Item 首次出现顺序回退文件集合与计数
};

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

  /** 校对按 pdf revision 补读页面，正文只进入后端查询运行态。 */
  public read_pdf_documents(project_path: string) {
    return this.database.read_pdf_documents(project_path);
  }

  /** files section 以 rel_path map 暴露，asset 表顺序优先，缺 asset 时沿 item 顺序。 */
  public build_files_record_block(
    project_path: string,
    items: readonly Pick<
      ProjectItemPublicRecord,
      "file_path" | "file_type"
    >[] = this.build_runtime_items_snapshot(project_path).item_records,
  ): Record<string, ProjectFileRecord> {
    const asset_records =
      project_path === "" ? [] : this.database.get_all_asset_records(project_path);
    return build_project_file_records(
      asset_records,
      items,
      asset_records.length > 0 ? Object.keys(this.database.read_pdf_summaries(project_path)) : [],
    );
  }

  /**
   * 行级规范化增量只回读指定 item，避免小变更退化成完整 items 替换
   */
  public build_item_records_by_ids(
    project_path: string,
    item_ids: number[],
  ): ProjectItemPublicRecord[] {
    const value = this.database.get_items_by_ids(project_path, item_ids);
    return value.map((item) => this.normalize_item_record(item));
  }

  /**
   * 质量块按公开 rule type 输出，避免页面理解数据库物理命名
   */
  public build_quality_block(project_path: string, meta: JsonRecord): QualityRuleBlock {
    return {
      glossary: this.build_quality_rule_slice(project_path, meta, "glossary"),
      pre_replacement: this.build_quality_rule_slice(project_path, meta, "pre_replacement"),
      post_replacement: this.build_quality_rule_slice(project_path, meta, "post_replacement"),
      text_preserve: this.build_quality_rule_slice(project_path, meta, "text_preserve"),
    };
  }

  /**
   * 提示词块按公开顶层字段输出，任务快照和项目 query 共用同一 DTO
   */
  public build_prompts_block(project_path: string, meta: JsonRecord): ProjectPrompts {
    return {
      [TRANSLATION_PROMPT.store_key]: {
        revision: get_section_revision(meta, "prompts"),
        enabled: Boolean(meta[TRANSLATION_PROMPT.enabled_meta_key] ?? false),
        text: this.database.get_rule_text(project_path, TRANSLATION_PROMPT.database_type),
      },
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
    const file_paths = new Set<string>();
    for (const item of this.database.get_all_items(project_path)) {
      const record = this.normalize_item_record(item);
      item_records.push(record);
      const file_path = String(record["file_path"] ?? "");
      if (file_path !== "") {
        file_paths.add(file_path);
      }
    }
    return { item_records, file_paths };
  }

  /**
   * meta 是 revision 与运行态 extras 的共同来源，读取后只在本次请求内复用
   */
  public get_all_meta(project_path: string): JsonRecord {
    return this.database.get_all_meta(project_path);
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
          : this.build_runtime_items_snapshot(project_path).file_paths.size,
      items: item_count,
    };
  }

  /**
   * 单个质量规则切片同时收口 entries、meta 与 revision，避免 UI 侧自行拼接
   */
  private build_quality_rule_slice<K extends QualityRuleKind>(
    project_path: string,
    meta: JsonRecord,
    rule_type: K,
  ): QualityRuleSlice<K> {
    const rule = QualityRule.from_json(rule_type);
    return {
      // 存储条目在读取边界按规则归一，缓存只接收合法记录。
      entries: normalize_quality_rule_entries(
        rule,
        this.database.get_rules(project_path, rule.database_type),
      ),
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
}

/** 空会话和空项目读取共用完整形状，每次创建独立条目数组。 */
export function create_empty_quality_rule_block(): QualityRuleBlock {
  return {
    glossary: { enabled: false, mode: "off", entries: [], revision: 0 },
    pre_replacement: { enabled: false, mode: "off", entries: [], revision: 0 },
    post_replacement: { enabled: false, mode: "off", entries: [], revision: 0 },
    text_preserve: { enabled: false, mode: "off", entries: [], revision: 0 },
  };
}
