import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackendServices } from "../../backend/bootstrap/backend-services";
import type { BatchTranslationSnapshot } from "../../domain/batch-translation";
import type { CLICommandName, CLICommandOptions, CLICommandResources } from "../cli-parser";
import { run_cli_job } from "./cli-job-runner";
import { build_cli_task_input } from "./cli-task-input";

const cleanup_roots: string[] = [];
const RESOURCE_KEYS = [
  "promptPath",
  "glossaryPath",
  "preReplacementPath",
  "postReplacementPath",
  "textPreservePath",
] as const satisfies readonly (keyof CLICommandResources)[];

afterEach(() => {
  for (const root of cleanup_roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("run_cli_job", () => {
  it("等待翻译终态后按顺序应用资源、导出并清理", async () => {
    const paths = create_cli_paths();
    const harness = create_backend_services_harness();
    const command = create_command(paths);
    const run_promise = run_cli_job(harness.backend_services, command, harness.status_reporter);

    await wait_for_task_start(harness, run_promise);
    await Promise.resolve();
    expect(harness.export_files_to_directory).not.toHaveBeenCalled();

    await harness.emit_snapshot("running", {
      total_line: 4,
      line: 2,
      processed_line: 2,
      error_line: 1,
    });
    expect(harness.export_files_to_directory).not.toHaveBeenCalled();

    await harness.emit_snapshot("done", {
      total_line: 4,
      line: 4,
      processed_line: 3,
      error_line: 1,
    });
    await expect(run_promise).resolves.toBeUndefined();

    expect(harness.start_task).toHaveBeenCalledWith({
      mode: "new",
      scope: { kind: "all" },
    });
    expect(harness.create_project_commit).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/cli-job\.lg$/u),
        source_paths: [paths.input_path],
        project_settings: expect.objectContaining({
          source_language: "JA",
          target_language: "ZH",
        }),
      }),
    );
    expect(harness.apply_task_input).toHaveBeenCalledWith(await build_cli_task_input(command));
    expect(harness.export_files_to_directory).toHaveBeenCalledWith(paths.output_dir);
    expect(
      harness.events.filter((event) =>
        ["apply", "start", "translation_export", "unload", "finished:done"].includes(event),
      ),
    ).toEqual(["apply", "start", "translation_export", "unload", "finished:done"]);
    expect(harness.set_transient_overrides.mock.calls).toEqual([
      [
        {
          glossary_default_preset: "",
          text_preserve_default_preset: "",
          pre_translation_replacement_default_preset: "",
          post_translation_replacement_default_preset: "",
          translation_custom_prompt_default_preset: "",

          output_folder_open_on_finish: false,
          source_language: "JA",
          target_language: "ZH",
        },
      ],
      [null],
    ]);
    expect(
      harness.events.filter(
        (event) => event === "started" || event === "progress" || event.startsWith("finished:"),
      ),
    ).toEqual(["started", "progress", "progress", "finished:done"]);
    expect(
      harness.status_reporter.emit_progress.mock.calls.map(
        ([snapshot]) => (snapshot as BatchTranslationSnapshot).status,
      ),
    ).toEqual(["running", "done"]);
    expect(harness.subscriber_count()).toBe(0);
    expect_temp_project_removed(harness.created_project_paths);
  });

  it("任务失败时撤销订阅、设置覆盖与非空临时工程", async () => {
    const paths = create_cli_paths();
    const harness = create_backend_services_harness();
    const run_promise = run_cli_job(
      harness.backend_services,
      create_command(paths, { command: "translate" }),
      harness.status_reporter,
    );
    const rejection = expect(run_promise).rejects.toThrow("Translation task failed");

    await wait_for_task_start(harness, run_promise);
    await harness.emit_snapshot("error");
    await rejection;

    expect(harness.set_transient_overrides).toHaveBeenLastCalledWith(null);
    expect(harness.unload_project).toHaveBeenCalledOnce();
    expect(harness.subscriber_count()).toBe(0);
    expect(harness.status_reporter.emit_finished).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ message: "Translation task failed" }),
    );
    expect_temp_project_removed(harness.created_project_paths);
  });

  it("输入不存在时在任何工程副作用前失败", async () => {
    const paths = create_cli_paths();
    const harness = create_backend_services_harness();
    const command = create_command(paths);
    command.inputPaths = [path.join(paths.root, "missing.txt")];

    await expect(
      run_cli_job(harness.backend_services, command, harness.status_reporter),
    ).rejects.toThrow("Input path does not exist");

    expect(harness.create_project_commit).not.toHaveBeenCalled();
    expect(harness.set_transient_overrides).not.toHaveBeenCalled();
    expect(fs.existsSync(paths.output_dir)).toBe(false);
  });

  it.each(RESOURCE_KEYS)("%s 不存在时在创建工程前失败", async (resource_key) => {
    const paths = create_cli_paths();
    const harness = create_backend_services_harness();
    const command = create_command(paths, {
      resources: { [resource_key]: path.join(paths.root, `missing-${resource_key}`) },
    });

    await expect(
      run_cli_job(harness.backend_services, command, harness.status_reporter),
    ).rejects.toThrow("Resource file does not exist");

    expect(harness.create_project_commit).not.toHaveBeenCalled();
    expect(harness.set_transient_overrides).not.toHaveBeenCalled();
  });

  it("卸载失败时仍删除非空临时工程并上报错误终态", async () => {
    const paths = create_cli_paths();
    const unload_failure = new Error("unload failed");
    const harness = create_backend_services_harness({ unloadFailure: unload_failure });
    const run_promise = run_cli_job(
      harness.backend_services,
      create_command(paths),
      harness.status_reporter,
    );
    const rejection = expect(run_promise).rejects.toThrow("unload failed");

    await wait_for_task_start(harness, run_promise);
    await harness.emit_snapshot("done");
    await rejection;

    expect(harness.status_reporter.emit_finished).toHaveBeenCalledOnce();
    expect(harness.status_reporter.emit_finished).toHaveBeenCalledWith("error", unload_failure);
    expect_temp_project_removed(harness.created_project_paths);
  });

  it("任务与卸载同时失败时按原始顺序保留两个异常", async () => {
    const paths = create_cli_paths();
    const unload_failure = new Error("unload failed");
    const harness = create_backend_services_harness({ unloadFailure: unload_failure });
    const run_promise = run_cli_job(
      harness.backend_services,
      create_command(paths, { command: "translate" }),
      harness.status_reporter,
    );
    const command_error_promise = run_promise.catch((error: unknown) => error);

    await wait_for_task_start(harness, run_promise);
    await harness.emit_snapshot("error");
    const command_error = await command_error_promise;

    expect(command_error).toBeInstanceOf(AggregateError);
    expect((command_error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "Translation task failed" }),
      unload_failure,
    ]);
    expect(harness.status_reporter.emit_finished).toHaveBeenCalledWith("error", command_error);
    expect_temp_project_removed(harness.created_project_paths);
  });
});

