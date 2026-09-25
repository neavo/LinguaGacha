import type { AgentFileCandidate } from "../../../shared/agent-reference";
import { create_workspace_host } from "./host";
import { AgentUploadStore } from "./uploads";
import { AGENT_IMAGE_INPUT_MAX_BYTES, type AgentImageService } from "../agent-image-service";
import type { AgentImage } from "../../../shared/agent-image";
import path from "node:path";
import { agent_workspace_page_fingerprint } from "../../project/agent-workspace-page-write";
import type { PDFHost } from "../../../shared/pdf";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  is_json_record,
  read_json_integer,
  read_json_record,
  type JsonRecord,
} from "../../../domain/json";
import {
  normalize_translation_prompt_slice,
  TRANSLATION_PROMPT,
  PROMPT_KINDS,
  type PromptKind,
} from "../../../domain/prompt";
import { QualityRule, QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import {
  normalize_project_settings_snapshot,
  normalize_setting_snapshot,
} from "../../../domain/setting";
import * as AppErrors from "../../../shared/error";
import type { AgentPendingWriteSummary, AgentWorkspaceLinkResult } from "../../../shared/agent";
import { normalize_quality_rule_entries } from "../../../shared/quality/quality-rule-entry";
import {
  PROJECT_DATA_SECTIONS,
  type ProjectDataSectionRevisions,
} from "../../../shared/project-event";
import { PROOFREADING_WARNING_CODES } from "../../../shared/proofreading/proofreading-types";
import { JsonTool } from "../../../shared/utils/json-tool";
import { NativeFs, default_native_fs } from "../../../native/native-fs";
import type { AppPathService } from "../../app/app-path-service";
import type { AppSettingService } from "../../app/app-setting-service";
import type { CacheReadPort, CacheSnapshot } from "../../cache/cache-types";
import type { LogManager } from "../../log/log-manager";
import type { ProjectDatabase } from "../../database/database-operations";
import type { ProofreadingQueryService } from "../../proofreading/proofreading-query-service";
import type { ProjectSessionState } from "../../project/project-session-state";
import type { ProjectWriteStore } from "../../project/project-write-store";
import {
  project_agent_workspace_item,
  project_agent_workspace_prompt,
  project_agent_workspace_quality_entry,
  resolve_agent_workspace_writes,
  derive_agent_workspace_apply_status,
  has_agent_workspace_applied_changes,
  type AgentWorkspaceCurrentFacts,
  type AgentWorkspaceAppliedSummary,
  type AgentWorkspaceIntentBatch,
} from "../../project/agent-workspace-write";
import type { AgentWorkspaceRejectedChange } from "../../project/agent-workspace-write";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_REFERENCES,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  project_agent_workspace_warning,
} from "./contract";
import {
  AgentWorkspaceRunError,
  type AgentWorkspaceRunRequest,
  type AgentWorkspaceRunResult,
} from "./runtime/runner";
import { prepare_agent_workspace_changes } from "./changes";
import {
  AGENT_WORKSPACE_RUN_ROOT,
  AGENT_WORKSPACE_WORK_ROOT,
  AGENT_WORKSPACE_RUNTIME_POLICY,
} from "./runtime/policy";
import { write_agent_workspace_sources, type AgentWorkspaceSourceFile } from "./sources";

const RUN_ID_BYTES = 6; // 会话内执行记录使用 48 位随机标识，缩短返回给模型的文件路径

type AgentWorkspaceStoreResult = {
  applied: AgentWorkspaceAppliedSummary;
  rejected: AgentWorkspaceRejectedChange[];
  destroyed: boolean;
  sectionRevisions: ProjectDataSectionRevisions;
};

/** WorkspaceService 调用 Node runner 的唯一可取消端口。 */
export type AgentWorkspaceRunPort = (
  request: AgentWorkspaceRunRequest,
  signal: AbortSignal,
) => Promise<AgentWorkspaceRunResult>;

export type AgentWorkspaceImage = Readonly<{ path: string; image: AgentImage }>;

type ActiveAgentWorkspace = {
  projectPath: string; // snapshot 建立时绑定的工程身份
  projectEpoch: number; // 隔离同路径重新加载后的旧快照
  revisions: ProjectDataSectionRevisions; // 完整七 section 快照
  languageKey: string; // 只包含解释工作区数据所需的语言
};

/** 当前工作区文件世代共享的 `sources` 身份与 `project_meta` 映射。 */
type AgentWorkspaceSourceSession = {
  projectPath: string; // 关联的当前工程身份
  projectEpoch: number; // 隔离同路径重新加载后的旧投影
  filesRevision: number; // 只在源资产集合变化时重新生成
  files: AgentWorkspaceSourceFile[]; // project_meta 复用的不可变文件映射
};

/** 与当前 Agent 对话和工程解释边界绑定、跨数据快照保留的工作材料目录。 */
type AgentWorkspaceWorkSession = {
  projectPath: string; // snapshot 建立时绑定的工程身份
  projectEpoch: number; // 同路径重新加载后不得复用旧工作材料
  languageKey: string; // 语言解释边界变化时旧工作材料失效
};

type WorkspacePath = Readonly<{
  path: string;
  kind: "file" | "directory";
  scope: "work" | "sources" | "snapshot" | "uploads"; // 按工作区访问入口匹配清理生命周期，链接目标可在外部
}>;

/** 当前 Agent 会话磁盘工作区；协调跨快照 work、当前数据快照与 apply。 */
export class AgentWorkspaceService {
  public readonly uploads: AgentUploadStore;

