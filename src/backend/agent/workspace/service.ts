import { create_file_generator } from "../tools/generate-files";
import { create_image_text_renderer } from "../tools/render-image-text";
import type { ImageTextHost } from "../../../shared/image-text";
import type { TranslationFileGenerationService } from "../../file/translation-file-generation-service";
import type { ProjectKnowledgeService } from "../../project/project-knowledge-service";
import { AGENT_DOCUMENT_MAX_BYTES } from "../../../shared/agent";
import type { ProjectContentService } from "../../project/project-content-service";
import { preview_file_changes } from "./file-changes";
import type { ParsedAgentWorkspaceChanges } from "./changes";
import { AgentWorkspaceDirectories } from "./directories";
import type { AgentFileAttachment } from "../../../shared/agent";
import type { ProofreadingClientItem } from "../../../shared/proofreading/proofreading-types";
import type { AgentWorkspaceWarning } from "./schema";
import { create_image_output, summarize_images } from "../tools/emit-image";
import type { AgentFile } from "../../../shared/agent-workspace-file";
import type { AgentFileCandidate } from "../../../shared/agent-reference";
import { create_pdf_printer } from "../tools/print-pdf";
import { is_agent_cancellation } from "../tool-definition";
import { AgentUploadStore } from "./uploads";
import { AGENT_IMAGE_INPUT_MAX_BYTES, type AgentImageService } from "../agent-image-service";
import type { AgentImage } from "../../../shared/agent-image";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decode_text_content } from "../../../shared/utils/text-tool";
import { is_agent_file_url, resolve_agent_text_format } from "../../../shared/agent-workspace-file";
import { resolve_workspace_image_mime } from "../../../shared/image-formats";

import type { PDFHost } from "../../../shared/pdf";
import { random_id } from "../../../shared/utils/identifier";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { is_json_record, read_json_integer, type JsonRecord } from "../../../domain/json";
import {
  TRANSLATION_PROMPT,
  PROMPT_KINDS,
  type PromptKind,
  type ProjectPrompts,
} from "../../../domain/prompt";
import {
  QUALITY_RULE_KINDS,
  type QualityRuleEntry,
  type QualityRuleKind,
} from "../../../domain/quality";
import { type ProjectLanguageSettings } from "../../../domain/project-settings";
import * as AppErrors from "../../../shared/error";
import type { AgentPendingWriteSummary, AgentWorkspaceLinkResult } from "../../../shared/agent";
import {
  PROJECT_DATA_SECTIONS,
  type ProjectDataSectionRevisions,
} from "../../../shared/project-event";
import { PROOFREADING_WARNING_CODES } from "../../../shared/proofreading/proofreading-types";
import { JsonTool } from "../../../shared/utils/json-tool";
import { NativeFs, default_native_fs } from "../../../native/native-fs";
import type { AppPathService } from "../../app/app-path-service";
import type { CacheReadPort } from "../../cache/cache-types";
import type { ProjectOperationGate } from "../../runtime-operation-gate";
import type { LogWriter } from "../../log/log-manager";
import type { ProjectDatabase } from "../../database/database-operations";
import type { ProofreadingQueryService } from "../../proofreading/proofreading-query-service";
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
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
} from "./paths";
import {
  AgentWorkspaceRunError,
  type AgentWorkspaceRunRequest,
  type AgentWorkspaceExecution,
} from "./runtime/runner";
import { prepare_agent_workspace_changes } from "./changes";
import { AGENT_WORKSPACE_RUN_ROOT, AGENT_WORKSPACE_WORK_ROOT } from "./runtime/policy";
import { write_agent_workspace_sources, type WorkspaceSourceResult } from "./sources";
import { watch_agent_process_output, type AgentProcessOutputTail } from "../process-output";
import type { AgentPackageSources } from "../package-source";

const AGENT_IMAGE_MAX_BYTES = 16 * 1024 * 1024;

/** 公开失败阶段，供模型恢复与诊断定位使用。 */
enum WorkspaceRunPhase {
  PREPARE_SNAPSHOT = "prepare_snapshot",
  PREPARE_WORKSPACE = "prepare_workspace",
  SAVE_SCRIPT = "save_script",
  EXECUTE = "execute",
}

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
) => Promise<AgentWorkspaceExecution>;

export type AgentWorkspaceImage = Readonly<{ path: string; image: AgentImage }>;

/** 一次工作区执行的输入，`output` 只供界面观察运行中的日志末尾。 */
export type AgentWorkspaceRunInput = Readonly<{
  search?: AgentWorkspaceRunRequest["search"];
  script: string;
  timeoutMs: number;
  doing?: AgentWorkspaceRunRequest["doing"];
  output?: (output: AgentProcessOutputTail) => void;
  onFilesGenerated?: () => void; // 生成成功即通知本轮，即使脚本后续步骤失败。
}>;

type ActiveAgentWorkspace = {
  revisions: ProjectDataSectionRevisions; // 全部数据分区快照
  language: ProjectLanguageSettings; // 语言改变后必须重做变更清单。
};

/** `sources` 只跟随本工作区所属工程的文件修订。 */
type AgentWorkspaceSourceCache = {
  filesRevision: number; // 只在源资产集合变化时重新生成
  assets: Map<string, WorkspaceSourceResult>;
};