function create_backend_services_harness(failures: { unloadFailure?: Error } = {}) {
  const events: string[] = [];
  const created_project_paths: string[] = [];
  const task_listeners = new Set<
    (snapshot: Readonly<BatchTranslationSnapshot>) => void | Promise<void>
  >();
  let started = false;
  let finish!: (result: {
    status: "done" | "idle" | "error";
    progress: BatchTranslationSnapshot["progress"];
  }) => void;
  const completion = new Promise<{
    status: "done" | "idle" | "error";
    progress: BatchTranslationSnapshot["progress"];
  }>((resolve) => {
    finish = resolve;
  });
  let resolve_task_started: () => void = () => undefined;
  const task_started = new Promise<void>((resolve) => {
    resolve_task_started = resolve;
  });
  const status_reporter = {
    emit_started: vi.fn(() => events.push("started")),
    emit_progress: vi.fn((_snapshot: unknown) => events.push("progress")),
    emit_finished: vi.fn((status: unknown, _error?: unknown) =>
      events.push(`finished:${String(status)}`),
    ),
  };
  const set_transient_overrides = vi.fn((value: unknown) => {
    events.push(value === null ? "settings_reset" : "settings");
  });
  const create_project_commit = vi.fn(async (request: { path: string }) => {
    events.push("create");
    created_project_paths.push(request.path);
    cleanup_roots.push(path.dirname(request.path));
    fs.writeFileSync(request.path, "临时工程哨兵", "utf-8");
  });
  const apply_task_input = vi.fn(async () => {
    events.push("apply");
    return { accepted: true, changes: [] };
  });
  const unload_project = vi.fn(async () => {
    events.push("unload");
    if (failures.unloadFailure !== undefined) {
      throw failures.unloadFailure;
    }
  });
  const start_task = vi.fn(async (_request: unknown) => {
    events.push("start");
    started = true;
    resolve_task_started();
    return { run_id: "test", signal: new AbortController().signal, completion };
  });
  const export_files_to_directory = vi.fn(async (output_dir: string) => {
    events.push("translation_export");
    return {
      output_path: path.join(output_dir, "translated"),
      bilingual_output_path: path.join(output_dir, "bilingual"),
    };
  });

  return {
    backend_services: {
      app: {
        settings: {
          read_setting: () => ({
            prefilter_config: {},
            source_language: "JA",
            target_language: "ZH",
          }),
          set_transient_overrides,
        },
      },
      project: {
        lifecycle: { apply_task_input, create_project_commit, unload_project },
      },
      files: { translationExport: { export_files_to_directory } },
      batchTranslation: {
        start_current_project: start_task,
        subscribe: (
          listener: (snapshot: Readonly<BatchTranslationSnapshot>) => void | Promise<void>,
        ) => {
          events.push("subscribe");
          task_listeners.add(listener);
          return () => {
            events.push("unsubscribe");
            task_listeners.delete(listener);
          };
        },
      },
    } as unknown as BackendServices,
    apply_task_input,
    created_project_paths,
    create_project_commit,
    events,
    export_files_to_directory,
    set_transient_overrides,
    start_task,
    status_reporter,
    subscriber_count: () => task_listeners.size,
    task_started,
    unload_project,
    emit_snapshot: async (
      status: BatchTranslationSnapshot["status"],
      progress: Partial<BatchTranslationSnapshot["progress"]> = {},
    ): Promise<void> => {
      if (!started) {
        throw new Error("任务尚未启动");
      }
      const snapshot = create_task_snapshot(status, progress);
      await Promise.all([...task_listeners].map(async (listener) => await listener(snapshot)));
      if (status === "done" || status === "idle" || status === "error")
        finish({ status, progress: snapshot.progress });
    },
  };
}