  /** 查询现有文件事实，不触发工作区生成或解析原稿。 */
  public list_files(): AgentFileCandidate[] {
    const snapshot = this.options.cache.snapshot();
    const counts =
      snapshot.projectPath === ""
        ? new Map<string, number>()
        : this.options.database.read_file_counts(snapshot.projectPath);
    return [
      ...this.options.cache.files.readFileEntries().map((file): AgentFileCandidate => ({
        kind: "workspace",
        path: file.rel_path,
        count: counts.get(file.rel_path) ?? 0,
        unit: file.file_type === "PDF" ? "pages" : "items",
      })),
      ...this.uploads
        .list()
        .map((file): AgentFileCandidate => ({ kind: "upload", path: file.path, size: file.size })),
    ];
  }
  private readonly root_path: string;
  private active: ActiveAgentWorkspace | null = null; // 当前磁盘快照的工程身份、语言和版本基线
  private source_session: AgentWorkspaceSourceSession | null = null; // 独立于显式 Agent reset 存活
  private work_session: AgentWorkspaceWorkSession | null = null; // 不读取目录内容，只拥有生命周期
  private busy = false; // snapshot、script 与 apply 共用的进程内互斥
  private readonly link_versions = { work: 0, sources: 0, snapshot: 0, uploads: 0 }; // 原生对话框等待期间的来源有效期

  /** 注入当前工程读侧、唯一写入口与 Node 脚本端口。 */
  public constructor(
    private readonly options: {
      images: Pick<AgentImageService, "prepare">;
      paths: Pick<AppPathService, "get_agent_workspace_root_dir">;
      settings: Pick<AppSettingService, "read_setting">;
      sessionState: Pick<ProjectSessionState, "require_loaded_project_path">;
      cache: CacheReadPort;
      proofreading: Pick<ProofreadingQueryService, "query_warnings">;
      database: Pick<
        ProjectDatabase,
        | "get_all_meta"
        | "read_asset_content"
        | "read_pdf_document"
        | "read_pdf_documents"
        | "read_file_counts"
      >;
      runtimeGate: {
        run_agent_project_write(
          operation: () => Promise<AgentWorkspaceStoreResult>,
        ): Promise<AgentWorkspaceStoreResult>;
      };
      writeStore: Pick<ProjectWriteStore, "apply_agent_workspace_changes">;
      logManager: Pick<LogManager, "warning">;
      run: AgentWorkspaceRunPort;
      pdfHost?: PDFHost | undefined;
      runtimeDirectory: string; // 当前应用版本部署的预加载模块与 npm 依赖目录
      openDirectory: (path: string) => Promise<void>;
      pickSavePath: (defaultName: string) => Promise<string | null>;
      nativeFs?: NativeFs;
    },
  ) {
    this.root_path = options.paths.get_agent_workspace_root_dir();
    this.uploads = new AgentUploadStore(this.root_path, this.native_fs);
  }

  /** 生产默认使用共享 NativeFs，测试只在显式注入时替换。 */
  private get native_fs(): NativeFs {
    return this.options.nativeFs ?? default_native_fs;
  }

  /** work 固定挂在 Workspace 根，替换 snapshot 时无需搬运内容。 */
  private get work_path(): string {
    return path.join(this.root_path, AGENT_WORKSPACE_WORK_ROOT);
  }

  /** 文件保存确认时的内容；等待用户选择位置期间不占用脚本互斥。 */
  public async activate_path(href: unknown): Promise<AgentWorkspaceLinkResult> {
    const target = this.resolve_path(href);
    const version = this.link_versions[target.scope];
    try {
      if (target.kind === "directory") {
        await this.options.openDirectory(target.path);
        return { status: "opened" };
      }
      const destination = await this.options.pickSavePath(path.basename(target.path));
      if (destination === null) return { status: "cancelled" };
      return await this.exclusive(async () => {
        if (version !== this.link_versions[target.scope]) {
          throw new AppErrors.AppError("file.not_found");
        }
        const current = this.resolve_path(href);
        if (current.kind !== "file" || current.path !== target.path) {
          throw new AppErrors.AppError("file.not_found");
        }
        if (!path.isAbsolute(destination)) {
          throw new AppErrors.AppError("request.validation_failed");
        }
        const root = this.native_fs.real_path(this.root_path);
        const parent = this.native_fs.real_path(path.dirname(destination));
        // 目录联接与已存在的符号链接同样不得把保存写回 Agent 工作资产。
        if (
          is_inside_path(root, parent) ||
          (this.native_fs.exists(destination) &&
            is_inside_path(root, this.native_fs.real_path(destination)))
        ) {
          throw new AppErrors.AppError("request.validation_failed");
        }
        // 同步复制和替换在当前 worker 回合内完成，清理与脚本无法插入其中。
        this.native_fs.copy_file_atomic(current.path, destination);
        return { status: "saved" };
      });
    } catch (cause) {
      if (AppErrors.is_app_error(cause)) throw cause;
      throw new AppErrors.AppError("file.io_failed", { cause });
    }
  }

  /** 会话开始失效时立即隔离待决保存，不等待旧模型和脚本停止。 */
  public invalidate_links(): void {
    this.link_versions.uploads += 1;
    this.link_versions.work += 1;
    this.link_versions.sources += 1;
    this.link_versions.snapshot += 1;
  }

