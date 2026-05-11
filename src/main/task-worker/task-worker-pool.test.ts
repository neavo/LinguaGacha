import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PiAiLlmRequestClient } from "./llm/llm-request-client";
import { TaskWorkerPool } from "./task-worker-pool";

describe("TaskWorkerPool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("源码测试环境回退 direct runner 后仍执行完整翻译 work unit", async () => {
    vi.spyOn(PiAiLlmRequestClient.prototype, "request").mockResolvedValue({
      response_think: "",
      response_result: '{"0":"你好"}',
      input_tokens: 1,
      output_tokens: 2,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
    });
    const pool = new TaskWorkerPool({
      appRoot: await create_template_root(),
      workerCount: 2,
    });

    const result = await pool.execute_translation_chunk(
      {
        run_id: "run-1",
        work_unit_id: "unit-1",
        task_type: "translation",
        model: {},
        config_snapshot: {
          app_language: "ZH",
          source_language: "JA",
          target_language: "ZH",
        },
        quality_snapshot: {
          quality: {
            glossary: { enabled: false, entries: [] },
            text_preserve: { mode: "OFF", entries: [] },
            pre_replacement: { enabled: false, entries: [] },
            post_replacement: { enabled: false, entries: [] },
          },
          prompts: {
            translation: { enabled: false, text: "" },
            analysis: { enabled: false, text: "" },
          },
        },
        items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
      },
      new AbortController().signal,
    );
    await pool.dispose();

    expect(result.row_count).toBe(1);
    expect(result.items[0]?.dst).toBe("你好");
  });
});

/**
 * direct runner 回退测试需要真实模板目录，用临时 appRoot 隔离资源读取。
 */
async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-pool-"));
  await write_template(app_root, "translation_prompt", "zh");
  await write_template(app_root, "analysis_prompt", "zh");
  return app_root;
}

/**
 * 写入最小可用模板，确保 pool 测试只关注执行路径而非提示词内容。
 */
async function write_template(
  app_root: string,
  task_dir_name: string,
  language: "zh" | "en",
): Promise<void> {
  const dir = path.join(app_root, "resource", task_dir_name, "template", language);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "prefix.txt"), "前缀", "utf-8");
  await writeFile(path.join(dir, "base.txt"), "从 {source_language} 到 {target_language}", "utf-8");
  await writeFile(path.join(dir, "thinking.txt"), "", "utf-8");
  await writeFile(path.join(dir, "suffix.txt"), "输出 JSONLINE", "utf-8");
}
