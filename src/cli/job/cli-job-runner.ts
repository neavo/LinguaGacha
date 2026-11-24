import type { BatchTaskRuntime } from "../../backend/batch-task/batch-task-runtime";
import type { ProjectSummaryService } from "../../backend/project/project-summary-service";
import { default_native_fs as fs } from "../../native/native-fs";
import os from "node:os";
import path from "node:path";

import type { AppSettingService } from "../../backend/app/app-setting-service";
import type { BatchTranslationService } from "../../backend/batch-translation/batch-translation-service";
import type { TranslationFileGenerationService } from "../../backend/file/translation-file-generation-service";
import type { ProjectTaskInput } from "../../backend/project/project-task-input";
import { read_json_record } from "../../domain/json";
import type { JsonRecord } from "../../domain/json";
import type { CLICommandOptions } from "../cli-parser";
import type { CLIJsonStatusReporter } from "../cli-status-reporter";
import { build_cli_task_input } from "./cli-task-input";
import { write_stderr } from "../cli-output";
import { format_i18n_message } from "../../shared/i18n";
import {
  read_source_operation_result,
  type SourceOperationResult,
} from "../../shared/source-operation";
import { is_app_error } from "../../shared/error";

type CLIJobStatusReporter = Pick<
  CLIJsonStatusReporter,
  "emit_started" | "emit_progress" | "emit_finished"
>;

type CLIProject = {
  summary: Pick<ProjectSummaryService, "read_translation_stats">;
  batchTasks: Pick<BatchTaskRuntime, "subscribe">;
  batchTranslation: Pick<BatchTranslationService, "start_current_project">;
  generation: Pick<TranslationFileGenerationService, "generate_files_to_directory">;
};

/** CLI 显式持有本次临时工程。 */
export interface CLIJobServices<Project extends CLIProject = CLIProject> {
  app: { settings: Pick<AppSettingService, "set_transient_overrides"> };
  create_project: (request: JsonRecord, onGameSources?: () => void) => Promise<JsonRecord>;
  close_project: (id: string) => Promise<unknown>;
  projects: { require(id: string): Project };
  apply_task_input: (project: Project, input: ProjectTaskInput) => Promise<unknown>;
}

/**
 * 执行文件进出型 CLI job，并隐藏内部临时 .lg 工程。
 */
export async function run_cli_job<Project extends CLIProject>(
  backend_services: CLIJobServices<Project>,
  command: CLICommandOptions,
  status_reporter: CLIJobStatusReporter,
): Promise<void> {
  status_reporter.emit_started();
  let temp_root: string | null = null; // 只有成功创建后才需要卸载工程和删目录
  let project_id: string | null = null;
  let transient_overrides_active = false; // 防止输入校验失败时写入多余撤销调用
  let excluded_files: string[] = [];
  const failures: unknown[] = []; // 按发生顺序保留业务与收尾错误，同时继续后续清理
  let source_operation: SourceOperationResult | undefined;

  try {
    assert_existing_inputs(command);
    temp_root = await fs.make_temp_dir(path.join(os.tmpdir(), "linguagacha-cli-"));
    const project_path = path.join(temp_root, "cli-job.lg");
    backend_services.app.settings.set_transient_overrides({
      ...build_cli_default_preset_overrides(),
      output_folder_open_on_finish: false,
    });
    transient_overrides_active = true;
    const created = await backend_services.create_project(
      {
        path: project_path,
        source_paths: command.inputPaths,
        // 命令语言直接写入临时项目，翻译与导出读取同一项目事实。
        languages: {
          source_language: command.sourceLanguage,
          target_language: command.targetLanguage,
        },
      },
      () => {
        // 正式来源发现后、任何游戏准备前输出，stdout 保留给 JSONL 协议。
        write_stderr(
          `${format_i18n_message("zh-CN", "app.game_backup_warning")} | ${format_i18n_message("en-US", "app.game_backup_warning")}`,
        );
      },
    );
    source_operation = read_source_operation_result(created.source_operation);
    project_id = String(read_json_record(created.project).projectId);
    const project = backend_services.projects.require(project_id);
    await backend_services.apply_task_input(project, await build_cli_task_input(command));

    if (project.summary.read_translation_stats().stats.total_items > 0)
      await start_and_wait_for_translation(project, status_reporter);
    const generated = await project.generation.generate_files_to_directory(command.outputDir);
    excluded_files = generated.excluded_files;
  } catch (error) {
    if (is_app_error(error)) {
      source_operation ??= read_source_operation_result(error.public_details?.source_operation);
      if (Array.isArray(error.public_details?.excluded_files))
        excluded_files = error.public_details.excluded_files.filter(
          (file): file is string => typeof file === "string",
        );
    }
    failures.push(error);
  }

  if (transient_overrides_active) {
    try {
      backend_services.app.settings.set_transient_overrides(null);
    } catch (error) {
      failures.push(error);
    }
  }
  if (temp_root !== null) {
    try {
      if (project_id !== null) await backend_services.close_project(project_id);
    } catch (error) {
      failures.push(error);
    }
    try {
      await fs.remove_async(temp_root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    const error =
      failures.length === 1
        ? failures[0]
        : new AggregateError(failures, "CLI job execution or temporary resource cleanup failed.");
    status_reporter.emit_finished("error", error, excluded_files, source_operation);
    throw error;
  }

  status_reporter.emit_finished("done", undefined, excluded_files, source_operation);
}

/**
 * CLI 不继承 GUI 默认预设；外部资源只由本次命令参数显式写入临时工程。
 */
function build_cli_default_preset_overrides(): JsonRecord {
  return {
    glossary_default_preset: "",
    text_preserve_default_preset: "",
    pre_translation_replacement_default_preset: "",
    post_translation_replacement_default_preset: "",
    translation_custom_prompt_default_preset: "",
  };
}

/**
 * CLI 输入路径必须真实存在，避免内部工程创建成空任务后才报错。
 */
function assert_existing_inputs(command: CLICommandOptions): void {
  for (const input_path of command.inputPaths) {
    if (!fs.exists(input_path)) {
      throw new Error(`Input path does not exist: ${input_path}`);
    }
  }
  for (const resource_path of collect_resource_paths(command)) {
    if (!fs.exists(resource_path)) {
      throw new Error(`Resource file does not exist: ${resource_path}`);
    }
  }
}

/**
 * 资源文件存在性在 job 边界统一校验，避免读取阶段抛出底层文件系统错误。
 */
function collect_resource_paths(command: CLICommandOptions): string[] {
  return [
    command.resources.promptPath,
    command.resources.glossaryPath,
    command.resources.preReplacementPath,
    command.resources.postReplacementPath,
    command.resources.textPreservePath,
  ].filter((item): item is string => item !== null);
}

/** 快照仅负责展示，本轮 completion 覆盖运行和全部资源收尾。 */
async function start_and_wait_for_translation(
  services: CLIProject,
  reporter: CLIJobStatusReporter,
): Promise<void> {
  const unsubscribe = services.batchTasks.subscribe((snapshot) => reporter.emit_progress(snapshot));
  try {
    const handle = await services.batchTranslation.start_current_project({
      mode: "new",
      operation: "translate",
      scope: { kind: "all" },
    });
    const result = await handle.completion;
    if (result.status !== "done") throw new Error("Translation task failed");
  } finally {
    unsubscribe();
  }
}