  /** 两次检查共用工作区相对路径解码；文件访问沿目录链接自然到达目标。 */
  private resolve_path(href: unknown): WorkspacePath {
    if (typeof href !== "string") {
      throw new AppErrors.AppError("request.validation_failed");
    }
    let relative_path: string;
    try {
      // 链接片段不参与文件定位；百分号只在此解码一次，保留编码后的文件名字符。
      relative_path = decodeURIComponent(href.split(/[?#]/u, 1)[0]!);
    } catch (cause) {
      throw new AppErrors.AppError("request.validation_failed", { cause });
    }
    if (
      relative_path === "" ||
      /[\\:]/u.test(relative_path) ||
      relative_path.includes("\0") ||
      path.posix.isAbsolute(relative_path) ||
      relative_path.split("/").includes("..")
    ) {
      throw new AppErrors.AppError("request.validation_failed");
    }
    try {
      const file_path = path.resolve(this.root_path, relative_path);
      const inside_path = path.relative(this.root_path, file_path);
      const stat = this.native_fs.stat(file_path);
      if (!stat.isFile() && !stat.isDirectory()) {
        throw new AppErrors.AppError("file.invalid_structure");
      }
      const scope = inside_path.split(path.sep)[0];
      return {
        path: file_path,
        kind: stat.isDirectory() ? "directory" : "file",
        scope: scope === "work" || scope === "sources" || scope === "uploads" ? scope : "snapshot",
      };
    } catch (cause) {
      if (AppErrors.is_app_error(cause)) throw cause;
      const missing =
        cause instanceof Error &&
        "code" in cause &&
        (cause.code === "ENOENT" || cause.code === "ENOTDIR");
      throw new AppErrors.AppError(missing ? "file.not_found" : "file.io_failed", { cause });
    }
  }

  /** 启动时清除崩溃遗留目录，工作区从不跨应用生命周期恢复。 */
  public async initialize(): Promise<void> {
    await this.uploads.clear();
    this.invalidate_links();
    this.active = null;
    this.source_session = null;
    this.work_session = null;
    // 按工作区入口清理；Node 删除遇到的目录链接本身，外部部署目录不参与递归。
    await this.native_fs.remove_async(this.root_path, { recursive: true, force: true });
    await this.native_fs.make_dir_async(this.root_path);
    this.native_fs.copy_file(
      path.join(this.options.runtimeDirectory, "package.json"),
      path.join(this.root_path, "package.json"),
    );
    this.native_fs.create_directory_link(
      this.native_fs.real_path(path.join(this.options.runtimeDirectory, "node_modules")),
      path.join(this.root_path, "node_modules"),
    );
  }

  /** 工作区工具按需建立完整只读快照和空 change 文件。 */
  private async create_snapshot_locked(): Promise<void> {
    const project_path = this.options.sessionState.require_loaded_project_path();
    const start_snapshot = this.options.cache.snapshot();
    assert_snapshot_project(
      start_snapshot,
      project_path,
      "agent_workspace_snapshot_project_changed",
    );
    const revisions = pick_workspace_revisions(start_snapshot.sectionRevisions);
    const language = read_workspace_language(this.options.settings.read_setting());
    const language_key = JsonTool.stringifyStrict(language);
    await this.discard_incompatible_work({
      projectPath: project_path,
      projectEpoch: start_snapshot.epoch,
      languageKey: language_key,
    });
    const current_items = [...this.options.cache.items.readItems()];
    const snapshot_files = this.options.cache.files
      .readFileEntries()
      .sort((a, b) => a.sort_index - b.sort_index)
      .map((entry) => ({
        file_path: entry.rel_path,
        file_type: entry.file_type,
      }));
    const file_order = new Map(snapshot_files.map((file, i) => [file.file_path, i]));
    current_items.sort(
      (a, b) =>
        (file_order.get(a.file_path) ?? 0) - (file_order.get(b.file_path) ?? 0) ||
        a.row_number - b.row_number ||
        a.item_id - b.item_id,
    );
    const quality_block = this.options.cache.quality.readBlock();
    const quality_entries = Object.fromEntries(
      QUALITY_RULE_KINDS.map((kind) => [kind, read_quality_entries(quality_block, kind)]),
    ) as Record<QualityRuleKind, JsonRecord[]>;
    const prompts = project_workspace_prompts(this.options.cache.prompts.readBlock());
    const warning_result = await this.options.proofreading.query_warnings({
      warning_types: [...PROOFREADING_WARNING_CODES],
      keywords: [],
      scope: "all",
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    assert_snapshot_dependencies_fresh({
      projectPath: project_path,
      snapshot: start_snapshot,
      current: this.options.cache.snapshot(),
      warnings: warning_result,
      languageKey: language_key,
      currentLanguageKey: JsonTool.stringifyStrict(
        read_workspace_language(this.options.settings.read_setting()),
      ),
    });
    const files = await this.ensure_sources({
      projectPath: project_path,
      projectEpoch: start_snapshot.epoch,
      filesRevision: read_json_integer(start_snapshot.sectionRevisions.files, 0),
      files: snapshot_files,
    });

    const pdf_documents = snapshot_files.some((file) => file.file_type === "PDF")
      ? this.options.database.read_pdf_documents(project_path)
      : [];
    const project_meta: JsonRecord = {
      ...language,
      counts: {
        files: files.length,
        items: current_items.length,
        pages: pdf_documents.reduce((count, { document }) => count + document.pages.length, 0),
        items_with_warnings: warning_result.data.items.length,
        ...Object.fromEntries(
          QUALITY_RULE_KINDS.map((kind) => [kind, quality_entries[kind].length]),
        ),
      },
      files,
    };
    await this.clear_snapshot();
    try {
      // 所有并行写入必须结算后再清理；否则迟到写入会在失败目录删除后复活半成品。
      const write_results = await Promise.allSettled([
        ...Object.entries(AGENT_WORKSPACE_REFERENCES).map(([relative_path, content]) =>
          this.native_fs.write_file(path.join(this.root_path, relative_path), content),
        ),
        write_jsonl_file(
          this.native_fs,
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.pages),
          pdf_documents.flatMap(({ file_path, document }) =>
            document.pages.map((page) => ({
              file_path,
              fp: agent_workspace_page_fingerprint(file_path, document.digest, page),
              digest: document.digest,
              ...page,
            })),
          ) as unknown as JsonRecord[],
        ),
        write_json_file(
          this.native_fs,
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.projectMeta),
          project_meta,
        ),
        write_json_file(
          this.native_fs,
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.contract),
          AGENT_WORKSPACE_CONTRACT,
        ),
        write_jsonl_file(
          this.native_fs,
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.items),
          map_iterable(current_items, project_agent_workspace_item),
        ),
        write_json_file(
          this.native_fs,
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.prompts),
          Object.fromEntries(
            Object.entries(prompts).map(([kind, text]) => [
              kind,
              project_agent_workspace_prompt(kind as "translation", String(text)),
            ]),
          ),
        ),
        write_jsonl_file(
          this.native_fs,
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.warnings),
          map_iterable(warning_result.data.items, project_agent_workspace_warning),
        ),
        ...QUALITY_RULE_KINDS.map((kind) =>
          write_jsonl_file(
            this.native_fs,
            path.join(this.root_path, AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind]),
            map_iterable(quality_entries[kind], (entry, index) =>
              project_agent_workspace_quality_entry(kind, entry, index),
            ),
          ),
        ),
        ...all_change_paths().map((relative_path) =>
          this.native_fs.write_file(path.join(this.root_path, relative_path), ""),
        ),
      ]);
      const write_failure = write_results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (write_failure !== undefined) throw write_failure.reason;
      await this.ensure_work({
        projectPath: project_path,
        projectEpoch: start_snapshot.epoch,
        languageKey: language_key,
      });
    } catch (error) {
      await this.clear_snapshot();
      throw error;
    }

    this.active = {
      projectPath: project_path,
      projectEpoch: start_snapshot.epoch,
      revisions,
      languageKey: language_key,
    };
  }

  /** 脚本直接修改可写工作目录；失败、超时和停止都保留已经完成的文件写入。 */
  public async run(
    script: string,
    todos: readonly string[],
    signal: AbortSignal,
  ): Promise<AgentWorkspaceRunResult & { images: AgentWorkspaceImage[] }> {
    return await this.exclusive(async () => {
      // 槽位按请求到达顺序分配，异步转换完成顺序不能改变模型看到的图片顺序。
      const output_images = new Set<{ path: string; image: AgentImage | null }>();
      let image_bytes = 0; // 仅累计已接收图片的 base64 字节，本次程序结束后释放额度。
      // 失败记录保留定位信息，供后续程序从已有文件重新输出。
      const image_summary = () =>
        [...output_images.values()].flatMap(({ path, image }) =>
          image === null
            ? []
            : [
                {
                  path,
                  mime_type: image.mimeType,
                  width: image.width,
                  height: image.height,
                  original_width: image.originalWidth,
                  original_height: image.originalHeight,
                },
              ],
        );
      const active = this.active;
      if (active === null || !this.read_freshness(active).snapshotFresh) {
        await this.create_snapshot_locked();
      }
      try {
        signal.throwIfAborted();
        const run_path = `${AGENT_WORKSPACE_RUN_ROOT}/${randomBytes(RUN_ID_BYTES).toString("hex")}`;
        const script_path = `${run_path}.mjs`;
        await this.native_fs.write_file(path.join(this.root_path, script_path), script);
        const result = await this.options.run(
          {
            workspacePath: this.root_path,
            scriptPath: script_path,
            stdoutPath: `${run_path}.stdout.log`,
            stderrPath: `${run_path}.stderr.log`,
            todos,
            emitImage: async (relative, image_signal, options) => {
              image_signal.throwIfAborted();
              if (output_images.size >= AGENT_WORKSPACE_RUNTIME_POLICY.imageCount)
                throw new Error(
                  `Cannot emit ${JSON.stringify(relative)}: this program accepts at most ${AGENT_WORKSPACE_RUNTIME_POLICY.imageCount} images. Emit remaining images in subsequent workspace_run calls.`,
                );
              const entry = { path: relative, image: null as AgentImage | null };
              output_images.add(entry);
              try {
                // CodeAct 使用文件路径，链接解码只用于现有 resolve_path 入口。
                const target = this.resolve_path(
                  relative.split("/").map(encodeURIComponent).join("/"),
                );
                if (
                  target.kind !== "file" ||
                  this.native_fs.stat(target.path).size > AGENT_IMAGE_INPUT_MAX_BYTES
                )
                  throw new Error("Image input is not a supported size file.");
                const image = await this.options.images.prepare(
                  this.native_fs.read_file(target.path),
                  image_signal,
                  options,
                );
                image_signal.throwIfAborted();
                if (
                  image_bytes + image.data.length >
                  AGENT_WORKSPACE_RUNTIME_POLICY.imageOutputBytes
                )
                  throw new Error(
                    `Cannot emit ${JSON.stringify(relative)}: total encoded image data would exceed ${AGENT_WORKSPACE_RUNTIME_POLICY.imageOutputBytes / 1024 / 1024} MiB for this program. Split images across subsequent workspace_run calls, or crop relevant regions or lower maxEdge before retrying.`,
                  );
                image_bytes += image.data.length;
                entry.image = image;
              } finally {
                // 被拒绝的请求释放预留槽位，脚本捕获错误后仍可继续输出。
                if (entry.image === null) output_images.delete(entry);
              }
            },
            host: create_workspace_host({
              root: this.root_path,
              nativeFs: this.native_fs,
              pdfHost: this.options.pdfHost,
            }),
          },
          signal,
        );
        return {
          ...result,
          images: [...output_images.values()].flatMap(({ path, image }) =>
            image === null ? [] : [{ path, image }],
          ),
        };
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof AgentWorkspaceRunError) {
          throw new AppErrors.AppError("request.validation_failed", {
            cause: error,
            public_details: {
              action: "workspace_run",
              message: error.message,
              ...error.execution,
              ...(output_images.size === 0 ? {} : { images: image_summary() }),
            },
            diagnostic_context: { reason: "agent_workspace_execution_failed" },
          });
        }
        throw workspace_recovery_error(error, "agent_workspace_execute_host_failed");
      }
    });
  }

  /** 一次准备真实差异，按需等待审批，再把同一份差异交给跨 section 事务。 */
  public async apply_workspace(
    request_approval?: (summary: AgentPendingWriteSummary) => Promise<void>,
  ): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      const freshness = this.read_freshness(active);
      if (!freshness.workCompatible) {
        await this.clear_snapshot();
        await this.discard_work();
        throw workspace_validation_error("agent_workspace_stale");
      }
      let parsed;
      try {
        parsed = await prepare_agent_workspace_changes({
          nativeFs: this.native_fs,
          workspacePath: this.root_path,
        });
      } catch (error) {
        if (AppErrors.is_app_error(error) && error.code === "request.validation_failed")
          throw error;
        await this.clear_snapshot();
        throw workspace_recovery_error(error, "agent_workspace_apply_prepare_failed");
      }
      let preview: ReturnType<typeof resolve_agent_workspace_writes>;
      let all_rejected: AgentWorkspaceRejectedChange[];
      try {
        const current: AgentWorkspaceCurrentFacts = {
          items: this.options.cache.items.readItems() as unknown as JsonRecord[],
          pdfDocuments: [...new Set(parsed.batch.pages.map((intent) => intent.file_path))].flatMap(
            (file_path) => {
              const document = this.options.database.read_pdf_document(
                active.projectPath,
                file_path,
              );
              return document ? [{ file_path, document }] : [];
            },
          ),
          quality: Object.fromEntries(
            QUALITY_RULE_KINDS.map((kind) => [
              kind,
              read_quality_entries(this.options.cache.quality.readBlock(), kind),
            ]),
          ),
          prompts: Object.fromEntries(
            Object.entries(project_workspace_prompts(this.options.cache.prompts.readBlock())),
          ),
          duplicateFilterEnabled: this.read_duplicate_filter_enabled(active.projectPath),
        };
        preview = resolve_agent_workspace_writes({ batch: parsed.batch, current });
        all_rejected = normalize_workspace_rejections(
          [...parsed.rejected, ...preview.rejected],
          parsed.batch,
          this.root_path,
          this.native_fs,
        );
      } catch (error) {
        await this.clear_snapshot();
        throw workspace_recovery_error(error, "agent_workspace_apply_preview_failed");
      }
      if (!has_agent_workspace_applied_changes(preview.applied)) {
        const status = derive_agent_workspace_apply_status({}, all_rejected);
        const destroyed = all_rejected.some(
          (rejection) =>
            rejection.reason === "fp_mismatch" || rejection.reason === "target_missing",
        );
        if (destroyed) await this.clear_snapshot();
        return {
          status,
          applied: {},
          rejected: all_rejected,
          destroyed,
          revisions: pick_apply_revisions(this.options.cache.snapshot().sectionRevisions),
        };
      }
      await request_approval?.(summarize_applied_changes(preview.applied));

      let write_ack: AgentWorkspaceStoreResult;
      try {
        write_ack = await this.options.runtimeGate.run_agent_project_write(
          async () =>
            await this.options.writeStore.apply_agent_workspace_changes({
              projectPath: active.projectPath,
              source: "agent_workspace_apply",
              batch: preview.candidates,
            }),
        );
      } catch (error) {
        if (AppErrors.is_app_error(error) && error.code === "data.committed_sync_failed") {
          await this.clear_snapshot();
          throw error;
        }
        throw workspace_error_with_action(error, "workspace_apply");
      }
      // Store 只接收已匹配活动基线的 preview candidates，事务新增 mismatch 必然来自外部漂移。
      const rejected = [...all_rejected, ...write_ack.rejected];
      const result = {
        status: derive_agent_workspace_apply_status(write_ack.applied, rejected),
        applied: write_ack.applied,
        rejected,
        destroyed: write_ack.destroyed,
        revisions: pick_apply_revisions(write_ack.sectionRevisions),
      };
      if (write_ack.destroyed) await this.clear_snapshot();
      return result;
    });
  }

  /** 显式 Agent reset 销毁当前快照和工作材料目录，同一工程会话继续复用源文件投影。 */
  public async reset_workspace(): Promise<void> {
    await this.uploads.clear();
    this.invalidate_links();
    await this.clear_snapshot();
    await this.discard_work();
  }

  /** 工程切换先销毁旧投影；非空路径表示为当前工程立即生成 sources。 */
  public async reset_project(project_path: string | null): Promise<void> {
    await this.uploads.clear();
    this.invalidate_links();
    await this.clear_snapshot();
    await this.discard_work();
    this.source_session = null;
    await this.remove_workspace_directory(path.join(this.root_path, "sources"));
    if (project_path === null) return;
    const snapshot = this.options.cache.snapshot();
    try {
      assert_snapshot_project(snapshot, project_path, "agent_workspace_snapshot_project_changed");
      await this.ensure_sources({
        projectPath: project_path,
        projectEpoch: snapshot.epoch,
        filesRevision: read_json_integer(snapshot.sectionRevisions.files, 0),
        files: this.options.cache.files.readFileEntries().map((entry) => ({
          file_path: entry.rel_path,
          file_type: entry.file_type,
        })),
      });
    } catch (error) {
      // sources 是 Agent 附属投影，生成失败不能回滚已经成功的工程加载；下一次 workspace_run 会重试。
      this.options.logManager.warning("Agent 工程源文件投影生成失败。", {
        source: "agent_workspace",
        error,
      });
    }
  }

  /** 比较当前工程事实；work 只依赖工程身份与语言，不依赖普通 section revision。 */
  private read_freshness(active: ActiveAgentWorkspace): {
    snapshotFresh: boolean;
    workCompatible: boolean;
  } {
    const snapshot = this.options.cache.snapshot();
    const language_key = JsonTool.stringifyStrict(
      read_workspace_language(this.options.settings.read_setting()),
    );
    const work_compatible =
      snapshot.projectPath === active.projectPath &&
      snapshot.epoch === active.projectEpoch &&
      language_key === active.languageKey;
    const snapshot_fresh =
      work_compatible &&
      PROJECT_DATA_SECTIONS.every(
        (section) =>
          read_json_integer(snapshot.sectionRevisions[section], 0) ===
          read_json_integer(active.revisions[section], 0),
      );
    return { snapshotFresh: snapshot_fresh, workCompatible: work_compatible };
  }

  /** Agent 预演读取项目持久镜像，确保审批采用与事务提交相同的重复过滤口径。 */
  private read_duplicate_filter_enabled(project_path: string): boolean {
    const meta = read_json_record(this.options.database.get_all_meta(project_path));
    return normalize_project_settings_snapshot(
      meta,
      normalize_project_settings_snapshot(read_json_record(meta["prefilter_config"])),
    ).skip_duplicate_source_text_enable;
  }

  /** apply 仍要求已有脚本准备出的活动快照。 */
  private require_active(): ActiveAgentWorkspace {
    if (this.active === null) {
      throw workspace_validation_error("agent_workspace_missing");
    }
    return this.active;
  }

  /** 每个工作区文件快照展开一次，连续 `workspace_run` 复用同一个 `sources` 目录。 */
  private async ensure_sources(args: {
    projectPath: string;
    projectEpoch: number;
    filesRevision: number;
    files: ReadonlyArray<{ file_path: string; file_type: string }>;
  }): Promise<AgentWorkspaceSourceFile[]> {
    const current = this.source_session;
    if (
      current?.projectPath === args.projectPath &&
      current.projectEpoch === args.projectEpoch &&
      current.filesRevision === args.filesRevision
    ) {
      return current.files.map((file) => ({ ...file }));
    }
    const source_path = path.join(this.root_path, "sources");
    this.link_versions.sources += 1;
    this.source_session = null;
    // reset_project 已隔离旧工作区，snapshot、run 与 apply 由 exclusive 串行；完整生成前应用内没有 sources 读者。
    await this.native_fs.remove_async(source_path, { recursive: true, force: true });
    try {
      const files = await write_agent_workspace_sources({
        nativeFs: this.native_fs,
        sourceRoot: source_path,
        files: args.files,
        readAsset: (file_path) =>
          this.options.database.read_asset_content(args.projectPath, file_path),
      });
      this.source_session = { ...args, files: files.map((file) => ({ ...file })) };
      return files;
    } catch (error) {
      await this.remove_workspace_directory(source_path);
      throw error;
    }
  }

  /** 快照读取前已清除不相容身份；无身份时须删除可能残留的旧材料后再建立目录。 */
  private async ensure_work(args: AgentWorkspaceWorkSession): Promise<void> {
    if (this.work_session === null) {
      this.link_versions.work += 1;
      await this.native_fs.remove_async(this.work_path, { recursive: true, force: true });
    }
    await this.native_fs.make_dir_async(this.work_path);
    this.work_session = { ...args };
  }

  /** 新快照尚未生成成功时也不能让身份或语言不兼容的旧 work 继续暴露。 */
  private async discard_incompatible_work(args: AgentWorkspaceWorkSession): Promise<void> {
    const current = this.work_session;
    if (
      current === null ||
      (current.projectPath === args.projectPath &&
        current.projectEpoch === args.projectEpoch &&
        current.languageKey === args.languageKey)
    ) {
      return;
    }
    await this.discard_work();
  }

  /** 清除数据快照与工作变更，保留独立生命周期的 sources 和 work。 */
  private async clear_snapshot(): Promise<void> {
    this.link_versions.snapshot += 1;
    this.active = null;
    const targets = [
      AGENT_WORKSPACE_PATHS.projectMeta,
      AGENT_WORKSPACE_PATHS.contract,
      AGENT_WORKSPACE_PATHS.reference,
      "items",
      "pages",
      AGENT_WORKSPACE_PATHS.prompts,
      ...QUALITY_RULE_KINDS,
      "changes",
    ];
    await Promise.all(
      targets.map((relative_path) =>
        this.native_fs.remove_async(path.join(this.root_path, relative_path), {
          recursive: true,
          force: true,
        }),
      ),
    );
  }

  /** 先解除工作材料身份；删除失败的旧目录不会在下次 snapshot 建立时被静默复用。 */
  private async discard_work(): Promise<void> {
    this.link_versions.work += 1;
    this.work_session = null;
    await this.remove_workspace_directory(this.work_path);
  }

  /** 临时目录清理是尽力而为；活动身份已先解除，失败只进入诊断。 */
  private async remove_workspace_directory(workspace_path: string): Promise<void> {
    try {
      await this.native_fs.remove_async(workspace_path, { recursive: true, force: true });
    } catch (error) {
      this.options.logManager.warning("Agent 工作区临时目录清理失败。", {
        source: "agent_workspace",
        error,
      });
    }
  }

  /** snapshot、run 与 apply 在服务内串行，避免固定目录被交叉刷新。 */
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new AppErrors.AppError("runtime.busy");
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }
}