async function wait_for_task_start(
  harness: ReturnType<typeof create_backend_services_harness>,
  run_promise: Promise<unknown>,
): Promise<void> {
  await Promise.race([
    harness.task_started,
    run_promise.then(() => {
      throw new Error("CLI job 未启动任务就已结束");
    }),
  ]);
}

function create_task_snapshot(
  status: BatchTranslationSnapshot["status"],
  progress: Partial<BatchTranslationSnapshot["progress"]> = {},
): BatchTranslationSnapshot {
  return {
    revision: 1,
    status,
    request_in_flight_count: 0,
    progress: {
      line: 0,
      total_line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_reasoning_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
      ...progress,
    },
    scope: { kind: "all" },
  };
}

function create_command(
  paths: ReturnType<typeof create_cli_paths>,
  options: {
    command?: CLICommandName;
    resources?: Partial<CLICommandResources>;
  } = {},
): CLICommandOptions {
  const command = options.command ?? "translate";
  return {
    command,
    inputPaths: [paths.input_path],
    outputDir: paths.output_dir,
    sourceLanguage: command === "translate" ? "JA" : "ALL",
    targetLanguage: "ZH",
    resources: {
      promptPath: null,
      glossaryPath: null,
      preReplacementPath: null,
      postReplacementPath: null,
      textPreservePath: null,
      ...options.resources,
    },
  };
}

function create_cli_paths(): { input_path: string; output_dir: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-cli-job-"));
  cleanup_roots.push(root);
  const input_path = path.join(root, "script.txt");
  const output_dir = path.join(root, "out");
  fs.writeFileSync(input_path, "原文", "utf-8");
  return { input_path, output_dir, root };
}

function expect_temp_project_removed(project_paths: string[]): void {
  const project_path = project_paths[0];
  expect(project_path).toBeDefined();
  if (project_path !== undefined) {
    expect(fs.existsSync(path.dirname(project_path))).toBe(false);
  }
}
