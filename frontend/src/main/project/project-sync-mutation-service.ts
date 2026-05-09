import fs from "node:fs";

import type { ApiJsonValue } from "../api/api-types";
import { CoreBridgeClient } from "../core/core-bridge-client";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import {
  build_project_mutation_ack_from_meta,
  get_runtime_section_revision,
} from "./project-section-revision";

type JsonRecord = Record<string, ApiJsonValue>;
type MutableJsonRecord = Record<string, ApiJsonValue>;

// 同步 mutation 只允许写入当前有效 item 状态，旧状态归一在读取 / 校对入口完成。
const ITEM_STATUS_VALUES = new Set([
  "NONE",
  "PROCESSED",
  "ERROR",
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

/**
 * 承载项目同步 mutation，把 TS Gateway 的业务写入收口到 ProjectDatabase 窄操作。
 */
export class ProjectSyncMutationService {
  // 所有 .lg 写入必须经由 ProjectDatabase workflow，避免项目域直接碰 SQL。
  private readonly database: ProjectDatabase;

  // Python Core 仍持有忙碌态和文件操作锁，TS 写入口必须通过桥保持互斥。
  private readonly core_bridge: CoreBridgeClient;

  /**
   * 注入 database 与 Python runtime bridge，保持写库和缓存同步边界可测试。
   */
  public constructor(database: ProjectDatabase, core_bridge: CoreBridgeClient) {
    this.database = database;
    this.core_bridge = core_bridge;
  }

  /**
   * 新增工作台文件，并同步重建 items 与分析派生 meta。
   */
  public async add_workbench_file(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_loaded_project_path();
    return this.run_with_file_operation_guard(async () => {
      const expected = this.normalize_expected_section_revisions(
        request["expected_section_revisions"],
      );
      this.assert_expected_revisions(project_path, expected, ["files", "items", "analysis"]);
      const files = this.normalize_add_file_entries(request["files"]);
      if (files.length === 0) {
        throw new Error("没有可添加的工作台文件");
      }

      // 先在内存中完成路径唯一性校验，避免事务写到一半才发现冲突。
      const asset_records = this.get_asset_records(project_path);
      const existing_paths = new Set(asset_records.map((record) => record.path.toLowerCase()));
      const incoming_paths = new Set<string>();
      const normalized_files = files.map((file, index) => {
        const target_key = file.target_rel_path.toLowerCase();
        if (existing_paths.has(target_key) || incoming_paths.has(target_key)) {
          throw new Error("工作台文件已存在");
        }
        incoming_paths.add(target_key);
        const record_rel_path = String(file.file_record["rel_path"] ?? "");
        if (record_rel_path !== "" && record_rel_path !== file.target_rel_path) {
          throw new Error("工作台文件记录无效");
        }
        return {
          ...file,
          sort_index: this.read_number(
            file.file_record["sort_index"],
            asset_records.length + index,
          ),
        };
      });

      const next_items = this.get_all_items(project_path);
      for (const file of normalized_files) {
        // 新增文件会整体重建 items section，确保文件顺序和条目事实同事务对齐。
        next_items.push(
          ...file.parsed_items.map((item) =>
            this.normalize_workbench_item(item, file.target_rel_path),
          ),
        );
      }

      const operations: DatabaseOperation[] = [];
      for (const file of normalized_files) {
        operations.push(
          this.op("addAssetFromSource", {
            projectPath: project_path,
            path: file.target_rel_path,
            sourcePath: file.source_path,
            sortOrder: file.sort_index,
          }),
        );
      }
      operations.push(
        this.op("setItems", { projectPath: project_path, items: next_items }),
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta: this.build_analysis_reset_meta(request),
        }),
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        ...this.bump_section_revision_operations(project_path, ["files", "items", "analysis"]),
      );
      this.database.execute_transaction(operations);
      await this.sync_project_data(["files", "items", "analysis"]);
      return this.build_project_mutation_ack(project_path, ["files", "items", "analysis"]);
    });
  }

  /**
   * 重置指定工作台文件的条目事实，并清空分析状态。
   */
  public async reset_workbench_file(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_loaded_project_path();
    return this.run_with_file_operation_guard(async () => {
      const expected = this.normalize_expected_section_revisions(
        request["expected_section_revisions"],
      );
      this.assert_expected_revisions(project_path, expected, ["items", "analysis"]);
      this.assert_rel_paths_exist(project_path, this.normalize_string_list(request["rel_paths"]));
      const merged_items = this.merge_partial_items(project_path, request["items"]);
      this.database.execute_transaction([
        this.op("updateBatch", {
          projectPath: project_path,
          items: merged_items,
          meta: this.build_analysis_reset_meta(request),
        }),
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        ...this.bump_section_revision_operations(project_path, ["items", "analysis"]),
      ]);
      await this.sync_project_data(["items", "analysis"]);
      return this.build_project_mutation_ack(project_path, ["items", "analysis"]);
    });
  }

  /**
   * 删除工作台文件与对应条目，并清空分析状态。
   */
  public async delete_workbench_file(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_loaded_project_path();
    return this.run_with_file_operation_guard(async () => {
      const expected = this.normalize_expected_section_revisions(
        request["expected_section_revisions"],
      );
      this.assert_expected_revisions(project_path, expected, ["files", "items", "analysis"]);
      const rel_paths = this.normalize_string_list(request["rel_paths"]);
      this.assert_rel_paths_exist(project_path, rel_paths);
      const operations: DatabaseOperation[] = [];
      for (const rel_path of rel_paths) {
        operations.push(
          this.op("deleteAsset", { projectPath: project_path, path: rel_path }),
          this.op("deleteItemsByFilePath", { projectPath: project_path, filePath: rel_path }),
        );
      }
      operations.push(
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta: this.build_analysis_reset_meta(request),
        }),
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        ...this.bump_section_revision_operations(project_path, ["files", "items", "analysis"]),
      );
      this.database.execute_transaction(operations);
      await this.sync_project_data(["files", "items", "analysis"]);
      return this.build_project_mutation_ack(project_path, ["files", "items", "analysis"]);
    });
  }

  /**
   * 持久化完整文件顺序，确保拖拽重排只影响 files section。
   */
  public async reorder_workbench_files(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_loaded_project_path();
    return this.run_with_file_operation_guard(async () => {
      const expected = this.normalize_expected_section_revisions(
        request["expected_section_revisions"],
      );
      this.assert_expected_revisions(project_path, expected, ["files"]);
      const ordered_paths = this.normalize_string_list(request["ordered_rel_paths"]);
      const current_paths = this.get_asset_records(project_path).map((record) => record.path);
      this.assert_complete_path_order(current_paths, ordered_paths);
      this.database.execute_transaction([
        this.op("updateAssetSortOrders", {
          projectPath: project_path,
          orderedPaths: ordered_paths,
        }),
        ...this.bump_section_revision_operations(project_path, ["files"]),
      ]);
      await this.sync_project_data(["files"]);
      return this.build_project_mutation_ack(project_path, ["files"]);
    });
  }

  /**
   * 写入项目设置镜像；prefiltered_items 模式同时替换条目与分析派生状态。
   */
  public async apply_settings_alignment(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.resolve_project_path(request);
    const mode = String(request["mode"] ?? "").toLowerCase();
    const settings_meta = this.build_project_settings_only_meta(request["project_settings"]);
    if (mode === "settings_only") {
      this.database.execute_transaction([
        this.op("upsertMetaEntries", { projectPath: project_path, meta: settings_meta }),
      ]);
      if (String(request["path"] ?? "").trim() === "") {
        await this.sync_project_data(["project"]);
      }
      return this.build_project_mutation_ack(project_path, []);
    }
    if (mode !== "prefiltered_items") {
      throw new Error("项目设置对齐模式无效");
    }
    const expected = this.normalize_expected_section_revisions(
      request["expected_section_revisions"],
    );
    this.assert_expected_revisions(project_path, expected, ["items", "analysis"]);
    const items = this.normalize_full_items(request["items"]);
    this.database.execute_transaction([
      this.op("setItems", { projectPath: project_path, items }),
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: {
          ...settings_meta,
          ...this.build_analysis_reset_meta(request, request["project_settings"]),
        },
      }),
      this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
      this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
      ...this.bump_section_revision_operations(project_path, ["items", "analysis"]),
    ]);
    await this.sync_project_data(["items", "analysis"]);
    return this.build_project_mutation_ack(project_path, ["items", "analysis"]);
  }

  /**
   * 提交翻译重置结果，保持 all 与 failed 两种旧语义分离。
   */
  public async apply_translation_reset(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_idle_project_path();
    const mode = String(request["mode"] ?? "").toLowerCase();
    const expected = this.normalize_expected_section_revisions(
      request["expected_section_revisions"],
    );
    if (mode === "all") {
      this.assert_expected_revisions(project_path, expected, ["items", "analysis"]);
      this.database.execute_transaction([
        this.op("setItems", {
          projectPath: project_path,
          items: this.normalize_full_items(request["items"]),
        }),
        this.op("upsertMetaEntries", {
          projectPath: project_path,
          meta: this.build_analysis_reset_meta(request),
        }),
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
        ...this.bump_section_revision_operations(project_path, ["items", "analysis"]),
      ]);
      await this.sync_project_data(["items", "analysis"]);
      return this.build_project_mutation_ack(project_path, ["items", "analysis"]);
    }
    if (mode === "failed") {
      this.assert_expected_revisions(project_path, expected, ["items"]);
      this.database.execute_transaction([
        this.op("updateBatch", {
          projectPath: project_path,
          items: this.merge_partial_items(project_path, request["items"]),
          meta: {
            translation_extras: this.read_request_meta_object(request, "translation_extras"),
          },
        }),
        ...this.bump_section_revision_operations(project_path, ["items"]),
      ]);
      await this.sync_project_data(["items"]);
      return this.build_project_mutation_ack(project_path, ["items"]);
    }
    throw new Error("translation reset 仅支持 mode=all 或 mode=failed");
  }

  /**
   * 提交分析重置结果，all 清空全部分析事实，failed 只清失败 checkpoint。
   */
  public async apply_analysis_reset(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_idle_project_path();
    const mode = String(request["mode"] ?? "").toLowerCase();
    const expected = this.normalize_expected_section_revisions(
      request["expected_section_revisions"],
    );
    this.assert_expected_revisions(project_path, expected, ["analysis"]);
    const operations: DatabaseOperation[] = [
      this.op("upsertMetaEntries", {
        projectPath: project_path,
        meta: {
          analysis_extras: this.normalize_object(request["analysis_extras"]),
          ...(mode === "all" ? { analysis_candidate_count: 0 } : {}),
        },
      }),
    ];
    if (mode === "all") {
      operations.push(
        this.op("deleteAnalysisItemCheckpoints", { projectPath: project_path }),
        this.op("clearAnalysisCandidateAggregates", { projectPath: project_path }),
      );
    } else if (mode === "failed") {
      operations.push(
        this.op("deleteAnalysisItemCheckpoints", {
          projectPath: project_path,
          status: "ERROR",
        }),
      );
    } else {
      throw new Error("analysis reset 仅支持 mode=all 或 mode=failed");
    }
    operations.push(...this.bump_section_revision_operations(project_path, ["analysis"]));
    this.database.execute_transaction(operations);
    await this.sync_project_data(["analysis"]);
    return this.build_project_mutation_ack(project_path, ["analysis"]);
  }

  /**
   * 写入术语导入结果，同时对齐 quality 与 analysis revision。
   */
  public async import_analysis_glossary(request: JsonRecord): Promise<JsonRecord> {
    const project_path = await this.require_loaded_project_path();
    const expected = this.normalize_expected_section_revisions(
      request["expected_section_revisions"],
    );
    this.assert_expected_revisions(project_path, expected, ["analysis", "quality"]);
    const current_glossary_revision = this.read_meta_number(
      project_path,
      "quality_rule_revision.glossary",
    );
    const expected_glossary_revision = this.read_number(request["expected_glossary_revision"], 0);
    if (current_glossary_revision !== expected_glossary_revision) {
      throw new Error(
        `术语表 revision 冲突：当前=${current_glossary_revision.toString()}，期望=${expected_glossary_revision.toString()}`,
      );
    }
    this.database.execute_transaction([
      this.op("setRules", {
        projectPath: project_path,
        ruleType: "glossary",
        rules: this.normalize_rule_entries(request["entries"]),
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: "quality_rule_revision.glossary",
        value: current_glossary_revision + 1,
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: "analysis_candidate_count",
        value: this.read_number(request["analysis_candidate_count"], 0),
      }),
      ...this.bump_section_revision_operations(project_path, ["analysis"]),
    ]);
    await this.sync_project_data(["quality", "analysis"]);
    return this.build_project_mutation_ack(project_path, ["quality", "analysis"]);
  }

  /**
   * 当前 loaded 工程是大多数 P2 mutation 的唯一目标。
   */
  private async require_loaded_project_path(): Promise<string> {
    const state = await this.core_bridge.get_project_state();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载");
    }
    return state.projectPath;
  }

  /**
   * reset 类同步 mutation 必须避开后台任务，保持与旧 Python 写入口一致。
   */
  private async require_idle_project_path(): Promise<string> {
    const state = await this.core_bridge.get_project_state();
    if (!state.loaded || state.projectPath === "") {
      throw new Error("工程未加载");
    }
    if (state.busy) {
      throw new Error("任务正在执行中 …");
    }
    return state.projectPath;
  }

  /**
   * 工作台文件 mutation 复用 Python Core 文件互斥锁，避免并发改写文件集合。
   */
  private async run_with_file_operation_guard<T>(operation: () => Promise<T>): Promise<T> {
    await this.core_bridge.begin_project_file_operation();
    try {
      return await operation();
    } finally {
      await this.core_bridge.finish_project_file_operation();
    }
  }

  /**
   * settings alignment 允许显式 path 写未 loaded 项目，其余沿用 loaded 目标。
   */
  private async resolve_project_path(request: JsonRecord): Promise<string> {
    const explicit_path = String(request["path"] ?? "").trim();
    if (explicit_path !== "") {
      this.assert_explicit_project_file_exists(explicit_path);
      return explicit_path;
    }
    return this.require_loaded_project_path();
  }

  /**
   * 显式 path 来自打开前设置对齐，必须先确认旧工程存在，避免 SQLite 静默创建空库。
   */
  private assert_explicit_project_file_exists(project_path: string): void {
    if (!fs.existsSync(project_path)) {
      throw new Error(`工程文件不存在：${project_path}`);
    }
  }

  /**
   * 按 section 校验乐观锁，缺失期望值时保持旧接口的宽容语义。
   */
  private assert_expected_revisions(
    project_path: string,
    expected: Record<string, number> | null,
    sections: string[],
  ): void {
    if (expected === null) {
      return;
    }
    const meta = this.get_all_meta(project_path);
    for (const section of sections) {
      if (!(section in expected)) {
        continue;
      }
      const current = get_runtime_section_revision(meta, section);
      const wanted = expected[section] ?? 0;
      if (current !== wanted) {
        throw new Error(
          `${section} section revision 冲突：当前=${current.toString()}，期望=${wanted.toString()}`,
        );
      }
    }
  }

  /**
   * 构建 ProjectMutationAck，保持同步 mutation 旧响应形状。
   */
  private build_project_mutation_ack(project_path: string, updated_sections: string[]): JsonRecord {
    return build_project_mutation_ack_from_meta(this.get_all_meta(project_path), updated_sections);
  }

  /**
   * bump 运行态 section revision，确保 ack 和后续 bootstrap 都看到新版本。
   */
  private bump_section_revision_operations(
    project_path: string,
    sections: string[],
  ): DatabaseOperation[] {
    const meta = this.get_all_meta(project_path);
    return sections.map((section) =>
      this.op("setMeta", {
        projectPath: project_path,
        key: `project_runtime_revision.${section}`,
        // bump 前读取同一 meta 快照，确保同一事务内多个 section 按相同基线推进。
        value: get_runtime_section_revision(meta, section) + 1,
      }),
    );
  }

  /**
   * 通知 Python Core 丢弃相关缓存，TS 写库后由 Py 后续读侧重新取库。
   */
  private async sync_project_data(sections: string[]): Promise<void> {
    await this.core_bridge.sync_runtime("project_data_changed", {
      sections: sections as unknown as ApiJsonValue,
    });
  }

  /**
   * 从请求体派生翻译和分析 reset 需要同步写入的 meta。
   */
  private build_analysis_reset_meta(
    request: JsonRecord,
    project_settings?: ApiJsonValue,
  ): MutableJsonRecord {
    const prefilter_config = this.read_request_meta_object(request, "prefilter_config");
    const meta: MutableJsonRecord = {
      translation_extras: this.read_request_meta_object(request, "translation_extras"),
      prefilter_config,
      analysis_extras: {},
      analysis_candidate_count: 0,
    };
    if (project_settings !== undefined) {
      const settings = this.normalize_object(project_settings);
      meta["prefilter_config"] = {
        ...prefilter_config,
        source_language: String(settings["source_language"] ?? ""),
        mtool_optimizer_enable: Boolean(settings["mtool_optimizer_enable"] ?? false),
        skip_duplicate_source_text_enable: Boolean(
          settings["skip_duplicate_source_text_enable"] ?? true,
        ),
      };
    }
    return meta;
  }

  /**
   * 兼容 workbench planner 仍放在 derived_meta 内的派生 meta，不扩大落库白名单。
   */
  private read_request_meta_object(request: JsonRecord, key: string): MutableJsonRecord {
    if (request[key] !== undefined) {
      return this.normalize_object(request[key]);
    }
    const derived_meta = this.normalize_object(request["derived_meta"]);
    return this.normalize_object(derived_meta[key]);
  }

  /**
   * 只写项目设置镜像时使用的受限 meta 白名单。
   */
  private build_project_settings_only_meta(value: ApiJsonValue | undefined): MutableJsonRecord {
    const settings = this.normalize_object(value);
    return {
      source_language: String(settings["source_language"] ?? ""),
      target_language: String(settings["target_language"] ?? ""),
      mtool_optimizer_enable: Boolean(settings["mtool_optimizer_enable"] ?? false),
      skip_duplicate_source_text_enable: Boolean(
        settings["skip_duplicate_source_text_enable"] ?? true,
      ),
    };
  }

  /**
   * 全量 items 写入前做最小字段归一，兼容 TS planner 已算出的完整 payload。
   */
  private normalize_full_items(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item) => this.normalize_item_payload(item));
  }

  /**
   * 局部 item payload 先和当前数据库事实 merge，再交给 updateBatch 更新。
   */
  private merge_partial_items(
    project_path: string,
    value: ApiJsonValue | undefined,
  ): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const current_by_id = new Map<number, MutableJsonRecord>();
    for (const item of this.get_all_items(project_path)) {
      const item_id = this.read_number(item["id"], NaN);
      if (Number.isFinite(item_id)) {
        current_by_id.set(item_id, item);
      }
    }
    const merged: MutableJsonRecord[] = [];
    for (const raw_item of value) {
      if (!this.is_record(raw_item)) {
        continue;
      }
      const item_id = this.read_number(raw_item["id"], NaN);
      if (!Number.isFinite(item_id)) {
        continue;
      }
      const current = current_by_id.get(item_id);
      if (current === undefined) {
        continue;
      }
      merged.push(this.normalize_item_payload({ ...current, ...raw_item, id: item_id }));
    }
    return merged;
  }

  /**
   * 工作台解析结果需要补齐 file_path、status、text_type 等运行态字段。
   */
  private normalize_workbench_item(item: JsonRecord, target_rel_path: string): MutableJsonRecord {
    const normalized = this.normalize_item_payload({
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      name_src: item["name_src"] ?? null,
      name_dst: item["name_dst"] ?? null,
      extra_field: item["extra_field"] ?? "",
      tag: String(item["tag"] ?? ""),
      row: this.read_number(item["row"], 0),
      file_type: String(item["file_type"] ?? "NONE"),
      file_path: target_rel_path,
      text_type: String(item["text_type"] ?? "NONE"),
      status: String(item["status"] ?? "NONE"),
      retry_count: this.read_number(item["retry_count"], 0),
      ...(item["id"] === undefined ? {} : { id: item["id"] }),
    });
    return normalized;
  }

  /**
   * 归一单条 item，防止状态和数字字段以脏类型进入数据库。
   */
  private normalize_item_payload(item: JsonRecord): MutableJsonRecord {
    const status = String(item["status"] ?? "NONE");
    const normalized: MutableJsonRecord = {
      ...item,
      src: String(item["src"] ?? ""),
      dst: String(item["dst"] ?? ""),
      row: this.read_number(item["row"], 0),
      status: ITEM_STATUS_VALUES.has(status) ? status : "NONE",
      retry_count: this.read_number(item["retry_count"], 0),
    };
    if (item["id"] !== undefined && item["id"] !== null && item["id"] !== "") {
      normalized["id"] = this.read_number(item["id"], 0);
    }
    return normalized;
  }

  /**
   * 归一工作台 add-file 载荷，并提前剔除不完整记录。
   */
  private normalize_add_file_entries(value: ApiJsonValue | undefined): Array<{
    source_path: string;
    target_rel_path: string;
    file_record: JsonRecord;
    parsed_items: JsonRecord[];
  }> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item) => {
        const source_path = String(item["source_path"] ?? "");
        const target_rel_path = String(item["target_rel_path"] ?? "");
        if (source_path === "" || target_rel_path === "") {
          throw new Error("工作台文件记录无效");
        }
        const parsed_items = Array.isArray(item["parsed_items"])
          ? item["parsed_items"].filter((entry): entry is JsonRecord => this.is_record(entry))
          : [];
        return {
          source_path,
          target_rel_path,
          file_record: this.normalize_object(item["file_record"]),
          parsed_items,
        };
      });
  }

  /**
   * 归一术语规则条目，保持和质量规则入口一致的字段白名单。
   */
  private normalize_rule_entries(value: ApiJsonValue | undefined): MutableJsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry): entry is JsonRecord => this.is_record(entry))
      .map((entry) => ({
        src: String(entry["src"] ?? "").trim(),
        dst: String(entry["dst"] ?? "").trim(),
        info: String(entry["info"] ?? "").trim(),
        regex: Boolean(entry["regex"] ?? false),
        case_sensitive: Boolean(entry["case_sensitive"] ?? false),
      }))
      .filter((entry) => entry["src"] !== "");
  }

  /**
   * 校验工作台路径必须存在，避免删除或重置不存在的 asset。
   */
  private assert_rel_paths_exist(project_path: string, rel_paths: string[]): void {
    if (rel_paths.length === 0) {
      throw new Error("工作台文件路径为空");
    }
    const existing = new Set(this.get_asset_records(project_path).map((record) => record.path));
    for (const rel_path of rel_paths) {
      if (!existing.has(rel_path)) {
        throw new Error("工作台文件不存在");
      }
    }
  }

  /**
   * 校验重排序 payload 完整覆盖当前 asset 集合。
   */
  private assert_complete_path_order(current_paths: string[], ordered_paths: string[]): void {
    if (current_paths.length !== ordered_paths.length) {
      throw new Error("工作台文件顺序必须完整覆盖当前文件集合");
    }
    const current = new Set(current_paths);
    const ordered = new Set(ordered_paths);
    if (current.size !== ordered.size) {
      throw new Error("工作台文件顺序存在重复路径");
    }
    for (const rel_path of current) {
      if (!ordered.has(rel_path)) {
        throw new Error("工作台文件顺序必须完整覆盖当前文件集合");
      }
    }
  }

  /**
   * 读取全部 item dict，供局部 merge 和工作台 append 使用。
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
   * 读取 asset 顺序记录，隐藏数据库返回字段名差异。
   */
  private get_asset_records(project_path: string): Array<{ path: string; sort_order: number }> {
    const value = this.database.execute(
      this.op("getAllAssetRecords", { projectPath: project_path }),
    );
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => this.is_record(item))
      .map((item) => ({
        path: String(item["path"] ?? ""),
        sort_order: this.read_number(item["sort_order"], 0),
      }));
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
   * 读取单个数字 meta，隔离默认值和类型转换。
   */
  private read_meta_number(project_path: string, key: string): number {
    return this.read_number(
      this.database.execute(this.op("getMeta", { projectPath: project_path, key, default: 0 })),
      0,
    );
  }

  /**
   * 归一期望 section revisions，保留缺失字段不校验的兼容语义。
   */
  private normalize_expected_section_revisions(
    value: ApiJsonValue | undefined,
  ): Record<string, number> | null {
    if (!this.is_record(value)) {
      return null;
    }
    const result: Record<string, number> = {};
    for (const [section, revision] of Object.entries(value)) {
      result[section] = this.read_number(revision, 0);
    }
    return result;
  }

  /**
   * 把未知 JSON 收窄为对象，避免深层读取扩散类型断言。
   */
  private normalize_object(value: ApiJsonValue | undefined): MutableJsonRecord {
    return this.is_record(value) ? { ...value } : {};
  }

  /**
   * 归一字符串数组，路径列表和 ordered id 都复用这一层。
   */
  private normalize_string_list(value: ApiJsonValue | undefined): string[] {
    return Array.isArray(value)
      ? value.map((item) => String(item)).filter((item) => item !== "")
      : [];
  }

  /**
   * 从 JSON 值读取数字，避免 NaN 泄漏到数据库 payload。
   */
  private read_number(value: ApiJsonValue | undefined, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? number_value : fallback;
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