/** AgentService 通过工作区公开操作管理生命周期、执行工具与交付文件。 */
export type AgentWorkspacePort = Pick<
  AgentWorkspaceService,
  | "list_files"
  | "initialize"
  | "run"
  | "apply_workspace"
  | "reset_workspace"
  | "reset_project"
  | "activate_path"
  | "invalidate_links"
> & {
  uploads: Pick<AgentUploadStore, "upload" | "get" | "read_image" | "open" | "clear" | "cancel">;
};

/** 输入均为 realpath 结果，包含根目录本身。 */
function is_inside_path(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** 审批摘要只统计预演实际候选对象。 */
function summarize_applied_changes(
  applied: AgentWorkspaceAppliedSummary,
): AgentPendingWriteSummary {
  const quality = applied.quality ?? {};
  const count_quality = (kind: QualityRuleKind): number => {
    const summary = quality[kind];
    return summary === undefined ? 0 : summary.created + summary.updated + summary.deleted;
  };
  return {
    items: applied.items?.updated ?? 0,
    pages: applied.pages?.updated ?? 0,
    glossary: count_quality("glossary"),
    textPreserve: count_quality("text_preserve"),
    preReplacement: count_quality("pre_replacement"),
    postReplacement: count_quality("post_replacement"),
    prompts: applied.prompts?.updated.length ?? 0,
  };
}

/** 只有与活动快照一致的旧 fp 才表示外部漂移，其余 mismatch 归为输入错误。 */
function normalize_workspace_rejections(
  rejections: readonly AgentWorkspaceRejectedChange[],
  batch: AgentWorkspaceIntentBatch,
  workspace_path: string,
  native_fs: NativeFs,
): AgentWorkspaceRejectedChange[] {
  const drift_candidates = rejections.filter(
    (rejection) => rejection.reason === "fp_mismatch" || rejection.reason === "target_missing",
  );
  if (drift_candidates.length === 0) return [...rejections];

  // 仅加载发生 mismatch/missing 的数据集；活动快照是区分输入错误与外部事实漂移的权威基线。
  const item_candidates = drift_candidates.filter((rejection) => rejection.scope === "items");
  const baseline_items =
    item_candidates.length === 0
      ? new Map<number, string>()
      : new Map(
          read_workspace_jsonl(
            native_fs,
            path.join(workspace_path, AGENT_WORKSPACE_PATHS.items),
          ).map((row) => [read_json_integer(row["item_id"], 0), String(row["fp"] ?? "")]),
        );
  const quality_kinds = new Set(
    drift_candidates.flatMap((rejection) =>
      rejection.scope === "quality" &&
      typeof rejection.kind === "string" &&
      (QUALITY_RULE_KINDS as readonly string[]).includes(rejection.kind)
        ? [rejection.kind as QualityRuleKind]
        : [],
    ),
  );
  const baseline_quality = Object.fromEntries(
    [...quality_kinds].map((kind) => [
      kind,
      new Map(
        read_workspace_jsonl(
          native_fs,
          path.join(workspace_path, AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind]),
        ).map((row) => [String(row["id"] ?? ""), String(row["fp"] ?? "")]),
      ),
    ]),
  ) as Partial<Record<QualityRuleKind, Map<string, string>>>;
  const baseline_pages = drift_candidates.some((rejection) => rejection.scope === "pages")
    ? new Map(
        read_workspace_jsonl(native_fs, path.join(workspace_path, AGENT_WORKSPACE_PATHS.pages)).map(
          (row) => [JSON.stringify([row["file_path"], row["page"]]), String(row["fp"])],
        ),
      )
    : new Map<string, string>();
  const needs_prompts = drift_candidates.some((rejection) => rejection.scope === "prompts");
  const baseline_prompts = needs_prompts
    ? read_workspace_json(native_fs, path.join(workspace_path, AGENT_WORKSPACE_PATHS.prompts))
    : {};

  return rejections.map((rejection) => {
    if (rejection.reason !== "fp_mismatch" && rejection.reason !== "target_missing")
      return rejection;
    if (rejection.scope === "pages") {
      const fp = baseline_pages.get(JSON.stringify([rejection["file_path"], rejection["page"]]));
      const intents = batch.pages.filter(
        (intent) =>
          intent.file_path === rejection["file_path"] && intent.page === rejection["page"],
      );
      return fp !== undefined && intents.length > 0 && intents.every((intent) => intent.fp === fp)
        ? rejection
        : { ...rejection, reason: "invalid_change" };
    }
    const baseline_fp = read_rejection_baseline_fp(
      rejection,
      baseline_items,
      baseline_quality,
      baseline_prompts,
    );
    const intent_fps = read_rejection_intent_fps(rejection, batch);
    return baseline_fp !== undefined &&
      intent_fps.length > 0 &&
      intent_fps.every((fp) => fp === baseline_fp)
      ? rejection
      : { ...rejection, reason: "invalid_change" };
  });
}

