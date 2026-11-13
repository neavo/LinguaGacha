import { image_record_identities, read_image_package } from "../file/image/image-format";
import { resolve_app_locale } from "../../domain/app-language";
import type { AppSettingService } from "../app/app-setting-service";
import type {
  SourceInspection,
  ProjectFileCreate,
  ProjectFileReplace,
  AppliedFiles,
} from "../../shared/project-file-changes";
import type { ProjectDataSection, ProjectDataSectionRevisions } from "../../shared/project-event";
import { resolve_project_file_layout, type ProjectFileUpdate } from "./project-file-layout";
import type { DiscoveredSource } from "../file/source-discovery";
import { GameDirectoryOperations } from "../file/shared/game/game-directory-operations";
import type { GodotPackOrder } from "../../shared/godot";
import { godot_pack_preview, read_godot_pack_orders } from "../file/godot/source";
import {
  log_source_file_diagnostics,
  source_operation_error,
  type SourceFileFailure,
} from "../file/source-file-parse-failure-reporter";
import type { GamePrepareExecution } from "../file/shared/game/prepare-worker";
import {
  assert_source_file_paths,
  normalize_project_asset_path,
} from "../../shared/project/project-asset-paths";
import type { SourceFileParseWarning } from "../file/file-format-types";
import type { WorkbenchImportFilesPreview } from "../../shared/workbench/workbench-command-planner";
import { get_section_revision, ProjectDataReader } from "./project-data-reader";
import {
  normalize_batch_translation_progress,
  type BatchTranslationProgress,
} from "../../domain/batch-translation";
import { inherit_completed_translations } from "./project-translation-inheritance";
import type { ProjectFileRecord } from "./project-file-records";
import type { PDFExecution } from "../file/pdf/pdf-worker";
import type { JsonRecord, JsonValue, MutableJsonRecord } from "../../domain/json";
import { ProjectDatabase, type ProjectAssetRecord } from "../database/database-operations";
import { FileFormatService, read_source_confirmations } from "../file/file-format-service";
import {
  SourceFileParsePipeline,
  type SourceFileParseResult,
  type SourceFileParsedDraft,
} from "../file/source-file-parse-pipeline";
import type { LogManager } from "../log/log-manager";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import { ProjectWriteStore, type ProjectAssetWrite } from "./project-write-store";
import {
  require_project_expected_section_revisions,
  type ProjectExpectedSectionRevisions,
} from "./project-write-request";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "./project-session-state";
import {
  build_project_item_persistent_records,
  collect_project_item_missing_public_fields,
  normalize_project_item_public_record,
  type ProjectItemPublicRecord,
  type Item,
} from "../../domain/item";
import { is_json_record } from "../../domain/json";
import {
  parse_project_language_patch,
  read_project_language_settings,
  read_project_prefilter_settings,
  type AppPrefilterSettings,
  type ProjectSettingsSnapshot,
} from "../../domain/project-settings";
import type { ProjectWriteResult } from "../../shared/project-event";
import {
  build_translation_extras_from_items,
  compute_project_prefilter_write,
  type ProjectPrefilterWriteOutput,
} from "./project-write-state";

import * as AppErrors from "../../shared/error";

type ProjectFileSection = Record<string, ProjectFileRecord>;

type ProjectWriteSnapshot = {
  asset_records: ProjectAssetRecord[];
  pdf_paths: string[]; // 与资产、条目来自同一目标工程，供文件组装和翻译重置共用
  public_items_by_id: Map<number, ProjectItemPublicRecord>;
  files: ProjectFileSection;
};

type ProjectImportConflictAction = "skip" | "replace";

const PROJECT_SETTINGS_UPDATE_SOURCE = "project_settings_update";
// 条目、进度与项目设置都由后端从项目事实计算，请求携带这些字段视为旧载荷。
const PROJECT_DERIVED_FIELDS = [
  "items",
  "translation_extras",
  "prefilter_config",
  "project_settings",
];

type ImportProjectFileCommand = {
  source_path: string; // 用户选中的真实文件路径，只允许慢准备阶段读取
  target_rel_path: string; // 写入 .lg asset 的相对路径，提交阶段重新做唯一性校验
};

/**
 * 承载项目同步写入，把 API Gateway 的业务写入收口到 ProjectDatabase 窄操作
 */
export class ProjectContentService {
  private readonly database: ProjectDatabase; // 所有 .lg 写入必须经由 ProjectDatabase workflow，避免项目域直接碰 SQL

  private readonly runtime_gate: RuntimeOperationGate; // 用户写入与模型运行共享唯一互斥门闩

  private readonly session_state: ProjectSessionState; // 当前公开工程路径由 API Gateway 会话状态提供，避免同步写入回读旧缓存

  private readonly write_store: ProjectWriteStore; // 工作台只提交结构性业务意图，事务和事件交给 ProjectWriteStore

  private readonly native_fs: NativeFs; // 来源解析使用宿主文件 IO，.lg 写入仍归 ProjectDatabase。

  private readonly log_manager: Pick<LogManager, "warning"> | null; // 记录批量文件解析失败明细，不影响事务边界

  /**
   * 注入 database、互斥门闩和会话状态，保持写库边界可测试
   */
  public constructor(
    private readonly game_directory_operations: GameDirectoryOperations,
    database: ProjectDatabase,
    runtime_gate: RuntimeOperationGate,
    session_state: ProjectSessionState,
    write_store: ProjectWriteStore,
    private readonly pdf_execution: PDFExecution,
    private readonly app_settings: Pick<AppSettingService, "read_app_language">,
    native_fs: NativeFs = default_native_fs,
    log_manager: Pick<LogManager, "warning"> | null = null,
    private readonly game_prepare_execution?: GamePrepareExecution,
  ) {
    this.database = database;
    this.runtime_gate = runtime_gate;
    this.session_state = session_state;
    this.write_store = write_store;
    this.native_fs = native_fs;
    this.log_manager = log_manager;
  }