type WorkspacePath = Readonly<{
  path: string;
  href: string; // 规范文件身份，由解析入口统一计算。
  kind: "file" | "directory";
  scope: "work" | "sources" | "snapshot" | "uploads" | "external"; // 内部按访问入口匹配清理生命周期，目录链接目标可在外部。
}>;

/** 当前 Agent 会话磁盘工作区。协调跨快照 work、当前数据快照与 apply。 */
export class AgentWorkspaceService {
  private upload_store: AgentUploadStore | null = null; // 随目录切换重建当前上传登记
  private chat_id: string | null = null; // 当前目录归属，关闭期间解除绑定
  private readonly directories: AgentWorkspaceDirectories;

  /** 工作区服务可跨对话复用，告警归属于操作所在的当前对话。 */
  private get log(): Pick<LogWriter, "warning"> {
    const log = this.options.logManager;
    return this.chat_id === null ? log : log.scope({ chat_id: this.chat_id });
  }

  /** 文件入口只取得当前激活会话的上传登记。 */
  public get uploads(): AgentUploadStore {
    if (this.upload_store === null) throw new AppErrors.AppError("project.not_loaded");
    return this.upload_store;
  }

  /** 所有相对路径绑定当前会话目录。 */
  public get root_path(): string {
    if (this.chat_id === null) throw new AppErrors.AppError("project.not_loaded");
    return this.directories.path(this.chat_id);
  }

  /** 查询现有文件事实，不触发工作区生成或解析原稿。 */
  public async list_files(): Promise<AgentFileCandidate[]> {
    const counts = new Map<string, number>();
    for (const item of this.options.cache.items.readItems())
      counts.set(item.file_path, (counts.get(item.file_path) ?? 0) + 1);
    return [
      ...this.options.cache.files.readFileEntries().map((file): AgentFileCandidate => ({
        kind: "workspace",
        path: file.rel_path,
        count: counts.get(file.rel_path) ?? 0,
      })),
      ...(this.upload_store?.list() ?? []).map((file): AgentFileCandidate => ({
        kind: "upload",
        path: file.path,
        size: file.size,
      })),
    ];
  }
  private active: ActiveAgentWorkspace | null = null; // 当前磁盘快照的语言和修订基线
  private source_cache: AgentWorkspaceSourceCache | null = null; // 当前激活目录内的源文件投影
  private busy = false; // snapshot、script 与 apply 共用的进程内互斥
  private readonly link_versions = { work: 0, sources: 0, snapshot: 0, uploads: 0 }; // 原生对话框等待期间的来源有效期

  /** 注入当前工程读侧、唯一写入口与 Node 脚本端口。 */
  public constructor(
    private readonly options: {
      images: Pick<AgentImageService, "prepare">;
      paths: Pick<AppPathService, "get_agent_workspace_root_dir">;
      projectPath: string;
      cache: CacheReadPort;
      proofreading: Pick<ProofreadingQueryService, "query_warnings">;
      database: Pick<ProjectDatabase, "read_asset_content" | "read_knowledge">;
      knowledge: Pick<ProjectKnowledgeService, "read">; // 投影与知识页共用补位模板
      runtimeGate: Pick<ProjectOperationGate, "run_agent_project_write">;
      files: Pick<ProjectContentService, "inspect_sources" | "apply_file_changes">;
      writeStore: Pick<ProjectWriteStore, "apply_agent_workspace_changes">;
      logManager: Pick<LogWriter, "warning" | "scope">;
      run: AgentWorkspaceRunPort;
      packageSources: Pick<AgentPackageSources, "resolve">;
      generation: Pick<
        TranslationFileGenerationService,
        "generate_staging_files" | "read_output_paths"
      >;
      pdfHost?: PDFHost | undefined;
      imageTextHost?: ImageTextHost | undefined;
      openDirectory: (path: string) => Promise<void>;
      pickSavePath: (defaultName: string) => Promise<string | null>;
      nativeFs?: NativeFs;
    },
  ) {
    this.directories = new AgentWorkspaceDirectories(
      options.paths.get_agent_workspace_root_dir(),
      this.native_fs,
      (error) =>
        this.log.warning("Agent 工作区目录操作失败。", {
          source: "agent_workspace",
          error,
        }),
    );
  }

  /** 生产默认使用共享 NativeFs，测试只在显式注入时替换。 */
  private get native_fs(): NativeFs {
    return this.options.nativeFs ?? default_native_fs;
  }

  /** work 固定挂在 Workspace 根，替换 snapshot 时无需搬运内容。 */
  private get work_path(): string {
    return path.join(this.root_path, AGENT_WORKSPACE_WORK_ROOT);
  }

  /** 文件入口共用规范路径、上传名称和预览能力。 */
  public describe_file(href: unknown): AgentFile {
    const { mime: _mime, ...file } = this.describe_target(this.resolve_path(href));
    return file;
  }