/** 从活动快照读取目标指纹；缺失表示该 change 从未指向基线对象。 */
function read_rejection_baseline_fp(
  rejection: AgentWorkspaceRejectedChange,
  items: ReadonlyMap<number, string>,
  quality: Partial<Record<QualityRuleKind, ReadonlyMap<string, string>>>,
  prompts: JsonRecord,
): string | undefined {
  if (rejection.scope === "items" && typeof rejection.id === "number")
    return items.get(rejection.id);
  if (
    rejection.scope === "quality" &&
    typeof rejection.kind === "string" &&
    typeof rejection.id === "string" &&
    (QUALITY_RULE_KINDS as readonly string[]).includes(rejection.kind)
  )
    return quality[rejection.kind as QualityRuleKind]?.get(rejection.id);
  if (
    rejection.scope === "prompts" &&
    typeof rejection.kind === "string" &&
    (PROMPT_KINDS as readonly string[]).includes(rejection.kind)
  ) {
    const prompt = baseline_prompts_entry(prompts, rejection.kind as PromptKind);
    return prompt === undefined ? undefined : String(prompt["fp"] ?? "");
  }
  return undefined;
}

/** 找出同一拒绝对象的全部提交指纹，避免混合好坏行被误认成外部漂移。 */
function read_rejection_intent_fps(
  rejection: AgentWorkspaceRejectedChange,
  batch: AgentWorkspaceIntentBatch,
): string[] {
  if (rejection.scope === "items" && typeof rejection.id === "number")
    return batch.items
      .filter((intent) => intent.item_id === rejection.id)
      .map((intent) => intent.fp);
  if (
    rejection.scope === "quality" &&
    typeof rejection.kind === "string" &&
    typeof rejection.id === "string" &&
    (QUALITY_RULE_KINDS as readonly string[]).includes(rejection.kind)
  ) {
    const intents = batch.quality[rejection.kind as QualityRuleKind];
    return [...intents.updates, ...intents.deletes]
      .filter((intent) => intent.id === rejection.id)
      .map((intent) => intent.fp);
  }
  if (
    rejection.scope === "prompts" &&
    typeof rejection.kind === "string" &&
    (PROMPT_KINDS as readonly string[]).includes(rejection.kind)
  )
    return batch.prompts
      .filter((intent) => intent.kind === rejection.kind)
      .map((intent) => intent.fp);
  return [];
}

