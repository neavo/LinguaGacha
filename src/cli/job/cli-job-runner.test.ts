import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CoreServices } from "../../core/bootstrap/core-services";
import { CoreEventHub } from "../../core/events/core-event-hub";
import type { DatabaseOperation } from "../../core/database/database-types";
import type { CliCommandResources } from "../cli-parser";
import { CliJsonStatusReporter } from "../cli-status-reporter";
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
    const harness = create_core_services_harness([
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
        harness.core_services,
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
    expect(harness.generate_translation_to_directory).toHaveBeenCalledWith(output_dir);
    expect(harness.execute_transaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "setMeta",
          args: expect.objectContaining({ key: "glossary_enable", value: false }),
        }),
        expect.objectContaining({
          name: "setMeta",
          args: expect.objectContaining({ key: "text_preserve_mode", value: "off" }),
        }),
      ]),
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
    const harness = create_core_services_harness([{ status: "error" }]);

    await expect(
      run_cli_job(
        harness.core_services,
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
    const harness = create_core_services_harness([{ status: "done" }]);

    await expect(
      run_cli_job(
        harness.core_services,
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
    const harness = create_core_services_harness([{ status: "done" }]);

    await expect(
      run_cli_job(
        harness.core_services,
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
    const harness = create_core_services_harness([{ status: "done" }]);

    await run_cli_job(
      harness.core_services,
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

    const operations = harness.execute_transaction.mock.calls[0]?.[0] as
      | DatabaseOperation[]
      | undefined;
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "setRuleText",
          args: expect.objectContaining({
            ruleType: "translation_prompt",
            text: "自定义翻译提示词",
          }),
        }),
        expect.objectContaining({
          name: "setRules",
          args: expect.objectContaining({ ruleType: "glossary" }),
        }),
        expect.objectContaining({
          name: "setRules",
          args: expect.objectContaining({ ruleType: "pre_translation_replacement" }),
        }),
        expect.objectContaining({
          name: "setRules",
          args: expect.objectContaining({ ruleType: "post_translation_replacement" }),
        }),
        expect.objectContaining({
          name: "setRules",
          args: expect.objectContaining({ ruleType: "text_preserve" }),
        }),
        expect.objectContaining({
          name: "setMeta",
          args: expect.objectContaining({ key: "text_preserve_mode", value: "custom" }),
        }),
      ]),
    );
    expect(harness.start_task).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: "translation" }),
    );
  });

  it("分析命令把外部提示词写入分析提示词槽位", async () => {
    const { input_path, output_dir, root } = create_cli_paths();
    const prompt_path = path.join(root, "analysis-prompt.txt");
    fs.writeFileSync(prompt_path, "自定义分析提示词", "utf-8");
    const status_lines: string[] = [];
    const harness = create_core_services_harness([{ status: "done" }]);

    await run_cli_job(
      harness.core_services,
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

    const operations = harness.execute_transaction.mock.calls[0]?.[0] as
      | DatabaseOperation[]
      | undefined;
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "setRuleText",
          args: expect.objectContaining({
            ruleType: "analysis_prompt",
            text: "自定义分析提示词",
          }),
        }),
        expect.objectContaining({
          name: "setMeta",
          args: expect.objectContaining({ key: "analysis_prompt_enable", value: true }),
        }),
      ]),
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

function create_core_services_harness(snapshots: HarnessTaskSnapshot[]): {
  core_services: CoreServices;
  create_project_commit: ReturnType<typeof vi.fn>;
  generate_translation_to_directory: ReturnType<typeof vi.fn>;
  execute_transaction: ReturnType<typeof vi.fn>;
  set_transient_overrides: ReturnType<typeof vi.fn>;
  start_task: ReturnType<typeof vi.fn>;
  unload_project: ReturnType<typeof vi.fn>;
} {
  const core_event_hub = new CoreEventHub();
  const set_transient_overrides = vi.fn();
  const execute_transaction = vi.fn();
  const create_project_commit = vi.fn(async () => undefined);
  const unload_project = vi.fn(async () => undefined);
  const start_task = vi.fn(async (request: { task_type?: string }) => {
    const task_type = String(request.task_type ?? "translation");
    for (const snapshot of snapshots.length > 0 ? snapshots : [{ status: "done" }]) {
      core_event_hub.publish("task.snapshot_changed", {
        task: {
          runtime_revision: 1,
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
        },
      });
    }
  });
  const generate_translation_to_directory = vi.fn(async (output_dir: string) => ({
    output_path: path.join(output_dir, "translated"),
    bilingual_output_path: path.join(output_dir, "bilingual"),
  }));
  const export_analysis_candidates_to_directory = vi.fn(async (output_dir: string) => ({
    json_path: path.join(output_dir, "glossary.json"),
    xlsx_path: path.join(output_dir, "glossary.xlsx"),
  }));

  return {
    core_services: {
      app_setting_service: {
        read_setting: () => ({
          prefilter_config: {},
          source_language: "JA",
          target_language: "ZH",
        }),
        set_transient_overrides,
      },
      build_expected_section_revisions: () => ({ quality: 0, prompts: 0 }),
      core_event_hub,
      database: { execute_transaction },
      file_export_service: { generate_translation_to_directory },
      project_lifecycle_service: {
        create_project_commit,
        unload_project,
      },
      quality_service: { export_analysis_candidates_to_directory },
      task_service: { start_task },
    } as unknown as CoreServices,
    create_project_commit,
    execute_transaction,
    generate_translation_to_directory,
    set_transient_overrides,
    start_task,
    unload_project,
  };
}

function create_status_reporter(
  command: "translate" | "analyze",
  lines: string[],
): CliJsonStatusReporter {
  return new CliJsonStatusReporter({
    command,
    now: () => new Date("2026-05-19T10:00:00.000Z"),
    writeLine: (line) => lines.push(line),
  });
}

function create_cli_paths(): { input_path: string; output_dir: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-cli-job-"));
  cleanup_roots.push(root);
  const input_path = path.join(root, "script.txt");
  const output_dir = path.join(root, "out");
  fs.writeFileSync(input_path, "原文", "utf-8");
  return { input_path, output_dir, root };
}

function create_empty_resources(): CliCommandResources {
  return {
    promptPath: null,
    glossaryPath: null,
    preReplacementPath: null,
    postReplacementPath: null,
    textPreservePath: null,
  };
}
