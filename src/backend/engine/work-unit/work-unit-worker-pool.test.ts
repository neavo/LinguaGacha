import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkUnitWorkerPool } from "./work-unit-worker-pool";

const cleanup_roots: string[] = []; // 记录测试创建的临时内置资产根和 worker 文件目录

describe("WorkUnitWorkerPool", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanup_roots.length > 0) {
      const root = cleanup_roots.pop();
      if (root !== undefined) {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("显式 in_process runner 模式仍执行完整翻译 work unit", async () => {
    const llm_client = {
      request: vi.fn().mockResolvedValue({
        response_think: "",
        response_result: '{"index":0,"text":"你好"}',
        input_tokens: 1,
        reasoning_tokens: 0,
        output_tokens: 2,
        cancelled: false,
        timeout: false,
      }),
    };
    const pool = new WorkUnitWorkerPool({
      builtinRoot: await create_template_root(),
      execution: { kind: "in_process" },
      llmClient: llm_client,
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
    expect(result.output.items).toEqual([
      { id: 1, src: "こんにちは", dst: "你好", status: "PROCESSED", text_type: "TXT" },
    ]);
  });

  it("worker_threads 模式只使用显式入口 URL 执行任务", async () => {
    const temp_root = await create_temp_root();
    const worker_path = path.join(temp_root, "test-work-unit-worker-entry.mjs");
    await writeFile(
      worker_path,
      `import { parentPort } from "node:worker_threads";
const executions = new Map();
parentPort?.on("message", (message) => {
  if (message.type === "execute") {
    const requestId = "llm-" + message.id;
    executions.set(requestId, message);
    parentPort?.postMessage({
      type: "llm_request",
      requestId,
      body: {
        run_id: message.unit.run_id,
        work_unit_id: message.unit.unit_id,
        model: message.unit.model,
        config_snapshot: message.unit.config_snapshot,
        messages: [{ role: "user", content: "test" }],
      },
    });
    return;
  }
  if (message.type === "llm_result") {
    const execution = executions.get(message.requestId);
    parentPort?.postMessage({
      type: "result",
      id: execution.id,
      result: { ok: true, data: { from_worker: true, llm: message.result.data } },
    });
  }
});
`,
      "utf-8",
    );
    const llm_request = vi.fn().mockResolvedValue({
      response_think: "",
      response_result: "result",
      input_tokens: 3,
      reasoning_tokens: 0,
      output_tokens: 4,
      cancelled: false,
      timeout: false,
    });
    const pool = new WorkUnitWorkerPool({
      builtinRoot: temp_root,
      execution: {
        kind: "worker_threads",
        workUnitWorkerEntryUrl: pathToFileURL(worker_path),
        planningWorkerEntryUrl: pathToFileURL(worker_path),
        computeWorkerEntryUrl: pathToFileURL(worker_path),
      },
      llmClient: { request: llm_request },
      workerCount: 1,
    });

    try {
      await expect(
        pool.execute_unit(
          create_translation_unit("worker-thread-unit"),
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        from_worker: true,
        llm: {
          response_think: "",
          response_result: "result",
          input_tokens: 3,
          reasoning_tokens: 0,
          output_tokens: 4,
          cancelled: false,
          timeout: false,
        },
      });
      expect(llm_request).toHaveBeenCalledWith(
        expect.objectContaining({
          run_id: "run-1",
          work_unit_id: "worker-thread-unit",
        }),
        expect.any(AbortSignal),
      );
    } finally {
      await pool.dispose();
    }
  });

  it("释放后拒绝新任务并返回结构化运行时错误", async () => {
    const pool = new WorkUnitWorkerPool({
      builtinRoot: await create_template_root(),
      execution: { kind: "in_process" },
      llmClient: { request: vi.fn() },
    });

    await pool.dispose();

    await expect(
      pool.execute_unit(create_translation_unit("unit-disposed"), new AbortController().signal),
    ).rejects.toMatchObject({ code: "runtime.disposed" });
  });

  it("释放池会中止父线程中的在途 LLM 请求", async () => {
    const request_signals: AbortSignal[] = [];
    let resolve_request_started: () => void = () => undefined;
    const request_started = new Promise<void>((resolve) => {
      resolve_request_started = resolve;
    });
    const pool = new WorkUnitWorkerPool({
      builtinRoot: await create_template_root(),
      execution: { kind: "in_process" },
      llmClient: {
        request: vi.fn(async (_body, signal) => {
          request_signals.push(signal);
          resolve_request_started();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
          throw new Error("unreachable");
        }),
      },
    });
    const execution = pool.execute_unit(
      create_translation_unit("unit-dispose-request"),
      new AbortController().signal,
    );
    await request_started;

    await pool.dispose();

    expect(request_signals[0]?.aborted).toBe(true);
    await expect(execution).rejects.toMatchObject({ code: "runtime.disposed" });
  });
});

/**
 * 构造最小翻译 unit，用于 multiplex in_process runner 路径测试。
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
 * in_process runner 测试需要真实模板目录，用临时内置资产根隔离资源读取。
 */
async function create_template_root(): Promise<string> {
  const builtin_root = await create_temp_root();
  await write_template(builtin_root, "translation_prompt", "zh");
  await write_template(builtin_root, "analysis_prompt", "zh");
  return builtin_root;
}

/**
 * 创建测试临时根并登记清理，避免 worker 与模板文件污染系统临时目录。
 */
async function create_temp_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-pool-"));
  cleanup_roots.push(app_root);
  return app_root;
}

/**
 * 写入最小可用模板，确保 pool 测试只关注执行路径而非提示词内容
 */
async function write_template(
  builtin_root: string,
  task_dir_name: string,
  language: "zh" | "en",
): Promise<void> {
  const dir = path.join(builtin_root, task_dir_name, "template", language);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "prefix.txt"), "前缀", "utf-8");
  await writeFile(path.join(dir, "base.txt"), "从 {source_language} 到 {target_language}", "utf-8");
  await writeFile(path.join(dir, "thinking.txt"), "", "utf-8");
  await writeFile(path.join(dir, "suffix.txt"), "输出 JSONLINE", "utf-8");
}