/** 活动 snapshot 文件由本服务生成；损坏时抛错并进入统一恢复路径。 */
function read_workspace_jsonl(native_fs: NativeFs, file_path: string): JsonRecord[] {
  return native_fs
    .read_text_file(file_path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const value = JsonTool.parseStrict(line);
      if (!is_json_record(value)) throw new TypeError("Agent workspace row is not an object.");
      return value;
    });
}

/** 读取工作区固定 JSON 对象，并拒绝被外部破坏的 snapshot 形状。 */
function read_workspace_json(native_fs: NativeFs, file_path: string): JsonRecord {
  const value = JsonTool.parseStrict(native_fs.read_text_file(file_path, "utf8"));
  if (!is_json_record(value)) throw new TypeError("Agent workspace file is not an object.");
  return value;
}

/** prompts.json 的每个固定 kind 都是带 fp 与正文的对象。 */
function baseline_prompts_entry(prompts: JsonRecord, kind: PromptKind): JsonRecord | undefined {
  const value = prompts[kind];
  return is_json_record(value) ? value : undefined;
}

/** 固定 change 路径只从共享 contract 词表展开，避免宿主与 Backend 分叉。 */
function all_change_paths(): string[] {
  return [
    AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
    AGENT_WORKSPACE_CHANGE_PATHS.pages.updates,
    AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
    ...QUALITY_RULE_KINDS.flatMap((kind) =>
      AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map(
        (operation) => AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
      ),
    ),
  ];
}

