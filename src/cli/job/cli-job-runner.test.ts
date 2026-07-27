import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackendServices } from "../../backend/bootstrap/backend-services";
import type { TaskSnapshot } from "../../backend/engine/protocol/task-snapshot";
import type { CLICommandResources } from "../cli-parser";
import { CLIJsonStatusReporter } from "../cli-status-reporter";
import { run_cli_job } from "./cli-job-runner";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) {
      fs.rmSync(root, { force: true, recursive: true });
    }
  }
});

describe("run_cli_job", () => {
  it("翻译命令创建临时工程、同步等待任务并导出到 output-dir", async () => {
    const { input_path, output_dir } = create_cli_paths();
    const status_lines: string[] = [];
    const harness = create_backend_services_harness([
      {
        status: "running",
        progress: { total_line: 4, line: 2, processed_line: 2, error_line: 1 },
      },
      {
        status: "done",
        progress: { total_line: 4, line: 4, processed_line: 3, error_line: 1 },
      },
    ]);

    await expect(
      run_cli_job(
        harness.backend_services,
        {
          command: "translate",
          inputPaths: [input_path],
          outputDir: output_dir,
          sourceLanguage: "JA",
          targetLanguage: "ZH",
          resources: create_empty_resources(),
        },
        { statusReporter: create_status_reporter("translate", status_lines) },
      ),
    ).resolves.toBeUndefined();

    expect(harness.create_project_commit).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/cli-job\.lg$/u),
        source_paths: [input_path],
      }),
    );
    expect(harness.start_task).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: "translation",
        mode: "new",
        scope: { kind: "all" },
      }),
    );
    expect(harness.export_files_to_directory).toHaveBeenCalledWith(output_dir);
    expect(harness.apply_task_input).toHaveBeenCalledWith(
      expect.objectContaining({
        quality_rules: expect.arrayContaining([
          expect.objectContaining({ kind: "glossary", enabled: false }),
          expect.objectContaining({ kind: "text_preserve", mode: "off" }),
        ]),
      }),
    );
    expect(harness.set_transient_overrides.mock.calls).toEqual([
      [
        {
          glossary_default_preset: "",
          text_preserve_default_preset: "",
          pre_translation_replacement_default_preset: "",
          post_translation_replacement_default_preset: "",
          translation_custom_prompt_default_preset: "",
          analysis_custom_prompt_default_preset: "",
          output_folder_open_on_finish: false,
          source_language: "JA",
          target_language: "ZH",
        },
      ],
      [null],
    ]);
    expect(harness.unload_project).toHaveBeenCalledTimes(1);
    expect(status_lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        type: "started",
        command: "translate",
        timestamp: "2026-05-19T10:00:00.000Z",
      },
      {
        type: "progress",
        command: "translate",
        status: "running",
        timestamp: "2026-05-19T10:00:00.000Z",
        stats: {
          total: 4,
          skipped: 0,
          failed: 1,
          completed: 2,
          pending: 1,
          percent: 50,
        },
      },
      {
        type: "progress",
        command: "translate",
        status: "done",
        timestamp: "2026-05-19T10:00:00.000Z",
        stats: {
          total: 4,
          skipped: 0,
          failed: 1,
          completed: 3,
          pending: 0,
          percent: 75,
        },
      },
      {
        type: "finished",
        command: "translate",
        status: "done",
        timestamp: "2026-05-19T10:00:00.000Z",
      },
    ]);
  });

  it("任务失败时清理临时工程并撤销临时设置覆盖", async () => {
    const { input_path, output_dir } = create_cli_paths();
    const status_lines: string[] = [];
    const harness = create_backend_services_harness([{ status: "error" }]);

    await expect(
      run_cli_job(
        harness.backend_services,
        {
          command: "analyze",
          inputPaths: [input_path],
          outputDir: output_dir,
          sourceLanguage: "ALL",
          targetLanguage: "ZH",
          resources: create_empty_resources(),
        },
        { statusReporter: create_status_reporter("analyze", status_lines) },
      ),
    ).rejects.toThrow("Analysis task failed");

    const create_request = harness.create_project_commit.mock.calls[0]?.[0] as
      | { path?: string }
      | undefined;
    expect(create_request?.path).toBeDefined();
    expect(fs.existsSync(path.dirname(String(create_request?.path)))).toBe(false);
    expect(harness.set_transient_overrides.mock.calls.at(-1)).toEqual([null]);
    expect(harness.unload_project).toHaveBeenCalledTimes(1);
    expect(
      status_lines.map((line) => JSON.parse(line) as { type: string; status?: string }),
    ).toEqual([
      expect.objectContaining({ type: "started" }),
      expect.objectContaining({ type: "finished", status: "error" }),
    ]);
  });

  it("输入路径不存在时拒绝创建临时工程", async () => {
    const { output_dir } = create_cli_paths();
    const status_lines: string[] = [];
    const harness = create_backend_services_harness([{ status: "done" }]);

    await expect(
      run_cli_job(
        harness.backend_services,
        {
          command: "translate",
          inputPaths: [path.join(output_dir, "missing.txt")],
          outputDir: output_dir,
          sourceLanguage: "JA",
          targetLanguage: "ZH",
          resources: create_empty_resources(),
        },
        { statusReporter: create_status_reporter("translate", status_lines) },
      ),
    ).rejects.toThrow("Input path does not exist");

    expect(harness.create_project_commit).not.toHaveBeenCalled();
    expect(harness.set_transient_overrides).not.toHaveBeenCalled();
    expect(
      status_lines.map((line) => JSON.parse(line) as { type: string; status?: string }),
    ).toEqual([
      expect.objectContaining({ type: "started" }),
      expect.objectContaining({ type: "finished", status: "error" }),
    ]);
  });

  it("资源文件不存在时拒绝创建临时工程", async () => {
    const { input_path, output_dir } = create_cli_paths();
    const status_lines: string[] = [];
    const harness = create_backend_services_harness([{ status: "done" }]);

    await expect(
      run_cli_job(
        harness.backend_services,
        {
          command: "translate",
          inputPaths: [input_path],
          outputDir: output_dir,
          sourceLanguage: "JA",
          targetLanguage: "ZH",
          resources: { ...create_empty_resources(), glossaryPath: path.join(output_dir, "g.json") },
        },
        { statusReporter: create_status_reporter("translate", status_lines) },
      ),
    ).rejects.toThrow("Resource file does not exist");

    expect(harness.create_project_commit).not.toHaveBeenCalled();
    expect(harness.set_transient_overrides).not.toHaveBeenCalled();
    expect(
      status_lines.map((line) => JSON.parse(line) as { type: string; status?: string }),
    ).toEqual([
      expect.objectContaining({ type: "started" }),
      expect.objectContaining({ type: "finished", status: "error" }),
    ]);
  });

  it("翻译命令把外部提示词和规则文件写入临时工程后再启动任务", async () => {
    const { input_path, output_dir, root } = create_cli_paths();
    const prompt_path = path.join(root, "prompt.txt");
    const glossary_path = path.join(root, "glossary.json");
    const pre_path = path.join(root, "pre.json");
    const post_path = path.join(root, "post.json");
    const preserve_path = path.join(root, "preserve.json");
    fs.writeFileSync(prompt_path, "\uFEFF自定义翻译提示词\n", "utf-8");
    fs.writeFileSync(glossary_path, JSON.stringify([{ src: "Alice", dst: "爱丽丝" }]), "utf-8");
    fs.writeFileSync(pre_path, JSON.stringify([{ src: "foo", dst: "bar" }]), "utf-8");
    fs.writeFileSync(post_path, JSON.stringify([{ src: "旧", dst: "新" }]), "utf-8");
    fs.writeFileSync(preserve_path, JSON.stringify([{ src: "<[^>]+>", regex: true }]), "utf-8");
    const status_lines: string[] = [];
    const harness = create_backend_services_harness([{ status: "done" }]);

    await run_cli_job(
      harness.backend_services,
      {
        command: "translate",
        inputPaths: [input_path],
        outputDir: output_dir,
        sourceLanguage: "JA",
        targetLanguage: "ZH",
        resources: {
          promptPath: prompt_path,
          glossaryPath: glossary_path,
          preReplacementPath: pre_path,
          postReplacementPath: post_path,
          textPreservePath: preserve_path,
        },
      },
      { statusReporter: create_status_reporter("translate", status_lines) },
    );

    expect(harness.apply_task_input).toHaveBeenCalledWith({
      quality_rules: [
        {
          kind: "glossary",
          entries: [{ src: "Alice", dst: "爱丽丝", info: "", regex: false, case_sensitive: false }],
          enabled: true,
          mode: null,
        },
        {
          kind: "text_preserve",
          entries: [{ src: "<[^>]+>", dst: "", info: "", regex: true, case_sensitive: false }],
          enabled: null,
          mode: "custom",
        },
        {
          kind: "pre_replacement",
          entries: [{ src: "foo", dst: "bar", info: "", regex: false, case_sensitive: false }],
          enabled: true,
          mode: null,
        },
        {
          kind: "post_replacement",
          entries: [{ src: "旧", dst: "新", info: "", regex: false, case_sensitive: false }],
          enabled: true,
          mode: null,
        },
      ],
      prompts: [
        { kind: "translation", text: "自定义翻译提示词", enabled: true },
        { kind: "analysis", text: "", enabled: false },
      ],
    });
    expect(harness.start_task).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: "translation" }),
    );
  });

  it("分析命令把外部提示词写入分析提示词槽位", async () => {
    const { input_path, output_dir, root } = create_cli_paths();
    const prompt_path = path.join(root, "analysis-prompt.txt");
    fs.writeFileSync(prompt_path, "自定义分析提示词", "utf-8");
    const status_lines: string[] = [];
    const harness = create_backend_services_harness([{ status: "done" }]);

    await run_cli_job(
      harness.backend_services,
      {
        command: "analyze",
        inputPaths: [input_path],
        outputDir: output_dir,
        sourceLanguage: "ALL",
        targetLanguage: "ZH",
        resources: { ...create_empty_resources(), promptPath: prompt_path },
      },
      { statusReporter: create_status_reporter("analyze", status_lines) },
    );

    expect(harness.apply_task_input).toHaveBeenCalledWith(
      expect.objectContaining({
        prompts: [
          { kind: "translation", text: "", enabled: false },
          { kind: "analysis", text: "自定义分析提示词", enabled: true },
        ],
      }),
    );
    expect(harness.start_task).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: "analysis" }),
    );
  });
});

