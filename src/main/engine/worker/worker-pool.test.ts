import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LLMClient } from "../../llm/llm-client";
import { WorkerPool } from "./worker-pool";
import { RuntimeCancelledError, RuntimeDisposedError } from "../../../shared/error";

describe("WorkerPool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("源码测试环境回退 direct runner 后仍执行完整翻译 work unit", async () => {
    vi.spyOn(LLMClient.prototype, "request").mockResolvedValue({
      response_think: "",
      response_result: '{"0":"你好"}',
      input_tokens: 1,
      output_tokens: 2,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
    });
    const pool = new WorkerPool({
      appRoot: await create_template_root(),
      useDirectRunner: true,
      workerCount: 2,
    });

    const result = await pool.execute_unit(
      {
        run_id: "run-1",
        unit_id: "unit-1",
        kind: "translation",
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
        payload: {
          items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
          precedings: [],
        },
        diagnostics: {
          token_threshold: 512,
          split_count: 0,
          retry_count: 0,
          is_initial: true,
        },
      },
      new AbortController().signal,
    );
    await pool.dispose();

    if (result.output.kind !== "translation") {
      throw new Error("期望翻译输出");
    }
    expect(result.output.row_count).toBe(1);
  });

  it("direct runner 测试路径遵守 maxInFlight 上限并持续派发队列", async () => {
    let current = 0;
    let peak = 0;
    let request_count = 0;
    const release_requests: Array<() => void> = [];
    vi.spyOn(LLMClient.prototype, "request").mockImplementation(async () => {
      request_count += 1;
      current += 1;
      peak = Math.max(peak, current);
      await new Promise<void>((resolve) => {
        release_requests.push(resolve);
      });
      current -= 1;
      return {
        response_think: "",
        response_result: '{"0":"你好"}',
        input_tokens: 1,
        output_tokens: 2,
        cancelled: false,
        timeout: false,
        degraded: false,
        error: "",
      };
    });
    const pool = new WorkerPool({
      appRoot: await create_template_root(),
      maxInFlight: 2,
      useDirectRunner: true,
      workerCount: 1,
    });

    const executions = Array.from({ length: 5 }, (_value, index) =>
      pool.execute_unit(
        create_translation_unit(`unit-${index.toString()}`),
        new AbortController().signal,
      ),
    );
    await vi.waitFor(() => {
      expect(release_requests.length).toBeGreaterThanOrEqual(2);
    });
    release_pending_requests(release_requests, 2);
    await vi.waitFor(() => {
      expect(release_requests.length).toBeGreaterThanOrEqual(2);
    });
    release_pending_requests(release_requests, 2);
    await vi.waitFor(() => {
      expect(release_requests.length).toBeGreaterThanOrEqual(1);
    });
    release_pending_requests(release_requests, 1);
    await Promise.all(executions);
    await pool.dispose();

    expect(request_count).toBe(5);
    expect(peak).toBe(2);
  });

  it("释放后拒绝新任务并返回结构化运行时错误", async () => {
    const pool = new WorkerPool({
      appRoot: await create_template_root(),
      useDirectRunner: true,
    });

    await pool.dispose();

    await expect(
      pool.execute_unit(create_translation_unit("unit-disposed"), new AbortController().signal),
    ).rejects.toThrow(RuntimeDisposedError);
  });

  it("等待队列中的 work unit 被取消时返回结构化取消错误", async () => {
    vi.spyOn(LLMClient.prototype, "request").mockImplementation(() => new Promise(() => undefined));
    const pool = new WorkerPool({
      appRoot: await create_template_root(),
      maxInFlight: 1,
      useDirectRunner: true,
    });
    const first = pool.execute_unit(
      create_translation_unit("unit-blocking"),
      new AbortController().signal,
    );
    const queued_controller = new AbortController();
    const queued = pool.execute_unit(
      create_translation_unit("unit-cancelled"),
      queued_controller.signal,
    );

    queued_controller.abort();

    await expect(queued).rejects.toThrow(RuntimeCancelledError);
    first.catch(() => undefined);
    await pool.dispose();
  });
});

/**
 * 构造最小翻译 unit，用于 multiplex direct runner 路径测试。
 */
function create_translation_unit(unit_id: string) {
  return {
    run_id: "run-1",
    unit_id,
    kind: "translation" as const,
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
    payload: {
      items: [{ id: 1, src: "こんにちは", dst: "", status: "NONE", text_type: "TXT" }],
      precedings: [],
    },
    diagnostics: {
      token_threshold: 512,
      split_count: 0,
      retry_count: 0,
      is_initial: true,
    },
  };
}

/**
 * direct runner 回退测试需要真实模板目录，用临时 appRoot 隔离资源读取
 */
async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-pool-"));
  await write_template(app_root, "translation_prompt", "zh");
  await write_template(app_root, "analysis_prompt", "zh");
  return app_root;
}

/**
 * 写入最小可用模板，确保 pool 测试只关注执行路径而非提示词内容
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

function release_pending_requests(release_requests: Array<() => void>, count: number): void {
  const pending = release_requests.splice(0, count);
  for (const release of pending) {
    release();
  }
}
