import fs from "node:fs";

import type { ApiJsonValue } from "../../core/api/api-types";
import type { CoreServices } from "../../core/bootstrap/core-services";
import type { ApiStreamPayload } from "../../core/api/api-stream-hub";
import { normalize_project_settings_snapshot } from "../../domain/setting";
import type { TaskSnapshot } from "../../core/engine/protocol/task-snapshot";
import { is_task_run_status, is_task_type, type TaskType } from "../../domain/task";
import type { CLICommandOptions } from "../cli-parser";
import type { CLIJobRunOptions } from "./cli-job-types";
import { CLITempProject } from "./cli-temp-project";
import { apply_cli_resources } from "./cli-resource-applier";

/**
 * 执行文件进出型 CLI job，并隐藏内部临时 .lg 工程。
 */
export async function run_cli_job(
  core_services: CoreServices,
  command: CLICommandOptions,
  options: CLIJobRunOptions,
): Promise<void> {
  options.statusReporter.emit_started();
  let temp_project: CLITempProject | null = null; // temp_project 只有成功创建后才需要卸载工程和删目录
  let transient_overrides_active = false; // transient_overrides_active 防止输入校验失败时写入多余撤销调用

  try {
    assert_existing_inputs(command);
    fs.mkdirSync(command.outputDir, { recursive: true });
    temp_project = await CLITempProject.create();
    core_services.app.settings.set_transient_overrides({
      ...build_cli_default_preset_overrides(),
      output_folder_open_on_finish: false,
      source_language: command.sourceLanguage,
      target_language: command.targetLanguage,
    });
    transient_overrides_active = true;
    await core_services.project.lifecycle.create_project_commit({
      path: temp_project.projectPath,
      source_paths: command.inputPaths as unknown as ApiJsonValue,
      project_settings: build_project_settings(core_services, command) as unknown as ApiJsonValue,
    });
    await apply_cli_resources(core_services, command, temp_project.projectPath);
    if (command.command === "translate") {
      await start_and_wait_for_task(core_services, "translation", options);
      await core_services.export.files.generate_translation_to_directory(command.outputDir);
      options.statusReporter.emit_finished("done");
      return;
    }

    await start_and_wait_for_task(core_services, "analysis", options);
    await core_services.quality.service.export_analysis_candidates_to_directory(command.outputDir);
    options.statusReporter.emit_finished("done");
  } catch (error) {
    options.statusReporter.emit_finished("error", error);
    throw error;
  } finally {
    if (transient_overrides_active) {
      core_services.app.settings.set_transient_overrides(null);
    }
    if (temp_project !== null) {
      try {
        await core_services.project.lifecycle.unload_project();
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
function build_cli_default_preset_overrides(): Record<string, ApiJsonValue> {
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
  core_services: CoreServices,
  command: CLICommandOptions,
): Record<string, ApiJsonValue> {
  return normalize_project_settings_snapshot({
    ...core_services.app.settings.read_setting(),
    source_language: command.sourceLanguage,
    target_language: command.targetLanguage,
  }) as unknown as Record<string, ApiJsonValue>;
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
 * 启动任务并同步等待终态；任务失败时把 Core 快照状态转成 CLI 错误。
 */
async function start_and_wait_for_task(
  core_services: CoreServices,
  task_type: "translation" | "analysis",
  options: CLIJobRunOptions,
): Promise<void> {
  const task_waiter = create_task_event_waiter(core_services, task_type, options);
  try {
    await core_services.engine.tasks.start_task({
      task_type,
      mode: "new",
      scope: { kind: "all" } as unknown as ApiJsonValue,
      expected_section_revisions: core_services.build_expected_section_revisions([
        "quality",
        "prompts",
      ]) as unknown as ApiJsonValue,
    });
    await task_waiter.wait();
  } finally {
    task_waiter.dispose();
  }
}

/**
 * 订阅公开任务 stream 直到 done/error；CLI 与 GUI 共享同一条 TaskSnapshot 事实链路。
 */
function create_task_event_waiter(
  core_services: CoreServices,
  task_type: TaskType,
  options: CLIJobRunOptions,
): { wait: () => Promise<void>; dispose: () => void } {
  let resolve_wait: (() => void) | null = null; // resolve_wait 由终态 done 事件触发
  let reject_wait: ((error: Error) => void) | null = null; // reject_wait 由终态 error 事件触发
  const wait_promise = new Promise<void>((resolve, reject) => {
    resolve_wait = resolve;
    reject_wait = reject;
  });
  const unsubscribe = core_services.streams.api.subscribe("task.snapshot_changed", (message) => {
    const snapshot = normalize_task_snapshot_payload(message.payload);
    if (snapshot === null || snapshot.task_type !== task_type) {
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

/**
 * task.snapshot_changed 载荷只在 CLI 边界做窄化；非法 payload 被忽略，避免污染 stdout 协议。
 */
function normalize_task_snapshot_payload(payload: ApiStreamPayload): TaskSnapshot | null {
  const task = payload["task"];
  if (typeof task !== "object" || task === null || Array.isArray(task)) {
    return null;
  }
  const record = task as Record<string, ApiJsonValue>;
  const task_type = String(record["task_type"] ?? "");
  const status = String(record["status"] ?? "");
  const progress = record["progress"];
  if (
    !is_task_type(task_type) ||
    !is_task_run_status(status) ||
    typeof progress !== "object" ||
    progress === null ||
    Array.isArray(progress)
  ) {
    return null;
  }
  return {
    runtime_revision: Number(record["runtime_revision"] ?? 0),
    task_type,
    status,
    busy: Boolean(record["busy"]),
    request_in_flight_count: Number(record["request_in_flight_count"] ?? 0),
    progress: progress as TaskSnapshot["progress"],
    extras:
      task_type === "analysis"
        ? { kind: "analysis", candidate_count: 0 }
        : { kind: "translation", scope: { kind: "all" } },
  };
}