  /** 已解析目标复用上传记录与 MIME 规则，菜单、读取和保存采用同一文件身份。 */
  private describe_target(target: WorkspacePath): AgentFile & { mime: string | null } {
    const upload =
      target.scope === "uploads"
        ? this.uploads.list().find((file) => file.path === decodeURIComponent(target.href))
        : undefined;
    const filename = path.basename(target.path);
    const mime = upload?.imageMimeType ?? resolve_workspace_image_mime(filename);
    return {
      path: target.href,
      name: upload?.name ?? filename,
      kind: target.kind,
      mime,
      preview:
        target.kind === "directory"
          ? null
          : mime
            ? "image"
            : resolve_agent_text_format(target.href),
    };
  }

  /** 目录打开，外部文件打开所在目录，内部文件保存确认时的内容。 */
  public async activate_path(href: unknown): Promise<AgentWorkspaceLinkResult> {
    const target = this.resolve_path(href);
    try {
      if (target.kind === "directory" || target.scope === "external") {
        await this.options.openDirectory(
          target.kind === "directory" ? target.path : path.dirname(target.path),
        );
        return { status: "opened" };
      }
      const scope = target.scope;
      const version = this.link_versions[scope]; // 等待保存对话框期间，来源仍可能失效。
      const destination = await this.options.pickSavePath(this.describe_target(target).name);
      if (destination === null) return { status: "cancelled" };
      return await this.exclusive(async () => {
        if (version !== this.link_versions[scope]) {
          throw new AppErrors.AppError("file.not_found");
        }
        if (this.resolve_path(href).kind !== "file") {
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
        this.native_fs.copy_file_atomic(target.path, destination);
        return { status: "saved" };
      });
    } catch (cause) {
      if (AppErrors.is_app_error(cause)) throw cause;
      throw new AppErrors.AppError("file.io_failed", { cause });
    }
  }

  /** 工作区内预览受脚本互斥保护，外部文件只做有界读取，异步解码不占写锁。 */
  private read_preview_file(target: WorkspacePath, max_bytes: number): Uint8Array {
    if (target.scope !== "external" && this.busy) throw new AppErrors.AppError("runtime.busy");
    if (target.kind !== "file") throw new AppErrors.AppError("file.invalid_structure");
    try {
      const bytes = this.native_fs.read_prefix(target.path, max_bytes + 1);
      if (bytes.length > max_bytes) throw new AppErrors.AppError("file.preview_too_large");
      return bytes;
    } catch (cause) {
      if (AppErrors.is_app_error(cause)) throw cause;
      throw new AppErrors.AppError("file.io_failed", { cause });
    }
  }

  /** 文档只解码一次捕获的字节，跨会话交付由 AgentService 复核。 */
  public async read_document(href: unknown): Promise<{ path: string; content: string }> {
    if (typeof href !== "string" || resolve_agent_text_format(href) === null) {
      throw new AppErrors.AppError("file.invalid_structure");
    }
    const target = this.resolve_path(href);
    const bytes = this.read_preview_file(target, AGENT_DOCUMENT_MAX_BYTES);
    return { path: target.href, content: await decode_text_content(bytes) };
  }

  /** 允许的图片类型统一映射为响应 MIME，字节仍经有界读取。 */
  public async read_document_image(href: unknown): Promise<{ bytes: Uint8Array; mime: string }> {
    const target = this.resolve_path(href);
    const { mime } = this.describe_target(target);
    if (!mime) throw new AppErrors.AppError("file.invalid_structure");
    return { bytes: this.read_preview_file(target, AGENT_IMAGE_MAX_BYTES), mime };
  }

  /** 会话开始失效时立即隔离待决保存，不等待旧模型和脚本停止。 */
  public invalidate_links(): void {
    this.link_versions.uploads += 1;
    this.link_versions.work += 1;
    this.link_versions.sources += 1;
    this.link_versions.snapshot += 1;
  }

  /** 以入口路径判断归属，跟随目录链接读取目标类型。 */
  private resolve_path(href: unknown): WorkspacePath {
    if (typeof href !== "string") {
      throw new AppErrors.AppError("request.validation_failed");
    }
    let file_path: string;
    try {
      if (is_agent_file_url(href)) {
        file_path = fileURLToPath(href);
        if (file_path.includes("\0")) throw new AppErrors.AppError("request.validation_failed");
      } else {
        // 链接片段不参与文件定位。百分号只解码一次，外部访问必须显式使用 `file:` URL。
        const relative_path = decodeURIComponent(href.split(/[?#]/u, 1)[0]!);
        if (
          relative_path === "" ||
          /[\\:]/u.test(relative_path) ||
          relative_path.includes("\0") ||
          path.posix.isAbsolute(relative_path) ||
          relative_path.split("/").includes("..")
        ) {
          throw new AppErrors.AppError("request.validation_failed");
        }
        file_path = path.resolve(this.root_path, relative_path);
      }
    } catch (cause) {
      if (AppErrors.is_app_error(cause)) throw cause;
      throw new AppErrors.AppError("request.validation_failed", { cause });
    }
    try {
      const inside = is_inside_path(this.root_path, file_path);
      const inside_path = path.relative(this.root_path, file_path);
      const stat = this.native_fs.stat(file_path);
      if (!stat.isFile() && !stat.isDirectory()) {
        throw new AppErrors.AppError("file.invalid_structure");
      }
      const scope = inside_path.split(path.sep)[0];
      return {
        path: file_path,
        href: inside
          ? inside_path.split(path.sep).map(encodeURIComponent).join("/") || "."
          : pathToFileURL(file_path).href,
        kind: stat.isDirectory() ? "directory" : "file",
        scope: !inside
          ? "external"
          : scope === "work" || scope === "sources" || scope === "uploads"
            ? scope
            : inside_path === AGENT_WORKSPACE_PATHS.sourceIssues
              ? "sources"
              : "snapshot",
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

  /** 旧执行必须已经收尾。相对路径、上传与预览共用当前会话目录。 */
  public async activate_chat(
    id: string,
    uploads: readonly AgentFileAttachment[],
    saveUpload: (file: AgentFileAttachment) => Promise<void>,
  ): Promise<void> {
    await this.close();
    this.chat_id = id;
    await this.native_fs.make_dir_async(this.root_path);
    this.upload_store = new AgentUploadStore(
      this.root_path,
      this.native_fs,
      uploads,
      async (file) => {
        await saveUpload(file);
        await this.directories.touch(id);
      },
    );
    await this.clear_snapshot();
    await this.clear_sources();
    await this.native_fs.make_dir_async(this.work_path);
    await this.native_fs.write_file(
      path.join(this.root_path, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    const modules = path.join(this.root_path, "node_modules");
    try {
      // 旧版本的宿主链接只移除入口，用户的真实目录及链接目标继续保留。
      if (this.native_fs.lstat(modules).isSymbolicLink()) this.native_fs.unlink(modules);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    await this.directories.touch(id);
  }

  /** 立即中断请求体读取，关闭流程随后等待句柄释放。 */
  public cancel_uploads(): void {
    this.upload_store?.cancel();
  }

  /** 保留磁盘材料，只失效旧链接和上传身份。 */
  public async close(): Promise<void> {
    this.invalidate_links();
    await this.upload_store?.close();
    this.upload_store = null;
    this.active = null;
    this.source_cache = null;
    this.chat_id = null;
  }

  /** 工具完成、失败或取消后记录本次使用。 */
  private async touch(): Promise<void> {
    if (this.chat_id !== null) await this.directories.touch(this.chat_id);
  }

  /** 工作区工具按需建立完整只读快照和空 change 文件。 */
  private async create_snapshot_locked(): Promise<void> {
    const project_path = this.options.projectPath;
    const revisions = this.options.cache.readSectionRevisions();
    const { source_language, target_language } = this.options.cache.settings.readBlock();
    const language = { source_language, target_language };
    const baseline = { revisions, language };
    const current_items = this.options.cache.items.readItems();
    const snapshot_files = this.options.cache.files.readFileEntries().map((entry) => ({
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
      QUALITY_RULE_KINDS.map((kind) => [kind, quality_block[kind].entries]),
    ) as Record<QualityRuleKind, QualityRuleEntry[]>;
    const prompts = project_workspace_prompts(this.options.cache.prompts.readBlock());
    const warning_result = await this.options.proofreading.query_warnings({
      warning_types: [...PROOFREADING_WARNING_CODES],
      keywords: [],
      scope: "all",
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
    });
    // 校对可能在工程更新前开始计算，单独核对它采用的事实版本。
    if (
      !this.is_snapshot_fresh(baseline) ||
      !(["items", "quality", "proofreading"] as const).every(
        (section) => (warning_result.sectionRevisions[section] ?? 0) === (revisions[section] ?? 0),
      )
    )
      throw workspace_validation_error("agent_workspace_snapshot_dependencies_changed");

    const knowledge = await this.options.knowledge.read(project_path);
    const project_meta: JsonRecord = {
      knowledge: { fp: knowledge.fp },
      ...language,
      counts: {
        files: snapshot_files.length,
        items: current_items.length,
        items_with_warnings: warning_result.data.items.length,
        ...Object.fromEntries(
          QUALITY_RULE_KINDS.map((kind) => [kind, quality_entries[kind].length]),
        ),
      },
      files: snapshot_files,
    };
    await this.clear_snapshot();
    try {
      // 所有并行写入必须结算后再清理。否则迟到写入会在失败目录删除后复活半成品。
      const write_results = await Promise.allSettled([
        this.native_fs.write_file(
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.knowledge),
          knowledge.text,
        ),
        write_json_file(
          this.native_fs,
          path.join(this.root_path, AGENT_WORKSPACE_PATHS.projectMeta),
          project_meta,
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
              project_agent_workspace_prompt(kind as "translation", text),
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
      await this.native_fs.make_dir_async(this.work_path);
    } catch (error) {
      await this.clear_snapshot();
      throw error;
    }

    this.active = baseline;
    if (!this.is_snapshot_fresh(baseline)) {
      await this.clear_snapshot();
      throw workspace_validation_error("agent_workspace_snapshot_project_changed");
    }
  }

  /** 脚本已完成的写入跨失败和停止保留，阶段更新由本次执行借用会话写入口。 */
  public async run(
    request: AgentWorkspaceRunInput,
    signal: AbortSignal,
  ): Promise<{ execution: AgentWorkspaceExecution; images: AgentWorkspaceImage[] }> {
    return await this.exclusive(async () => {
      const image_output = create_image_output(async (image_path, image_signal, options) => {
        // 图片按本机文件路径读取，与脚本读取范围一致。聊天链接由 resolve_path 约束。
        const file_path = path.resolve(this.root_path, image_path);
        const stat = this.native_fs.stat(file_path);
        if (!stat.isFile() || stat.size > AGENT_IMAGE_INPUT_MAX_BYTES)
          throw new Error("Image input is not a supported size file.");
        const image = await this.options.images.prepare(
          this.native_fs.read_file(file_path),
          image_signal,
          options,
        );
        return image;
      });
      let phase = WorkspaceRunPhase.PREPARE_SNAPSHOT; // 记录本次调用推进到的阶段，供失败诊断使用。
      try {
        signal.throwIfAborted();
        const active = this.active;
        if (active === null || !this.is_snapshot_fresh(active)) {
          await this.create_snapshot_locked();
        }
        phase = WorkspaceRunPhase.PREPARE_WORKSPACE;
        const snapshot = this.require_active();
        await this.ensure_sources({
          signal,
          filesRevision: snapshot.revisions.files ?? 0,
          files: this.options.cache.files
            .readFileEntries()
            .map((entry) => ({ file_path: entry.rel_path, file_type: entry.file_type })),
        });
        // 脚本可能删除运行目录和变更目录。每次执行前补齐目录，保留已有提交意图。
        const directories = new Set([
          AGENT_WORKSPACE_RUN_ROOT,
          ...all_change_paths().map((relative) => path.posix.dirname(relative)),
        ]);
        for (const relative of directories) {
          signal.throwIfAborted();
          await this.native_fs.make_dir_async(path.join(this.root_path, relative));
        }
        phase = WorkspaceRunPhase.SAVE_SCRIPT;
        const run_path = `${AGENT_WORKSPACE_RUN_ROOT}/${random_id()}`;
        const script_path = `${run_path}.mjs`;
        await this.native_fs.write_file(path.join(this.root_path, script_path), request.script);
        signal.throwIfAborted();
        if (!this.is_snapshot_fresh(snapshot)) {
          await this.clear_sources();
          throw workspace_validation_error("agent_workspace_snapshot_project_changed");
        }
        phase = WorkspaceRunPhase.EXECUTE;
        const logs = { stdoutPath: `${run_path}.stdout.log`, stderrPath: `${run_path}.stderr.log` };
        const watch = new AbortController();
        const watching =
          request.output === undefined
            ? undefined
            : watch_agent_process_output(this.root_path, logs, request.output, watch.signal).catch(
                (error: unknown) =>
                  // 观察只服务界面，失败不能让执行失败。
                  this.log.warning("Agent 执行输出观察失败。", {
                    source: "agent_workspace",
                    error,
                  }),
              );
        try {
          // 清除已发布版本遗留的模型目录，避免脚本读取过期配置。
          for (const filename of ["function_models.json", "model_configs.json"]) {
            await this.native_fs.remove_async(path.join(this.root_path, filename), { force: true });
          }
          const imageTextHost = this.options.imageTextHost;
          const generate_files = create_file_generator(this.root_path, this.options.generation);
          const execution = await this.options.run(
            {
              workspacePath: this.root_path,
              scriptPath: script_path,
              ...logs,
              timeoutMs: request.timeoutMs,
              emitImage: image_output.emitImage,
              ...(request.search === undefined ? {} : { search: request.search }),
              ...(request.doing === undefined ? {} : { doing: request.doing }),
              packageSource: (source_signal) => this.options.packageSources.resolve(source_signal),
              inspectSources: async (sources, signal) => {
                const resolved = sources.map((source) => this.resolve_source_path(source));
                const result = await this.options.files.inspect_sources(
                  resolved,
                  undefined,
                  signal,
                );
                return result.map((entry, index) => ({ ...entry, source_path: sources[index]! }));
              },
              generateFiles: async () => {
                const result = await generate_files();
                request.onFilesGenerated?.();
                return result;
              },
              ...(imageTextHost && {
                renderImageText: create_image_text_renderer({
                  root: this.root_path,
                  nativeFs: this.native_fs,
                  host: imageTextHost,
                }),
              }),
              getOutputPaths: this.options.generation.read_output_paths.bind(
                this.options.generation,
              ),
              printPDF: create_pdf_printer({
                root: this.root_path,
                nativeFs: this.native_fs,
                pdfHost: this.options.pdfHost,
              }),
            },
            signal,
          );
          return { execution, images: image_output.read() };
        } finally {
          watch.abort();
          await watching; // 返回前等观察退出，调用方结算后不会再收到 `output`
        }
      } catch (error) {
        if (is_agent_cancellation(error, signal)) throw error;
        if (error instanceof AgentWorkspaceRunError) {
          throw new AppErrors.AppError("request.validation_failed", {
            cause: error,
            public_details: {
              action: "workspace_run",
              message: error.message,
              ...error.execution,
              ...(image_output.read().length === 0
                ? {}
                : { images: summarize_images(image_output.read()) }),
            },
            diagnostic_context: { reason: "agent_workspace_execution_failed" },
          });
        }
        throw workspace_error_with_action(error, "workspace_run", "agent_workspace_host_failed", {
          phase,
          root: this.root_path,
        });
      } finally {
        await this.touch();
      }
    });
  }

  /** 一次准备真实差异，按需等待审批，再把同一份差异交给跨 section 事务。 */
  public async apply_workspace(
    request_approval?: (summary: AgentPendingWriteSummary) => Promise<void>,
  ): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      const projectPath = this.options.projectPath;
      if (!this.has_same_language(active)) {
        await this.clear_snapshot();
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
        throw workspace_error_with_action(
          error,
          "workspace_run",
          "agent_workspace_apply_prepare_failed",
        );
      }
      if (
        Object.values(parsed.files).some((rows) => rows.length) ||
        parsed.rejected.some((row) => row.scope === "files")
      )
        return this.apply_files(active, parsed, request_approval);
      let preview: ReturnType<typeof resolve_agent_workspace_writes>;
      let all_rejected: AgentWorkspaceRejectedChange[];
      try {
        const quality = this.options.cache.quality.readBlock(); // 读取边界已校验规则，预演只借用当前事实。
        const current: AgentWorkspaceCurrentFacts = {
          knowledge: parsed.batch.knowledge.length
            ? await this.options.database.read_knowledge(projectPath)
            : null,
          items: parsed.batch.items.length > 0 ? this.options.cache.items.readItems() : [],
          quality: Object.fromEntries(
            QUALITY_RULE_KINDS.map((kind) => [kind, quality[kind].entries]),
          ),
          prompts: parsed.batch.prompts.length
            ? project_workspace_prompts(this.options.cache.prompts.readBlock())
            : {},
          duplicateFilterEnabled:
            parsed.batch.items.length > 0 &&
            this.options.cache.settings.readBlock().skip_duplicate_source_text_enable,
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
        throw workspace_error_with_action(
          error,
          "workspace_run",
          "agent_workspace_apply_preview_failed",
        );
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
          revisions: pick_apply_revisions(this.options.cache.readSectionRevisions()),
        };
      }
      // 只按预演后的实际变化决定审批，拒绝或未变化的内容不参与判断。
      if (Object.keys(preview.applied).some((scope) => scope !== "knowledge"))
        await request_approval?.(summarize_applied_changes(preview.applied));

      let write_ack: AgentWorkspaceStoreResult;
      try {
        write_ack = await this.options.runtimeGate.run_agent_project_write(
          async () =>
            await this.options.writeStore.apply_agent_workspace_changes({
              projectPath,
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

  /** 相对来源只开放用户上传与运行工作材料，解析后复核目录边界。 */
  private resolve_source_path(source: string): string {
    if (path.isAbsolute(source)) return source;
    const normalized = source.replaceAll("\\", "/");
    const target = path.resolve(this.root_path, normalized);
    if (!/^(uploads|work)\//u.test(normalized) || !is_inside_path(this.root_path, target))
      throw workspace_validation_error("invalid_source_path");
    return target;
  }

  /** 文件批次先完整预演，再审批和提交，拒绝时按漂移原因决定是否重建快照。 */
  private async apply_files(
    active: ActiveAgentWorkspace,
    parsed: ParsedAgentWorkspaceChanges,
    approve?: (summary: AgentPendingWriteSummary) => Promise<void>,
  ): Promise<JsonRecord> {
    const preview = await preview_file_changes({
      parsed,
      current: this.options.cache.files
        .readFileEntries()
        .map((file) => ({ path: file.rel_path, file_type: file.file_type })),
      stale:
        (active.revisions.files ?? 0) !== (this.options.cache.readSectionRevisions().files ?? 0),
      resolve: (source) => this.resolve_source_path(source),
      inspect: this.options.files.inspect_sources.bind(this.options.files),
    });
    // 拒绝回执保留来源准备产生的目录变化。
    const reject = async (
      rejected: AgentWorkspaceRejectedChange[],
      directory_changes: string[] = [],
    ): Promise<JsonRecord> => {
      const destroyed = rejected.some(
        (row) => row.reason === "fp_mismatch" || row.reason === "target_missing",
      );
      if (destroyed) await this.clear_snapshot();
      return {
        status: "rejected",
        applied: {},
        rejected,
        destroyed,
        revisions: pick_apply_revisions(this.options.cache.readSectionRevisions()),
        ...(directory_changes.length ? { directory_changes } : {}),
      };
    };
    if (preview.rejected.length) return reject(preview.rejected);
    await approve?.({
      ...summarize_applied_changes({}),
      files:
        preview.created +
        preview.files.replaces.length +
        preview.files.updates.length +
        preview.files.deletes.length,
    });
    try {
      const result = await this.options.runtimeGate.run_agent_project_write((signal) =>
        this.options.files.apply_file_changes({
          projectPath: this.options.projectPath,
          source: "agent_workspace_apply",
          expectedSectionRevisions: { files: active.revisions.files ?? 0 },
          revisionSections: ["files"],
          sourcePaths: [...parsed.files.creates, ...parsed.files.replaces]
            .filter((row) => path.isAbsolute(row.source_path))
            .map((row) => row.source_path),
          creates: preview.files.creates,
          replaces: preview.files.replaces,
          updates: preview.files.updates,
          deletes: preview.files.deletes.map((row) => row.file_path),
          signal,
        }),
      );
      if (result.kind === "source_failed")
        return reject(
          result.failures.map((failure) => ({
            scope: "files",
            op: preview.files.replaces.some((row) => row.source_path === failure.source_path)
              ? "replace"
              : "create",
            reason: "source_failed",
            line: [...preview.files.creates, ...preview.files.replaces].find(
              (row) => row.source_path === failure.source_path,
            )!.line,
            ...failure,
          })),
          result.directory_changes,
        );
      // 对外回执保留调用方的路径表示，实际读取使用解析后的本机路径。
      const files = {
        ...result.files,
        replaced: result.files.replaced.map((entry, index) => ({
          ...entry,
          source_path: parsed.files.replaces[index]!.source_path,
        })),
        created: result.files.created.map((entry, index) => ({
          ...entry,
          source_path: parsed.files.creates[index]!.source_path,
        })),
      };
      await this.clear_snapshot();
      return {
        status: "applied",
        applied: { files },
        rejected: [],
        destroyed: true,
        revisions: pick_apply_revisions(result.sectionRevisions),
        ...(result.directory_changes.length ? { directory_changes: result.directory_changes } : {}),
      };
    } catch (error) {
      if (AppErrors.is_app_error(error) && error.code === "data.committed_sync_failed")
        await this.clear_snapshot();
      throw workspace_error_with_action(error, "workspace_apply");
    }
  }

  /** 对象指纹可处理内容漂移，翻译方向变化需要重新准备整批变更。 */
  private has_same_language(active: ActiveAgentWorkspace): boolean {
    const language = this.options.cache.settings.readBlock();
    return (
      language.source_language === active.language.source_language &&
      language.target_language === active.language.target_language
    );
  }

  /** 工程修订涵盖设置变更，异步准备后按修订验收整份快照。 */
  private is_snapshot_fresh(active: ActiveAgentWorkspace): boolean {
    const revisions = this.options.cache.readSectionRevisions();
    return PROJECT_DATA_SECTIONS.every(
      (section) => (revisions[section] ?? 0) === (active.revisions[section] ?? 0),
    );
  }

  /** apply 仍要求已有脚本准备出的活动快照。 */
  private require_active(): ActiveAgentWorkspace {
    if (this.active === null) {
      throw workspace_validation_error("agent_workspace_missing");
    }
    return this.active;
  }

  /**
   * 同修订复用已尝试资产，只重试 IO 失败。先发布完整问题记录，再发布缓存。
   * 记录无法写入时阻止脚本执行，避免 Agent 读到与原稿不符的说明。
   */
  private async ensure_sources(args: {
    signal: AbortSignal;
    filesRevision: number;
    files: ReadonlyArray<{ file_path: string; file_type: string }>;
  }): Promise<void> {
    let cache = this.source_cache;
    if (cache?.filesRevision !== args.filesRevision) {
      // exclusive 串行准备与脚本执行，旧修订必须清理完成后才能发布新原稿。
      await this.clear_sources();
      cache = {
        filesRevision: args.filesRevision,
        assets: new Map(),
      };
    }
    const attempted = await write_agent_workspace_sources({
      nativeFs: this.native_fs,
      sourceRoot: path.join(this.root_path, "sources"),
      signal: args.signal,
      files: args.files.filter((file) => cache.assets.get(file.file_path)?.retry ?? true),
      readAsset: (file_path) =>
        this.options.database.read_asset_content(this.options.projectPath, file_path),
      report: (asset, diagnostic) =>
        this.log.warning("Agent 原稿准备未完成。", {
          source: "agent_workspace",
          context: { asset, ...diagnostic },
        }),
    });
    // 记录发布成功后才替换缓存，发布失败时仍保留原有重试范围。
    const assets = new Map(cache.assets);
    for (const result of attempted) assets.set(result.file_path, result);
    this.native_fs.write_file_atomic(
      path.join(this.root_path, AGENT_WORKSPACE_PATHS.sourceIssues),
      [...assets.values()]
        .flatMap((result) => result.issues)
        .sort(
          (left, right) =>
            left.asset_path.localeCompare(right.asset_path) ||
            (left.member_path ?? "").localeCompare(right.member_path ?? "") ||
            left.stage.localeCompare(right.stage),
        )
        .map((issue) => JsonTool.stringifyStrict(issue) + "\n")
        .join(""),
    );
    this.source_cache = { ...cache, assets };
  }

  /** 原稿与问题记录共用生命周期，工程身份或文件修订变化时一起失效。 */
  private async clear_sources(): Promise<void> {
    this.link_versions.sources += 1;
    this.source_cache = null;
    await this.native_fs.remove_async(path.join(this.root_path, "sources"), {
      recursive: true,
      force: true,
    });
    await this.native_fs.remove_async(
      path.join(this.root_path, AGENT_WORKSPACE_PATHS.sourceIssues),
      { force: true },
    );
  }

  /** 清除数据快照与工作变更，保留独立生命周期的 sources 和 work。 */
  private async clear_snapshot(): Promise<void> {
    this.link_versions.snapshot += 1;
    this.active = null;
    const targets = [
      AGENT_WORKSPACE_PATHS.knowledge,
      AGENT_WORKSPACE_PATHS.projectMeta,
      "contract.json", // 清理旧版本生成的可重建快照文件。
      "reference",
      "items",
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

  /** 准备、执行与应用共用串行边界，防止固定目录被并发刷新。 */
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
  | "root_path"
  | "list_files"
  | "run"
  | "apply_workspace"
  | "activate_chat"
  | "close"
  | "cancel_uploads"
  | "activate_path"
  | "read_document"
  | "read_document_image"
  | "describe_file"
  | "invalidate_links"
> & {
  uploads: Pick<AgentUploadStore, "upload" | "get" | "read_image" | "open">;
};

/** 比较绝对路径的目录边界，包含根目录本身。 */
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
    knowledge: applied.knowledge?.updated ?? 0,
    files: 0,
    items: applied.items?.updated ?? 0,
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

  // 仅加载发生 mismatch/missing 的数据集。活动快照是区分输入错误与外部事实漂移的权威基线。
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
  const needs_prompts = drift_candidates.some((rejection) => rejection.scope === "prompts");
  const baseline_prompts = needs_prompts
    ? read_workspace_json(native_fs, path.join(workspace_path, AGENT_WORKSPACE_PATHS.prompts))
    : {};

  const knowledge_meta = drift_candidates.some((row) => row.scope === "knowledge")
    ? read_workspace_json(native_fs, path.join(workspace_path, AGENT_WORKSPACE_PATHS.projectMeta))[
        "knowledge"
      ]
    : undefined;
  const baseline_knowledge = is_json_record(knowledge_meta)
    ? String(knowledge_meta["fp"])
    : undefined;
  return rejections.map((rejection) => {
    if (rejection.reason !== "fp_mismatch" && rejection.reason !== "target_missing")
      return rejection;
    if (rejection.scope === "knowledge")
      return baseline_knowledge !== undefined &&
        batch.knowledge.length > 0 &&
        batch.knowledge.every((intent) => intent.fp === baseline_knowledge)
        ? rejection
        : { ...rejection, reason: "invalid_change" };
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

/** 从活动快照读取目标指纹。缺失表示该 change 从未指向基线对象。 */
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

/** 活动 snapshot 文件由本服务生成。损坏时抛错并进入统一恢复路径。 */
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
  return Object.values(AGENT_WORKSPACE_CHANGE_PATHS).flatMap((operations) =>
    Object.values(operations),
  );
}

/** apply 回执只暴露本工具可能改变的 section。 */
function pick_apply_revisions(revisions: ProjectDataSectionRevisions): JsonRecord {
  return Object.fromEntries(
    (["items", "proofreading", "quality", "prompts", "knowledge"] as const).map((section) => [
      section,
      revisions[section] ?? 0,
    ]),
  );
}

/** 工作区保留正文覆盖事实，null 表示继承当前内置模板。 */
function project_workspace_prompts(block: ProjectPrompts): Record<PromptKind, string | null> {
  return {
    [TRANSLATION_PROMPT.store_key]: block[TRANSLATION_PROMPT.store_key].text,
  };
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

/** 统一包装一次异常并保留原始 `cause`。运行失败提供阶段与安全的 IO 定位信息。 */
function workspace_error_with_action(
  error: unknown,
  action: "workspace_run" | "workspace_apply",
  reason?: string,
  run?: Readonly<{ phase: WorkspaceRunPhase; root: string }>,
): AppErrors.AppError {
  const app_error = AppErrors.is_app_error(error) ? error : null;
  let code: AppErrors.AppErrorCode = app_error?.code ?? "runtime.internal_invariant";
  const details: JsonRecord = { ...app_error?.public_details, action };
  if (run !== undefined) {
    details["phase"] = run.phase;
    const system = error instanceof Error ? (error as NodeJS.ErrnoException) : null;
    if (
      app_error === null &&
      typeof system?.code === "string" &&
      typeof system.syscall === "string"
    ) {
      code = system.code === "ENOENT" ? "file.not_found" : "file.io_failed";
      details["system_code"] = system.code;
      details["operation"] = system.syscall;
      // 只公开工作区内的相对路径，部署目录与外部链接目标由原始 cause 提供诊断。
      if (typeof system.path === "string") {
        const target = path.resolve(run.root, system.path);
        if (is_inside_path(run.root, target))
          details["path"] = path.relative(run.root, target).split(path.sep).join("/");
      }
    }
  }
  return new AppErrors.AppError(code, {
    cause: error,
    public_details: details,
    diagnostic_context: {
      ...app_error?.diagnostic_context,
      ...(reason === undefined ? {} : { reason }),
      ...(run === undefined ? {} : { phase: run.phase }),
    },
  });
}

/** 按工作区 Schema 输出条目身份和校对证据，复制嵌套数组以隔离调用方。 */
export function project_agent_workspace_warning(
  item: ProofreadingClientItem,
): AgentWorkspaceWarning {
  return structuredClone({
    item_id: read_json_integer(item.item_id, 0),
    warnings: item.warnings,
    glossary_applications: item.glossary_applications,
  });
}