  /** 识别只持有来源目录占用，审批前不准备或改写游戏。 */
  public async inspect_sources(
    source_paths: readonly string[],
    orders?: readonly GodotPackOrder[],
    signal?: AbortSignal,
  ): Promise<SourceInspection[]> {
    const service = await this.create_format_service(
      this.session_state.require_loaded_project_path(),
    );
    return service.with_source_directories(
      source_paths,
      async (source_signal) => {
        const inspections: SourceInspection[] = [];
        for (const source_path of source_paths) {
          const entries = await service.collect_source_file_entries(
            [source_path],
            source_signal,
            orders,
          );
          inspections.push({
            source_path,
            files: entries.flatMap((entry) =>
              entry.source.kind === "failure"
                ? []
                : [{ path: entry.source_path, kind: entry.source.kind }],
            ),
            godot_packs: entries.flatMap((entry) =>
              entry.source.kind === "game" && entry.source.file_type === "GODOT"
                ? [godot_pack_preview(entry.source.game)]
                : [],
            ),
            failures: entries.flatMap((entry) =>
              entry.source.kind === "failure"
                ? [{ path: entry.source_path, message: String(entry.source.error) }]
                : [],
            ),
          });
        }
        return inspections;
      },
      signal,
    );
  }

  /** 调用方持有工程写入占用，来源准备结束后才进入资产事务。 */
  public async apply_file_changes(args: {
    projectPath: string;
    source: string;
    expectedSectionRevisions: ProjectExpectedSectionRevisions;
    revisionSections: ProjectDataSection[];
    sourcePaths?: readonly string[];
    creates: readonly ProjectFileCreate[];
    replaces?: readonly ProjectFileReplace[];
    updates: readonly ProjectFileUpdate[];
    deletes: readonly string[];
    signal: AbortSignal;
  }): Promise<
    | {
        kind: "applied";
        write: ProjectWriteResult;
        sectionRevisions: ProjectDataSectionRevisions;
        files: AppliedFiles;
        directory_changes: string[];
      }
    | {
        kind: "source_failed";
        failures: { source_path: string; message: string }[];
        directory_changes: string[];
      }
  > {
    // 准备游戏前拒绝过期基线，避免先改写来源目录再发现工程已变化。
    await this.write_store.check_section_revisions(
      args.projectPath,
      args.expectedSectionRevisions,
      args.revisionSections,
    );
    const current_assets = await this.database.get_all_asset_records(args.projectPath);
    const replaces = args.replaces ?? [];
    const targets = [
      ...args.deletes,
      ...args.updates.map((row) => row.file_path),
      ...replaces.map((row) => row.file_path),
    ];
    if (
      new Set(targets).size !== targets.length ||
      replaces.some((row) => !current_assets.some((asset) => asset.path === row.file_path))
    )
      throw new AppErrors.AppError("request.validation_failed");
    const occupied = resolve_project_file_layout(current_assets, args.deletes, args.updates);
    let parsed: SourceFileParseResult = {
      file_drafts: [],
      failures: [],
      warnings: [],
      directory_changes: [],
    };
    let entries: (DiscoveredSource & { record: number; original_path: string })[] = []; // 保留来源记录归属和命名前路径。
    const failures: { source_path: string; message: string }[] = [];
    if (args.creates.length) {
      const service = await this.create_format_service(args.projectPath);
      parsed = await service.with_source_directories(
        args.creates.map((entry) => entry.source_path),
        async (signal) => {
          for (const [record, create] of args.creates.entries()) {
            const discovered = await service.collect_source_file_entries(
              [create.source_path],
              signal,
              create.godot_pack_orders,
            );
            if (!discovered.length)
              failures.push({
                source_path: create.source_path,
                message: "No supported files found.",
              });
            entries.push(
              ...discovered.map((entry) => ({ ...entry, record, original_path: entry.rel_path })),
            );
          }
          entries = service
            .assign_source_file_paths(entries, occupied)
            .map((entry) => ({ ...entry, rel_path: normalize_project_asset_path(entry.rel_path) }));
          return new SourceFileParsePipeline(service).parse_import_commands(entries, signal);
        },
        args.signal,
      );
      this.log_source_diagnostics(parsed.failures, parsed.warnings);
      for (const failure of parsed.failures) {
        if (parsed.file_drafts.some((file) => file.rel_path === failure.rel_path)) continue;
        const entry = entries.find((entry) => entry.rel_path === failure.rel_path)!;
        failures.push({
          source_path: args.creates[entry.record]!.source_path,
          message: String(failure.error),
        });
      }
    }
    for (const replace of replaces) {
      const service = await this.create_format_service(args.projectPath);
      const replacement = await service.with_source_directories(
        [replace.source_path],
        async (signal) => {
          const sources = await service.collect_source_file_entries([replace.source_path], signal);
          if (sources.length !== 1) throw new AppErrors.AppError("request.validation_failed");
          return new SourceFileParsePipeline(service).parse_import_commands(sources, signal);
        },
        args.signal,
      );
      parsed.directory_changes.push(...replacement.directory_changes);
      const draft = replacement.file_drafts[0];
      if (
        replacement.failures.length ||
        !draft ||
        draft.file_type !==
          current_assets.find((asset) => asset.path === replace.file_path)!.file_type
      )
        failures.push({
          source_path: replace.source_path,
          message: "Replacement source is invalid or has a different format",
        });
      else {
        draft.rel_path = replace.file_path;
        for (const item of draft.parsed_items) item.file_path = replace.file_path;
        parsed.file_drafts.push(draft);
      }
    }
    if (failures.length)
      return { kind: "source_failed", failures, directory_changes: parsed.directory_changes };
    try {
      const prepared = await this.prepare_imported_files(
        args.projectPath,
        parsed.file_drafts,
        current_assets.filter((asset) =>
          occupied.some((file) => file.path === asset.path && file.previous_path === asset.path),
        ),
        new Set([
          ...entries
            .filter((entry) => args.creates[entry.record]!.inheritance_mode === "inherit")
            .map((entry) => entry.rel_path),
          ...replaces
            .filter((row) => row.inheritance_mode === "inherit")
            .map((row) => row.file_path),
        ]),
      );
      // 新增和替换共享解析、预过滤和单次资产事务。
      const { itemIdsByFile, ...result } = await this.write_store.apply_file_changes({
        ...args,
        sourceRecord: {
          paths: args.sourcePaths ?? [],
          locale: resolve_app_locale(this.app_settings.read_app_language()),
        },
        creates: prepared.creates,
        replacements: prepared.replacements,
      });
      return {
        kind: "applied",
        ...result,
        directory_changes: parsed.directory_changes,
        files: {
          replaced: replaces.map((row) => ({
            file_path: row.file_path,
            source_path: row.source_path,
            preserved: prepared.preserved.get(row.file_path) ?? 0,
            inherited: prepared.inherited.get(row.file_path) ?? 0,
            contested: (prepared.contested.get(row.file_path) ?? []).map((group) =>
              group.map((index) => itemIdsByFile.get(row.file_path)![index]!),
            ),
          })),
          updated: args.updates.length,
          deleted: args.deletes.length,
          created: args.creates.map((create, record) => {
            const source_entries = entries.filter((entry) => entry.record === record);
            const paths = new Set(source_entries.map((entry) => entry.rel_path));
            const drafts = parsed.file_drafts.filter((file) => paths.has(file.rel_path));
            return {
              source_path: create.source_path,
              files: drafts.length,
              items: drafts.reduce((count, file) => count + file.parsed_items.length, 0),
              pages: drafts.reduce(
                (count, file) => count + (file.pdf_document?.pages.length ?? 0),
                0,
              ),
              inherited: [...paths].reduce(
                (count, path) => count + (prepared.inherited.get(path) ?? 0),
                0,
              ),
              contested: [...paths].flatMap((path) =>
                (prepared.contested.get(path) ?? []).map((group) =>
                  group.map((index) => itemIdsByFile.get(path)![index]!),
                ),
              ),
              renamed: source_entries
                .filter(
                  (entry) => normalize_project_asset_path(entry.original_path) !== entry.rel_path,
                )
                .map((entry) => ({
                  from: normalize_project_asset_path(entry.original_path),
                  to: entry.rel_path,
                })),
              parse_failed: parsed.failures
                .filter((failure) => paths.has(failure.rel_path))
                .map((failure) => failure.rel_path),
            };
          }),
        },
      };
    } catch (error) {
      throw source_operation_error(
        error,
        parsed.directory_changes,
        AppErrors.is_app_error(error) && error.code === "data.committed_sync_failed"
          ? parsed.file_drafts.length
          : 0,
      );
    }
  }