/** 工作区只冻结解释业务数据所需的源语言与目标语言。 */
function read_workspace_language(value: unknown): JsonRecord {
  const settings = normalize_setting_snapshot(value);
  return {
    source_language: settings.source_language,
    target_language: settings.target_language,
  };
}

/** 建立 snapshot 时复制完整七 section revision，隔离 cache 返回的可变引用。 */
function pick_workspace_revisions(
  revisions: ProjectDataSectionRevisions,
): ProjectDataSectionRevisions {
  return Object.fromEntries(
    PROJECT_DATA_SECTIONS.map((section) => [section, read_json_integer(revisions[section], 0)]),
  );
}

/** apply 回执只暴露本工具可能改变的 section。 */
function pick_apply_revisions(revisions: ProjectDataSectionRevisions): JsonRecord {
  return Object.fromEntries(
    (["items", "proofreading", "quality", "prompts", "pdf"] as const).map((section) => [
      section,
      read_json_integer(revisions[section], 0),
    ]),
  );
}

/** quality 快照复用生产归一化并要求项目内稳定身份。 */
function read_quality_entries(quality: JsonRecord, kind: QualityRuleKind): JsonRecord[] {
  const entries = normalize_quality_rule_entries(
    QualityRule.from_json(kind),
    read_json_record(quality[kind])["entries"] ?? [],
  ) as JsonRecord[];
  return entries;
}