type HarnessTaskSnapshot = {
  status: string;
  progress?: Record<string, number>;
};

/**
 * 组装 CLI job 所需最窄后端门面，并用类型化任务订阅驱动终态。
 */
function create_backend_services_harness(snapshots: HarnessTaskSnapshot[]): {
  backend_services: BackendServices;
  apply_task_input: ReturnType<typeof vi.fn>;
  create_project_commit: ReturnType<typeof vi.fn>;
  export_files_to_directory: ReturnType<typeof vi.fn>;
  set_transient_overrides: ReturnType<typeof vi.fn>;
  start_task: ReturnType<typeof vi.fn>;
  unload_project: ReturnType<typeof vi.fn>;
} {
  const task_listeners = new Set<(snapshot: Readonly<TaskSnapshot>) => void | Promise<void>>();
  const set_transient_overrides = vi.fn();
  const apply_task_input = vi.fn(async () => ({ accepted: true, changes: [] }));
  const create_project_commit = vi.fn(async () => undefined);
  const unload_project = vi.fn(async () => undefined);
  const start_task = vi.fn(async (request: { task_type: "translation" | "analysis" }) => {
    const task_type = request.task_type;
    for (const snapshot of snapshots.length > 0 ? snapshots : [{ status: "done" }]) {
      const task_snapshot = {
        run_revision: 1,
        task_type,
        status: snapshot.status,
        busy: snapshot.status !== "done" && snapshot.status !== "error",
        request_in_flight_count: 0,
        progress: {
          line: 0,
          total_line: 0,
          processed_line: 0,
          error_line: 0,
          total_tokens: 0,
          total_output_tokens: 0,
          total_input_tokens: 0,
          time: 0,
          start_time: 0,
          ...snapshot.progress,
        },
        extras:
          task_type === "analysis"
            ? { kind: "analysis", candidate_count: 0 }
            : { kind: "translation", scope: { kind: "all" } },
      } as TaskSnapshot;
      await Promise.all([...task_listeners].map(async (listener) => await listener(task_snapshot)));
    }
    return {
      run_revision: 1,
      task_type,
      status: "requested",
      busy: true,
      request_in_flight_count: 0,
      progress: {
        line: 0,
        total_line: 0,
        processed_line: 0,
        error_line: 0,
        total_tokens: 0,
        total_output_tokens: 0,
        total_input_tokens: 0,
        time: 0,
        start_time: 0,
      },
      extras:
        task_type === "analysis"
          ? { kind: "analysis", candidate_count: 0 }
          : { kind: "translation", scope: { kind: "all" } },
    } as TaskSnapshot;
  });
  const export_files_to_directory = vi.fn(async (output_dir: string) => ({
    output_path: path.join(output_dir, "translated"),
    bilingual_output_path: path.join(output_dir, "bilingual"),
  }));
  const export_analysis_candidates_to_directory = vi.fn(async (output_dir: string) => ({
    json_path: path.join(output_dir, "glossary.json"),
    xlsx_path: path.join(output_dir, "glossary.xlsx"),
  }));

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
        lifecycle: {
          apply_task_input,
          create_project_commit,
          unload_project,
        },
      },
      files: {
        translationExport: { export_files_to_directory },
      },
      quality: {
        rules: { export_analysis_candidates_to_directory },
      },
      tasks: {
        start_current_project_task: start_task,
        subscribe: (listener: (snapshot: Readonly<TaskSnapshot>) => void | Promise<void>) => {
          task_listeners.add(listener);
          return () => task_listeners.delete(listener);
        },
      },
    } as unknown as BackendServices,
    apply_task_input,
    create_project_commit,
    export_files_to_directory,
    set_transient_overrides,
    start_task,
    unload_project,
  };
}

/**
 * 固定时钟并收集 JSON 行，避免状态协议断言受真实时间影响。
 */
function create_status_reporter(
  command: "translate" | "analyze",
  lines: string[],
): CLIJsonStatusReporter {
  return new CLIJsonStatusReporter({
    command,
    now: () => new Date("2026-05-19T10:00:00.000Z"),
    writeLine: (line) => lines.push(line),
  });
}

/**
 * 每个用例创建独立输入与输出根，交由 afterEach 统一回收。
 */
function create_cli_paths(): { input_path: string; output_dir: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-cli-job-"));
  cleanup_roots.push(root);
  const input_path = path.join(root, "script.txt");
  const output_dir = path.join(root, "out");
  fs.writeFileSync(input_path, "原文", "utf-8");
  return { input_path, output_dir, root };
}

/**
 * 返回全部关闭的资源参数，单个测试只覆盖自己关心的槽位。
 */
function create_empty_resources(): CLICommandResources {
  return {
    promptPath: null,
    glossaryPath: null,
    preReplacementPath: null,
    postReplacementPath: null,
    textPreservePath: null,
  };
}
