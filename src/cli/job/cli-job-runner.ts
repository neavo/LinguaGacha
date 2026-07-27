import fs from "node:fs";

import type { BackendServices } from "../../backend/bootstrap/backend-services";
import { normalize_project_settings_snapshot } from "../../domain/setting";
import type { JsonRecord, JsonValue } from "../../domain/json";
import type { TaskType } from "../../domain/task";
import type { CLICommandOptions } from "../cli-parser";
import type { CLIJobRunOptions } from "./cli-job-types";
import { CLITempProject } from "./cli-temp-project";
import { apply_cli_resources } from "./cli-resource-applier";

/**
 * 执行文件进出型 CLI job，并隐藏内部临时 .lg 工程。
 */
export async function run_cli_job(
  backend_services: BackendServices,
  command: CLICommandOptions,
  options: CLIJobRunOptions,
): Promise<void> {
  options.statusReporter.emit_started();
  let temp_project: CLITempProject | null = null; // 只有成功创建后才需要卸载工程和删目录
  let transient_overrides_active = false; // 防止输入校验失败时写入多余撤销调用

  try {
    assert_existing_inputs(command);
    fs.mkdirSync(command.outputDir, { recursive: true });
    temp_project = await CLITempProject.create();
    backend_services.app.settings.set_transient_overrides({
      ...build_cli_default_preset_overrides(),
      output_folder_open_on_finish: false,
      source_language: command.sourceLanguage,
      target_language: command.targetLanguage,
    });
    transient_overrides_active = true;
    await backend_services.project.lifecycle.create_project_commit({
      path: temp_project.projectPath,
      source_paths: command.inputPaths,
      project_settings: build_project_settings(backend_services, command) as JsonValue,
    });
    await apply_cli_resources(backend_services, command);
    if (command.command === "translate") {
      await start_and_wait_for_task(backend_services, "translation", options);
      await backend_services.files.translationExport.export_files_to_directory(command.outputDir);
      options.statusReporter.emit_finished("done");
      return;
    }

    await start_and_wait_for_task(backend_services, "analysis", options);
    await backend_services.quality.rules.export_analysis_candidates_to_directory(command.outputDir);
    options.statusReporter.emit_finished("done");
  } catch (error) {
    options.statusReporter.emit_finished("error", error);
    throw error;
  } finally {
    if (transient_overrides_active) {
      backend_services.app.settings.set_transient_overrides(null);
    }
    if (temp_project !== null) {
      try {
        await backend_services.project.lifecycle.unload_project();
      } finally {
        // 卸载失败也必须删除临时目录，避免 CLI 批处理留下内部工程残片。
        await temp_project.cleanup();
      }
    }
  }
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
    analysis_custom_prompt_default_preset: "",
  };
}

/**
 * 创建工程时写入命令语言参数，并保留当前应用设置里的预过滤开关。
 */
function build_project_settings(
  backend_services: BackendServices,
  command: CLICommandOptions,
): JsonRecord {
  return normalize_project_settings_snapshot({
    ...backend_services.app.settings.read_setting(),
    source_language: command.sourceLanguage,
    target_language: command.targetLanguage,
  }) as unknown as JsonRecord;
}

/**
 * CLI 输入路径必须真实存在，避免内部工程创建成空任务后才报错。
 */
function assert_existing_inputs(command: CLICommandOptions): void {
  for (const input_path of command.inputPaths) {
    if (!fs.existsSync(input_path)) {
      throw new Error(`Input path does not exist: ${input_path}`);
    }
  }
  for (const resource_path of collect_resource_paths(command)) {
    if (!fs.existsSync(resource_path)) {
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

/**
 * 启动任务并同步等待终态；任务失败时把 Backend 快照状态转成 CLI 错误。
 */
async function start_and_wait_for_task(
  backend_services: BackendServices,
  task_type: "translation" | "analysis",
  options: CLIJobRunOptions,
): Promise<void> {
  const task_waiter = create_task_event_waiter(backend_services, task_type, options);
  try {
    await backend_services.tasks.start_current_project_task(
      task_type === "translation"
        ? { task_type, mode: "new", scope: { kind: "all" } }
        : { task_type, mode: "new" },
    );
    await task_waiter.wait();
  } finally {
    task_waiter.dispose();
  }
}

/**
 * 订阅类型化任务快照直到 done/error；CLI 与 GUI 共享同一个 TaskRuntime 事实源。
 */
function create_task_event_waiter(
  backend_services: BackendServices,
  task_type: TaskType,
  options: CLIJobRunOptions,
): { wait: () => Promise<void>; dispose: () => void } {
  let resolve_wait: (() => void) | null = null; // 由终态 done 事件触发
  let reject_wait: ((error: Error) => void) | null = null; // 由终态 error 事件触发
  const wait_promise = new Promise<void>((resolve, reject) => {
    resolve_wait = resolve;
    reject_wait = reject;
  });
  const unsubscribe = backend_services.tasks.subscribe((snapshot) => {
    if (snapshot.task_type !== task_type) {
      return;
    }
    options.statusReporter.emit_progress(snapshot);
    if (snapshot.status === "done") {
      resolve_wait?.();
    } else if (snapshot.status === "error") {
      reject_wait?.(
        new Error(`${task_type === "translation" ? "Translation" : "Analysis"} task failed`),
      );
    }
  });
  return {
    wait: () => wait_promise,
    dispose: unsubscribe,
  };
}