/** prompt 快照只保留固定正文，不复制功能开关。 */
function project_workspace_prompts(block: JsonRecord): JsonRecord {
  return {
    [TRANSLATION_PROMPT.store_key]: normalize_translation_prompt_slice(
      block[TRANSLATION_PROMPT.store_key],
    ).text,
  };
}

/** sessionState 与 cache 必须指向同一当前工程。 */
function assert_snapshot_project(
  snapshot: CacheSnapshot,
  project_path: string,
  reason: string,
): void {
  if (snapshot.projectPath !== project_path) {
    throw workspace_validation_error(reason);
  }
}

/** 异步派生数据全部完成后复核依赖，禁止落盘混合时点快照。 */
function assert_snapshot_dependencies_fresh(args: {
  projectPath: string;
  snapshot: CacheSnapshot;
  current: CacheSnapshot;
  warnings: { projectPath: string; sectionRevisions: ProjectDataSectionRevisions };
  languageKey: string;
  currentLanguageKey: string;
}): void {
  const same_snapshot =
    args.current.projectPath === args.snapshot.projectPath &&
    args.current.epoch === args.snapshot.epoch &&
    PROJECT_DATA_SECTIONS.every(
      (section) =>
        read_json_integer(args.current.sectionRevisions[section], 0) ===
        read_json_integer(args.snapshot.sectionRevisions[section], 0),
    );
  const warnings_fresh =
    args.warnings.projectPath === args.projectPath &&
    (["items", "quality", "proofreading"] as const).every(
      (section) =>
        read_json_integer(args.warnings.sectionRevisions[section], 0) ===
        read_json_integer(args.snapshot.sectionRevisions[section], 0),
    );
  if (!same_snapshot || !warnings_fresh || args.languageKey !== args.currentLanguageKey) {
    throw workspace_validation_error("agent_workspace_snapshot_dependencies_changed");
  }
}

/** JSON 固定使用严格序列化、两空格缩进和结尾换行。 */
async function write_json_file(
  native_fs: NativeFs,
  file_path: string,
  value: JsonRecord,
): Promise<void> {
  await native_fs.write_file(file_path, `${JsonTool.stringifyStrict(value, { indent: 2 })}\n`);
}

/** 边界投影保持惰性，避免 JSONL 落盘前再复制一份完整数组。 */
function* map_iterable<T>(
  values: Iterable<T>,
  project: (value: T, index: number) => JsonRecord,
): Generator<JsonRecord> {
  let index = 0;
  for (const value of values) yield project(value, index++);
}

/** JSONL 逐条严格序列化到流，空集合仍会创建固定文件。 */
async function write_jsonl_file(
  native_fs: NativeFs,
  file_path: string,
  values: Iterable<JsonRecord>,
): Promise<void> {
  await pipeline(
    Readable.from(
      (function* () {
        for (const value of values) yield `${JsonTool.stringifyStrict(value)}\n`;
      })(),
    ),
    native_fs.create_write_stream(file_path),
  );
}

/** 工作区业务校验统一返回下一步恢复动作。 */
function workspace_validation_error(reason: string): AppErrors.AppError {
  return new AppErrors.AppError("request.validation_failed", {
    public_details: { action: "workspace_run" },
    diagnostic_context: { reason },
  });
}

/** 无法继续使用当前目录的错误统一回到按需工作区脚本。 */
function workspace_recovery_error(error: unknown, reason: string): AppErrors.AppError {
  return workspace_error_with_action(error, "workspace_run", reason);
}

/** 包装错误时保留稳定 code、公开详情、诊断上下文和原始 cause。 */
function workspace_error_with_action(
  error: unknown,
  action: "workspace_run" | "workspace_apply",
  reason?: string,
): AppErrors.AppError {
  if (AppErrors.is_app_error(error)) {
    return new AppErrors.AppError(error.code, {
      cause: error,
      public_details: { ...error.public_details, action },
      diagnostic_context: {
        ...error.diagnostic_context,
        ...(reason === undefined ? {} : { reason }),
      },
    });
  }
  return new AppErrors.AppError("runtime.internal_invariant", {
    cause: error,
    public_details: { action },
    diagnostic_context: reason === undefined ? {} : { reason },
  });
}