  /** 工作台与 AGENT 共用整包导入：新条目先过滤再继承，原稿与条目在统一资产事务提交。 */
  private async prepare_imported_files(
    project_path: string,
    drafts: readonly SourceFileParsedDraft[],
    assets: readonly ProjectAssetRecord[],
    inherit_paths: ReadonlySet<string>,
  ) {
    const files: ProjectFileSection = {};
    const items: Record<string, ProjectItemPublicRecord> = {};
    let id = 0; // 预过滤使用临时身份，提交时由数据库分配真实身份。
    for (const [sort_index, file] of drafts.entries()) {
      files[file.rel_path] = {
        rel_path: file.rel_path,
        file_type: file.file_type,
        sort_index,
        ...(file.game_engine === undefined ? {} : { game_engine: file.game_engine }),
      };
      for (const item of file.parsed_items) {
        id += 1;
        items[String(id)] = this.normalize_public_item({ ...item, id, file_path: file.rel_path });
      }
    }
    const preserved = new Map<string, number>();
    const inherited = new Map<string, number>();
    const contested = new Map<string, number[][]>(); // 文件内条目索引，提交后才映射为数据库 ID。
    let prepared_items = items;
    if (drafts.length) {
      const settings = await this.read_project_write_settings(project_path);
      prepared_items = (
        await this.compute_prefilter_output({ project_path, files, items, settings })
      ).items;
      if (inherit_paths.size) {
        const old_items = [
          ...this.to_public_items_by_id(await this.database.get_all_items(project_path)).values(),
        ];
        const candidates = Object.values(prepared_items).filter((item) =>
          inherit_paths.has(item.file_path),
        );
        for (const draft of drafts) {
          if (
            draft.file_type !== "IMAGE" ||
            !inherit_paths.has(draft.rel_path) ||
            !assets.some((asset) => asset.path === draft.rel_path && asset.file_type === "IMAGE")
          )
            continue;
          const oldContent = await this.database.read_asset_content(project_path, draft.rel_path);
          if (!oldContent)
            throw new AppErrors.AppError("file.not_found", {
              public_details: { file: draft.rel_path },
            });
          const before = await read_image_package(oldContent, draft.rel_path);
          const after = draft.image!; // 新包在解析入口已校验，复用结果避免再次展开大包。
          const previous = image_record_identities(before.book, before.records);
          const current = image_record_identities(after.book, after.records);
          const oldByRow = new Map(
            old_items
              .filter((item) => item.file_path === draft.rel_path)
              .map((item) => [item.row_number, item]),
          );
          const newByRow = new Map(
            candidates
              .filter((item) => item.file_path === draft.rel_path)
              .map((item) => [item.row_number, item]),
          );
          for (const [identity, next] of current) {
            const old = previous.get(identity);
            const source = old && oldByRow.get(old.row);
            const target = newByRow.get(next.row);
            if (
              !old ||
              !source ||
              !target ||
              source.status !== "PROCESSED" ||
              old.image !== next.image ||
              old.source !== next.source ||
              old.name !== next.name ||
              source.src !== next.source ||
              (source.name_src ?? "") !== next.name
            )
              continue;
            target.dst = source.dst;
            target.name_dst = source.name_dst;
            target.status = "PROCESSED";
            preserved.set(draft.rel_path, (preserved.get(draft.rel_path) ?? 0) + 1);
          }
        }
        const pending = candidates.filter((item) => item.status !== "PROCESSED"); // 记录继承前的未完成条目。
        const inheritance = inherit_completed_translations(old_items, candidates, "fill");
        // 文件内索引沿用临时 ID 顺序，与下方持久化记录的写入顺序一致。
        const file_indexes = new Map<ProjectItemPublicRecord, number>();
        for (const file_items of Map.groupBy(candidates, (item) => item.file_path).values())
          for (const [index, item] of file_items.entries()) file_indexes.set(item, index);
        for (const group of inheritance.contested) {
          const by_file = Map.groupBy(
            group.map((index) => candidates[index]!),
            (item) => item.file_path,
          );
          for (const [file_path, file_items] of by_file) {
            const groups = contested.get(file_path) ?? [];
            groups.push(file_items.map((item) => file_indexes.get(item)!));
            contested.set(file_path, groups);
          }
        }
        for (const item of pending)
          if (item.status === "PROCESSED")
            inherited.set(item.file_path, (inherited.get(item.file_path) ?? 0) + 1);
      }
    }
    const persistent = build_project_item_persistent_records(prepared_items).map((item) => {
      const record: MutableJsonRecord = { ...item };
      delete record["id"]; // 每次重建分配新身份，不能把旧行号当作继承依据。
      return record;
    });
    const by_file = Map.groupBy(persistent, (item) => item["file_path"]);
    const creates: (Extract<ProjectAssetWrite, { kind: "add" }> & { items: JsonRecord[] })[] = [];
    const replacements: (Extract<ProjectAssetWrite, { kind: "update" }> & {
      items: JsonRecord[];
    })[] = [];
    const existing_paths = new Set(assets.map((asset) => asset.path));
    const next_sort = assets.reduce((max, asset) => Math.max(max, asset.sort_order), -1) + 1;
    for (const file of drafts) {
      const fields = {
        path: file.rel_path,
        fileType: file.file_type,
        content: file.content,
        pdfDocument: file.pdf_document,
        items: by_file.get(file.rel_path) ?? [],
      };
      if (existing_paths.has(file.rel_path)) replacements.push({ kind: "update", ...fields });
      else
        creates.push({
          kind: "add",
          ...fields,
          sortOrder: next_sort + creates.length,
        });
    }
    return { creates, replacements, preserved, inherited, contested };
  }

  /** 预览只发现来源并分配目标名称，内容准备由正式导入持有。 */
  public async preview_import_files(request: JsonRecord): Promise<WorkbenchImportFilesPreview> {
    const project_path = this.session_state.require_loaded_project_path();
    const format_service = await this.create_format_service(project_path);
    const source_paths = this.normalize_string_list(request["source_paths"]);
    const sources = await format_service.with_source_directories(source_paths, (signal) =>
      format_service.collect_source_file_entries(source_paths, signal),
    );
    const snapshot = await this.database.read(project_path, (reader) => ({
      assets: reader.get_all_asset_records(project_path),
      files_revision: get_section_revision(reader.get_all_meta(project_path), "files"),
    }));
    const entries = format_service.assign_source_file_paths(sources, snapshot.assets, true);
    const existing = new Map(
      snapshot.assets.map((asset) => [
        normalize_project_asset_path(asset.path).toLowerCase(),
        asset.path,
      ]),
    );
    return {
      files_revision: snapshot.files_revision,
      ...read_source_confirmations(entries),
      files: entries.map((entry) => {
        const target = normalize_project_asset_path(entry.rel_path);
        const previous = existing.get(target.toLowerCase());
        return {
          source_path: entry.source_path,
          target_rel_path: previous ?? target,
          conflict: previous !== undefined,
        };
      }),
    };
  }

  /** 请求只携带用户选择的入口，不能从展开的资产路径反推。 */
  private read_source_paths(value: JsonValue | undefined): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((path) => typeof path !== "string"))
      throw new AppErrors.AppError("request.validation_failed");
    return (value as string[]).map((path) => path.trim()).filter(Boolean);
  }

  /** 导入工作台文件，并按同名策略同步新增或替换文件事实。 */
  public async import_files(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    return this.runtime_gate.run_project_write(async (signal) => {
      this.assert_no_legacy_fields(request, PROJECT_DERIVED_FIELDS);
      const source_paths = this.read_source_paths(request["source_paths"]);
      const conflict_action = this.normalize_import_conflict_action(request["conflict_action"]);
      const file_commands = this.normalize_import_file_commands(request["files"]);
      if (file_commands.length === 0) {
        throw new AppErrors.AppError("request.validation_failed");
      }
      const expected_revisions = require_project_expected_section_revisions(
        request["expected_section_revisions"],
      );
      // 陈旧确认必须在修改游戏目录之前退出，提交仍复核同一修订契约。
      await this.write_store.check_section_revisions(project_path, expected_revisions, [
        "files",
        "items",
      ]);
      const asset_records = await this.database.get_all_asset_records(project_path);
      const existing_record_by_key = new Map(
        asset_records.map((record) => [
          normalize_project_asset_path(record.path).toLowerCase(),
          record,
        ]),
      );
      const incoming_paths = new Set<string>();
      for (const file of file_commands) {
        const key = normalize_project_asset_path(file.target_rel_path).toLowerCase();
        if (incoming_paths.has(key))
          throw new AppErrors.AppError("request.validation_failed", {
            diagnostic_context: {
              reason: "duplicate_import_target",
              rel_path: file.target_rel_path,
            },
          });
        incoming_paths.add(key);
      }
      const godot_orders = read_godot_pack_orders(request["godot_pack_orders"]);
      const import_commands = file_commands.filter(
        (file) =>
          conflict_action === "replace" ||
          !existing_record_by_key.has(
            normalize_project_asset_path(file.target_rel_path).toLowerCase(),
          ),
      );
      // 全部跳过时没有实际处理的目标，不进入来源准备和数据库写入。
      if (import_commands.length === 0) throw no_processed_targets_error();
      const parse_result = await this.parse_import_file_commands(
        project_path,
        asset_records,
        import_commands,
        signal,
        godot_orders,
      );
      this.log_source_diagnostics(parse_result.failures, parse_result.warnings);
      let saved_assets = 0;
      try {
        signal.throwIfAborted();
        // 替换失败保留旧资产；新增失败仍保存已取得的原稿并报告诊断。
        const failed = new Set(parse_result.failures.map((failure) => failure.rel_path));
        const drafts = parse_result.file_drafts.filter(
          (file) =>
            !failed.has(file.rel_path) ||
            !existing_record_by_key.has(normalize_project_asset_path(file.rel_path).toLowerCase()),
        );
        if (!drafts.length) throw no_processed_targets_error(parse_result.failures.length > 0);
        const prepared = await this.prepare_imported_files(
          project_path,
          drafts,
          asset_records,
          new Set(
            request["inheritance_mode"] === "inherit" ? drafts.map((file) => file.rel_path) : [],
          ),
        );
        const imported_files = [...prepared.creates, ...prepared.replacements];
        const { write: write_result } = await this.write_store
          .apply_file_changes({
            projectPath: project_path,
            expectedSectionRevisions: expected_revisions,
            revisionSections: ["files", "items"],
            source: "project_import_files",
            sourceRecord: {
              paths: source_paths,
              locale: resolve_app_locale(this.app_settings.read_app_language()),
            },
            creates: prepared.creates,
            replacements: prepared.replacements,
            updates: [],
            deletes: [],
          })
          .catch((error: unknown) => {
            throw source_operation_error(
              error,
              parse_result.directory_changes,
              AppErrors.is_app_error(error) && error.code === "data.committed_sync_failed"
                ? imported_files.length
                : 0,
            );
          });
        saved_assets = imported_files.length;
        return {
          ...write_result,
          source_operation: {
            saved_assets,
            directory_changes: parse_result.directory_changes,
          },
        };
      } catch (error) {
        if (signal.aborted) throw error;
        throw source_operation_error(error, parse_result.directory_changes, saved_assets);
      }
    });
  }

  /**
   * 重置指定工作台文件的条目事实，并重建翻译进度
   */
  public async reset_files(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    return this.runtime_gate.run_project_write(async (signal) => {
      this.assert_no_legacy_fields(request, PROJECT_DERIVED_FIELDS);
      const rel_paths = this.normalize_string_list(request["rel_paths"]);
      if (rel_paths.length === 0) {
        throw new AppErrors.AppError("request.validation_failed");
      }
      const snapshot = await this.read_project_write_snapshot(project_path);
      this.assert_rel_paths_exist(snapshot.asset_records, rel_paths);
      const targets = new Set(rel_paths);
      const records = snapshot.asset_records.filter((record) => targets.has(record.path));
      const expected = require_project_expected_section_revisions(
        request["expected_section_revisions"],
      );
      const revisionSections: Array<"files" | "items" | "pdf"> = ["files", "items"];
      if (
        records.some(
          (record) => record.file_type === "PDF" || snapshot.pdf_paths.includes(record.path),
        )
      )
        revisionSections.push("pdf");
      await this.write_store.check_section_revisions(project_path, expected, revisionSections);
      return await this.rebuild_assets(
        project_path,
        snapshot,
        records,
        {
          source: "project_reset_files",
          expectedSectionRevisions: expected,
          revisionSections,
        },
        signal,
      );
    });
  }

  /**
   * 删除工作台文件与对应条目，并重建翻译进度
   */
  public async delete_files(request: JsonRecord): Promise<ProjectWriteResult> {
    const rel_paths = this.normalize_string_list(request["rel_paths"]);
    if (rel_paths.length === 0) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    return this.commit_workbench_file_changes(request, "project_delete_files", {
      updates: [],
      deletes: rel_paths,
    });
  }

  /** 改名迁移资产路径，条目、页面与译文随资产保留，名称规则由文件布局统一校验。 */
  public async rename_file(request: JsonRecord): Promise<ProjectWriteResult> {
    const file_path = request["rel_path"];
    const new_file_path = request["new_rel_path"];
    if (typeof file_path !== "string" || typeof new_file_path !== "string") {
      throw new AppErrors.AppError("request.validation_failed");
    }
    return this.commit_workbench_file_changes(request, "project_rename_file", {
      updates: [{ file_path, new_file_path, line: 1 }],
      deletes: [],
    });
  }

  /** 工作台删除与改名不经来源准备，直接提交资产结构事务。 */
  private async commit_workbench_file_changes(
    request: JsonRecord,
    source: string,
    changes: { updates: ProjectFileUpdate[]; deletes: string[] },
  ): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    return this.runtime_gate.run_project_write(async (signal) => {
      this.assert_no_legacy_fields(request, PROJECT_DERIVED_FIELDS);
      const result = await this.apply_file_changes({
        projectPath: project_path,
        expectedSectionRevisions: require_project_expected_section_revisions(
          request["expected_section_revisions"],
        ),
        revisionSections: ["files", "items"],
        source,
        creates: [],
        ...changes,
        signal,
      });
      if (result.kind !== "applied") throw new AppErrors.AppError("runtime.internal_invariant");
      return result.write;
    });
  }

  /**
   * 持久化完整文件顺序，确保拖拽重排只影响 files section
   */
  public async reorder_files(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    return this.runtime_gate.run_project_write(async () => {
      const ordered_paths = this.normalize_string_list(request["ordered_rel_paths"]);
      const current_paths = (await this.database.get_all_asset_records(project_path)).map(
        (record) => record.path,
      );
      this.assert_complete_path_order(current_paths, ordered_paths);
      return await this.write_store.reorder_project_files({
        projectPath: project_path,
        expectedSectionRevisions: require_project_expected_section_revisions(
          request["expected_section_revisions"],
        ),
        orderedPaths: ordered_paths,
      });
    });
  }

  /**
   * 修改当前项目语言；源语言变化时在同一提交内重算预过滤，目标语言只更新项目设置。
   */
  public async update_project_settings(request: JsonRecord): Promise<ProjectWriteResult> {
    const patch = parse_project_language_patch(request);
    return this.runtime_gate.run_project_write(async () => {
      const project_path = this.session_state.require_loaded_project_path();
      const current = await this.read_project_write_settings(project_path);
      const settings: ProjectSettingsSnapshot = { ...current, ...patch };
      if (settings.source_language === current.source_language) {
        return settings.target_language === current.target_language
          ? { accepted: true, changes: [] }
          : await this.write_store.apply_project_settings_meta({
              projectPath: project_path,
              source: PROJECT_SETTINGS_UPDATE_SOURCE,
              meta: { target_language: settings.target_language },
            });
      }
      const snapshot = await this.read_project_write_snapshot(project_path);
      const write_output = await this.compute_prefilter_output({
        project_path,
        files: snapshot.files,
        items: this.public_item_record(snapshot.public_items_by_id.values()),
        settings,
      });
      return await this.write_store.replace_project_items_and_files({
        projectPath: project_path,
        requireExpectedSectionRevisions: false,
        revisionSections: ["project", "items"],
        source: PROJECT_SETTINGS_UPDATE_SOURCE,
        updatedSections: ["project", "items"],
        items: build_project_item_persistent_records(write_output.items),
        meta: this.build_prefilter_reset_meta(settings, write_output),
      });
    });
  }

  /** 调用方持有工程写 lease；完成准备后才允许保存配置，使预过滤错误先于外部写入暴露。 */
  public async prepare_prefilter_settings(
    project_path: string,
    prefilter_settings: AppPrefilterSettings,
  ): Promise<() => Promise<ProjectWriteResult>> {
    const settings: ProjectSettingsSnapshot = {
      ...(await this.read_project_write_settings(project_path)),
      ...prefilter_settings,
    };
    const snapshot = await this.read_project_write_snapshot(project_path);
    const write_output = await this.compute_prefilter_output({
      project_path,
      files: snapshot.files,
      items: this.public_item_record(snapshot.public_items_by_id.values()),
      settings,
    });
    return () =>
      this.write_store.replace_project_items_and_files({
        projectPath: project_path,
        requireExpectedSectionRevisions: false,
        revisionSections: ["items"],
        source: "settings_alignment",
        updatedSections: ["items"],
        items: build_project_item_persistent_records(write_output.items),
        meta: this.build_prefilter_reset_meta(settings, write_output),
      });
  }

  /**
   * 提交翻译重置结果；命令表达当前事实操作，进入项目写 lease 后才读取工程数据
   */
  public async reset_translation(request: JsonRecord): Promise<ProjectWriteResult> {
    const project_path = this.session_state.require_loaded_project_path();
    const mode = String(request["mode"] ?? "").toLowerCase();
    this.assert_no_legacy_fields(request, [
      ...PROJECT_DERIVED_FIELDS,
      "expected_section_revisions",
    ]);
    return this.runtime_gate.run_project_write(async (signal) => {
      if (mode === "all") {
        const snapshot = await this.read_project_write_snapshot(project_path);
        return await this.rebuild_assets(
          project_path,
          snapshot,
          snapshot.asset_records,
          { source: "translation_reset" },
          signal,
        );
      }
      throw new AppErrors.AppError("request.validation_failed");
    });
  }

  /**
   * 文件导入同名策略必须由页面确认后显式提交，避免后端猜测用户意图
   */
  private normalize_import_conflict_action(
    value: JsonValue | undefined,
  ): ProjectImportConflictAction {
    if (value === "skip" || value === "replace") {
      return value;
    }
    throw new AppErrors.AppError("request.validation_failed", {
      diagnostic_context: { reason: "invalid_import_conflict_action" },
    });
  }

  /**
   * 工作台导入文件 command 只承载用户意图；解析、id、预过滤和继承都在后端侧完成
   */
  private normalize_import_file_commands(value: JsonValue | undefined): ImportProjectFileCommand[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is JsonRecord => is_json_record(item))
      .map((item) => {
        this.assert_no_legacy_fields(item, ["file_record", "parsed_items"]);
        return {
          source_path: typeof item["source_path"] === "string" ? item["source_path"] : "",
          target_rel_path:
            typeof item["target_rel_path"] === "string" ? item["target_rel_path"] : "",
        };
      })
      .filter((item) => item.source_path.trim() !== "" && item.target_rel_path.trim() !== "");
  }

  /** 在来源准备前固定身份并检查完整目标集合，避免无效目标修改游戏。 */
  private async parse_import_file_commands(
    project_path: string,
    assets: readonly ProjectAssetRecord[],
    files: readonly ImportProjectFileCommand[],
    signal: AbortSignal,
    orders?: readonly GodotPackOrder[],
  ): Promise<SourceFileParseResult> {
    const format_service = await this.create_format_service(project_path);
    const by_path = new Map(
      assets.map((asset) => [normalize_project_asset_path(asset.path).toLowerCase(), asset]),
    );
    return format_service.with_source_directories(
      files.map((file) => file.source_path),
      async (signal) => {
        const commands = await format_service.discover_import_sources(
          files.map((file) => {
            const asset = by_path.get(
              normalize_project_asset_path(file.target_rel_path).toLowerCase(),
            );
            return {
              source_path: file.source_path,
              rel_path: asset?.path ?? file.target_rel_path,
              file_type: asset?.file_type,
            };
          }),
          signal,
          orders,
        );
        const final_files = new Map<string, { path: string; file_type: string }>(by_path);
        for (const command of commands)
          final_files.set(normalize_project_asset_path(command.rel_path).toLowerCase(), {
            path: command.rel_path,
            file_type: command.file_type ?? "",
          });
        assert_source_file_paths(final_files.values());
        return new SourceFileParsePipeline(format_service).parse_import_commands(commands, signal);
      },
      signal,
    );
  }

  /** 导入与重解析在取得结果后逐条记录一次来源失败和脚本位置。 */
  private log_source_diagnostics(
    failures: readonly SourceFileFailure[],
    warnings: readonly SourceFileParseWarning[],
  ): void {
    log_source_file_diagnostics({
      failures,
      warnings,
      log_manager: this.log_manager,
      source: "project-import",
    });
  }

  /**
   * 旧 payload 字段出现时直接拒绝，避免渲染进程事实生成路径继续悄悄可用
   */
  private assert_no_legacy_fields(request: JsonRecord, fields: string[]): void {
    for (const field of fields) {
      if (field in request) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "legacy_payload_field", field },
        });
      }
    }
  }

  /**
   * 文件解析使用项目目标语言
   */
  private async create_format_service(project_path: string): Promise<FileFormatService> {
    const languages = read_project_language_settings(
      await this.database.get_all_meta(project_path),
    );
    return new FileFormatService(
      this.game_directory_operations,
      {
        target_language: languages.target_language,
      },
      this.pdf_execution,
      this.native_fs,
      this.game_prepare_execution,
    );
  }

  /**
   * 写入计算只读取项目事实：项目语言，以及项目记录的应用预过滤开关
   */
  private async read_project_write_settings(
    project_path: string,
  ): Promise<ProjectSettingsSnapshot> {
    const meta = await this.database.get_all_meta(project_path);
    return { ...read_project_language_settings(meta), ...read_project_prefilter_settings(meta) };
  }

  /**
   * 按本次操作的目标路径读取 asset、item 和 PDF 身份。
   */
  private async read_project_write_snapshot(project_path: string): Promise<ProjectWriteSnapshot> {
    return this.database.read(project_path, (reader) => {
      const asset_records = reader.get_all_asset_records(project_path);
      const item_records = reader.get_all_items(project_path);
      const pdf_paths = Object.keys(reader.read_pdf_summaries(project_path));
      const public_items_by_id = this.to_public_items_by_id(item_records);
      return {
        asset_records,
        pdf_paths,
        public_items_by_id,
        files: new ProjectDataReader(reader).build_files_record_block(project_path),
      };
    });
  }

  /**
   * 数据库持久 item 先升格为公开 DTO，后续算法不再接触 id/row 内部字段
   */
  private to_public_items_by_id(items: MutableJsonRecord[]): Map<number, ProjectItemPublicRecord> {
    const public_items = new Map<number, ProjectItemPublicRecord>();
    for (const item of items) {
      const public_item = normalize_project_item_public_record(item);
      if (public_item !== null) {
        public_items.set(public_item.item_id, { ...public_item });
      }
    }
    return public_items;
  }

  /**
   * 按 item_id 组装预过滤输入并复制条目，避免预过滤或继承修改上游快照。
   */
  private public_item_record(
    items: Iterable<ProjectItemPublicRecord>,
  ): Record<string, ProjectItemPublicRecord> {
    const record: Record<string, ProjectItemPublicRecord> = {};
    for (const item of items) {
      record[String(item.item_id)] = { ...item };
    }
    return record;
  }

  /**
   * 新解析 item 必须立刻拥有完整公开 DTO，避免后续预过滤和继承处理半成品
   */
  private normalize_public_item(value: unknown): ProjectItemPublicRecord {
    const public_item = normalize_project_item_public_record(value);
    if (public_item === null) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: {
          reason: "item_incomplete",
          missing_fields: collect_project_item_missing_public_fields(value),
        },
      });
    }
    return public_item;
  }

  /**
   * 预过滤输出由后端基于当前数据库事实计算，渲染进程不再提交最终 items 或 meta
   */
  private async compute_prefilter_output(args: {
    project_path: string;
    files: ProjectFileSection;
    items: Record<string, ProjectItemPublicRecord>;
    settings: ProjectSettingsSnapshot;
    progress?: BatchTranslationProgress;
  }): Promise<ProjectPrefilterWriteOutput> {
    return compute_project_prefilter_write({
      state: {
        files: args.files,
        items: args.items,
      },
      progress: args.progress ?? (await this.read_translation_progress(args.project_path)),
      source_language: args.settings.source_language,
      mtool_optimizer_enable: args.settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: args.settings.skip_duplicate_source_text_enable,
    });
  }

  /**
   * 预过滤类写入同时保存项目语言、开关处理记录与翻译进度
   */
  private build_prefilter_reset_meta(
    settings: ProjectSettingsSnapshot,
    output: ProjectPrefilterWriteOutput,
  ): MutableJsonRecord {
    return {
      source_language: settings.source_language,
      target_language: settings.target_language,
      mtool_optimizer_enable: settings.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: settings.skip_duplicate_source_text_enable,
      prefilter_config: output.prefilter_config as unknown as JsonValue,
      translation_extras: output.translation_extras as unknown as JsonValue,
    };
  }

  /**
   * 从数据库 translation_extras 恢复任务进度基底，后续统计会覆盖行数
   */
  private async read_translation_progress(project_path: string): Promise<BatchTranslationProgress> {
    return normalize_batch_translation_progress(
      (await this.database.get_all_meta(project_path))["translation_extras"],
    );
  }

  /**
   * 新增 item id 从当前最大公开 id 之后递增，避免与既有数据库事实冲突
   */
  private next_item_id_seed(items: Map<number, ProjectItemPublicRecord>): number {
    let seed = 0;
    for (const item_id of items.keys()) {
      seed = Math.max(seed, item_id);
    }
    return seed;
  }

  /** 按资产完整重建取得原稿的资产，保留其他资产的条目，并在同一事务提交最终事实。 */
  private async rebuild_assets(
    project_path: string,
    snapshot: ProjectWriteSnapshot,
    records: ProjectAssetRecord[],
    command:
      | { source: "translation_reset" }
      | {
          source: "project_reset_files";
          expectedSectionRevisions: ProjectExpectedSectionRevisions;
          revisionSections: Array<"files" | "items" | "pdf">;
        },
    signal?: AbortSignal,
  ): Promise<ProjectWriteResult> {
    const assets = await this.reparse_assets(project_path, records, signal);
    const settings = await this.read_project_write_settings(project_path);
    const progress =
      command.source === "translation_reset"
        ? normalize_batch_translation_progress(undefined)
        : await this.read_translation_progress(project_path);
    let next_item_id = this.next_item_id_seed(snapshot.public_items_by_id); // 新身份不沿用旧解析结果的行号。
    const reset_items = [...assets.values()]
      .flat()
      .map((item) => this.normalize_public_item({ ...item, id: ++next_item_id }));
    const write_output = await this.compute_prefilter_output({
      project_path,
      files: snapshot.files,
      items: this.public_item_record(reset_items),
      settings,
      progress,
    });
    // 重复协调与 MTool 优化以文件为界，未重建文件无需重新预过滤。
    for (const item of snapshot.public_items_by_id.values())
      if (!assets.has(item.file_path)) write_output.items[String(item.item_id)] = item;
    write_output.translation_extras = build_translation_extras_from_items({
      progress,
      items: Object.values(write_output.items),
    });
    signal?.throwIfAborted(); // 重建与预过滤完成后，取消仍须阻止重置事务开始。
    return await this.write_store.replace_project_items_and_files({
      projectPath: project_path,
      ...(command.source === "translation_reset"
        ? { requireExpectedSectionRevisions: false as const, revisionSections: ["items" as const] }
        : {
            expectedSectionRevisions: command.expectedSectionRevisions,
            revisionSections: command.revisionSections,
          }),
      source: command.source,
      resetPDFPaths: snapshot.pdf_paths.filter((file) => assets.has(file)),
      updatedSections: ["items"],
      items: build_project_item_persistent_records(write_output.items),
      meta: this.build_prefilter_reset_meta(settings, write_output),
    });
  }

  /** 逐资产从保存的原稿重建，接纳规则与导入一致。没有资产取得原稿时失败。 */
  private async reparse_assets(
    project_path: string,
    records: ProjectAssetRecord[],
    signal?: AbortSignal,
  ): Promise<Map<string, Item[]>> {
    const pipeline = new SourceFileParsePipeline(await this.create_format_service(project_path));
    const assets = new Map<string, Item[]>();
    const failures: SourceFileFailure[] = [];
    const warnings: SourceFileParseWarning[] = [];

    for (const record of records) {
      signal?.throwIfAborted();
      let content: Uint8Array | null;
      try {
        content = await this.database.read_asset_content(project_path, record.path);
        if (content === null) {
          throw new AppErrors.AppError("file.not_found", {
            diagnostic_context: { asset_path: record.path },
          });
        }
        // PDF 独立文档由 `resetPDFPaths` 重置，无需重新提取。
        if ((await this.database.read_pdf_document(project_path, record.path)) !== null) {
          assets.set(record.path, []);
          continue;
        }
      } catch (error) {
        if (signal?.aborted) throw error; // 取消不能归为单个资产的读取失败。
        failures.push({ source_path: record.path, rel_path: record.path, error });
        continue; // 未取得原稿的资产保留已有条目。
      }
      const parsed = await pipeline.parse_asset_draft(
        {
          source_path: record.path,
          rel_path: record.path,
          file_type: record.file_type,
          content,
        },
        signal,
      );
      assets.set(record.path, parsed.draft.parsed_items);
      warnings.push(...parsed.warnings);
      if (parsed.failure) failures.push(parsed.failure);
    }
    this.log_source_diagnostics(failures, warnings);
    if (!assets.size) throw no_processed_targets_error(records.length > 0);
    return assets;
  }

  /**
   * 校验工作台路径必须存在，避免删除或重置不存在的 asset
   */
  private assert_rel_paths_exist(asset_records: ProjectAssetRecord[], rel_paths: string[]): void {
    if (rel_paths.length === 0) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    const existing = new Set(asset_records.map((record) => record.path));
    for (const rel_path of rel_paths) {
      if (!existing.has(rel_path)) {
        throw new AppErrors.AppError("file.not_found", {
          public_details: { rel_path },
        });
      }
    }
  }

  /**
   * 校验重排序 payload 完整覆盖当前 asset 集合
   */
  private assert_complete_path_order(current_paths: string[], ordered_paths: string[]): void {
    if (current_paths.length !== ordered_paths.length) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    const current = new Set(current_paths);
    const ordered = new Set(ordered_paths);
    if (current.size !== ordered.size) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    for (const rel_path of current) {
      if (!ordered.has(rel_path)) {
        throw new AppErrors.AppError("request.validation_failed");
      }
    }
  }

  /**
   * 归一字符串数组，路径列表和 ordered id 都复用这一层
   */
  private normalize_string_list(value: JsonValue | undefined): string[] {
    return Array.isArray(value)
      ? value.map((item) => String(item)).filter((item) => item !== "")
      : [];
  }
}

/** 没有目标实际处理时失败。尝试过的来源未能保存归为解析失败，其余为无可处理目标。 */
function no_processed_targets_error(parse_failed = false): AppErrors.AppError {
  return new AppErrors.AppError(parse_failed ? "file.parse_failed" : "request.validation_failed", {
    diagnostic_context: { reason: "no_processed_targets" },
  });
}
