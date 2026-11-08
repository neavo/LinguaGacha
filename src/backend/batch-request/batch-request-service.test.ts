import { read_batch_task_snapshot } from "../../shared/batch-task";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchRequestService, project_model_configs } from "./batch-request-service";
import { BatchTaskRuntime } from "../batch-task/batch-task-runtime";
import { RequestRatePool } from "../batch-task/request-rate";
import { ProjectSessionState } from "../project/project-session-state";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { NativeResponsesClient } from "../llm/native-responses";
import type { LLMClientPort, LLMRequestResult } from "../llm/llm-types";
import { default_native_fs } from "../../native/native-fs";
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
const response = (): LLMRequestResult => ({
  input_tokens: 2,
  reasoning_tokens: 1,
  output_tokens: 3,
  response_result: "ok",
  response_think: "",
  cancelled: false,
  timeout: false,
});
async function setup(
  request: LLMClientPort["request"] = async () => response(),
  fetcher?: typeof fetch,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "batch-request-"));
  directories.push(root);
  const session = new ProjectSessionState();
  const gate = new RuntimeOperationGate();
  const tasks = new BatchTaskRuntime(session, gate);
  const lease = gate.begin_runtime("agent");
  const settings = {
    models: [
      {
        id: "fixture",
        name: "Fixture",
        api_url: "https://example.test/v1",
        api_format: "OpenAIResponses",
        api_key: "private",
        model_id: "model",
        thinking: { level: "HIGH" },
        threshold: { concurrency_limit: 1, rpm_limit: 0 },
      },
    ],
  };
  const service = new BatchRequestService(
    tasks,
    new RequestRatePool(),
    { read_setting: () => settings },
    { request },
    new NativeResponsesClient("test", { read_models: () => [] }, fetcher),
    { bind: () => "session" },
  );
  await fs.writeFile(
    path.join(root, "good.json"),
    JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  );
  await fs.writeFile(path.join(root, "bad.json"), JSON.stringify({ messages: [] }));
  const write_manifest = async (entries: { id: string; input_file: string }[]) =>
    fs.writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({ format: "messages", requests: entries }),
    );
  return {
    root,
    tasks,
    gate,
    lease,
    service,
    settings,
    write_manifest,
    run: () => service.run(lease, new AbortController().signal, root, "fixture", "manifest.json"),
  };
}
describe("batch request", () => {
  it("文本批次逐项发布结果，坏正文只失败本项，配置快照固定", async () => {
    const request = vi.fn<LLMClientPort["request"]>().mockResolvedValue(response());
    const f = await setup(request);
    await f.write_manifest([
      { id: "first", input_file: "good.json" },
      { id: "second", input_file: "bad.json" },
    ]);
    request.mockImplementation(async () => {
      f.settings.models[0]!.model_id = "changed";
      return response();
    });
    const summary = await f.run();
    expect(summary).toMatchObject({
      status: "done",
      total: 2,
      succeeded: 1,
      failed: 1,
      unfinished: 0,
    });
    const index = JSON.parse(await fs.readFile(summary.result_file, "utf8"));
    const saved = JSON.parse(
      await fs.readFile(
        path.resolve(path.dirname(summary.result_file), index.requests[0].result_file),
        "utf8",
      ),
    );
    expect(saved).toMatchObject({
      id: "first",
      status: "succeeded",
      response: { format: "messages", text: "ok" },
    });
    expect(f.settings.models[0]!.model_id).toBe("changed");
    expect(request.mock.calls[0]![0].model).toMatchObject({
      model_id: "model",
      thinking: { level: "HIGH" },
    });
    expect(
      read_batch_task_snapshot(
        JSON.parse(JSON.stringify({ batch_task: f.tasks.build_snapshot() })),
      ),
    ).toMatchObject({
      kind: "request",
      progress: { total: 2, succeeded: 1, failed: 1 },
    });
    expect(f.gate.get_snapshot().owner).toBe("agent");
    await f.tasks.dispose();
  });
  it("原生响应经同一批次发布索引，截断保留原文并只失败该项", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [],
            usage: { input_tokens: 2, output_tokens: 1 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "incomplete",
            output: [],
            incomplete_details: { reason: "max_output_tokens" },
          }),
        ),
      );
    const f = await setup(undefined, fetcher);
    await fs.writeFile(path.join(f.root, "native.json"), JSON.stringify({ input: [] }));
    await fs.writeFile(
      path.join(f.root, "manifest.json"),
      JSON.stringify({
        format: "responses",
        requests: [
          { id: "one", input_file: "native.json" },
          { id: "two", input_file: "native.json" },
        ],
      }),
    );
    const summary = await f.run();
    expect(summary).toMatchObject({
      status: "done",
      succeeded: 1,
      failed: 1,
      usage: { usage_complete: false },
    });
    const index = JSON.parse(await fs.readFile(summary.result_file, "utf8"));
    const failed = JSON.parse(
      await fs.readFile(
        path.resolve(path.dirname(summary.result_file), index.requests[1].result_file),
        "utf8",
      ),
    );
    expect(failed).toMatchObject({
      status: "failed",
      response: {
        format: "responses",
        raw: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    f.settings.models[0]!.api_format = "OpenAI";
    await expect(f.run()).rejects.toThrow("responses requires");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await f.tasks.dispose();
  });

  it("重复 ID 在派发前拒绝，发现投影不包含认证秘密", async () => {
    const request = vi.fn<LLMClientPort["request"]>();
    const f = await setup(request);
    await f.write_manifest([
      { id: "same", input_file: "good.json" },
      { id: "same", input_file: "good.json" },
    ]);
    await expect(f.run()).rejects.toThrow("Duplicate");
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(project_model_configs(f.settings))).not.toContain("private");
    await f.tasks.dispose();
  });
  it("停止等待真实请求收尾，已发布成果保留，迟到停止不取消后续批次", async () => {
    const started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let count = 0;
    const f = await setup(async (_body, signal) => {
      if (++count === 1) return response();
      started.resolve();
      await release.promise;
      return { ...response(), cancelled: signal.aborted };
    });
    await f.write_manifest([
      { id: "one", input_file: "good.json" },
      { id: "two", input_file: "good.json" },
    ]);
    const states: string[] = [];
    f.tasks.subscribe((snapshot) => {
      states.push(snapshot.status);
    });
    let settled = false;
    const pending = f.run().finally(() => {
      settled = true;
    });
    await started.promise;
    const run_id = f.tasks.build_snapshot().run_id!;
    await f.tasks.request_stop(run_id);
    expect(settled).toBe(false);
    release.resolve();
    const result = await pending;
    expect(result).toMatchObject({
      status: "stopped",
      stop_source: "user",
      succeeded: 1,
      unfinished: 1,
    });
    expect(JSON.parse(await fs.readFile(result.result_file, "utf8"))).toMatchObject({
      status: "stopped",
      requests: [{ status: "succeeded" }, { status: "unfinished", result_file: null }],
    });
    expect(states).toContain("stopping");
    expect(states.at(-1)).toBe("stopped");
    const next = f.tasks.begin_under_agent(f.lease, new AbortController().signal, "translation");
    expect(await f.tasks.request_stop(run_id)).toBe(false);
    expect(next.signal.aborted).toBe(false);
    await f.tasks.execute(next, async () => "done");
    await next.completion;
    await f.tasks.dispose();
  });
  it.each([false, true])("文件发布失败不计成功，用户同时停止：%s", async (stop) => {
    const f = await setup();
    await f.write_manifest([{ id: "one", input_file: "good.json" }]);
    const write = default_native_fs.write_file.bind(default_native_fs);
    vi.spyOn(default_native_fs, "write_file").mockImplementation(async (file, data) => {
      if (file.endsWith("000001.json.tmp")) {
        if (stop) await f.tasks.request_stop(f.tasks.build_snapshot().run_id!);
        throw new Error("disk failure");
      }
      await write(file, data);
    });
    await expect(f.run()).rejects.toMatchObject({
      summary: { status: "error", succeeded: 0, unfinished: 1, result_file: expect.any(String) },
    });
    expect(f.tasks.build_snapshot()).toMatchObject({ status: "error" });
    await f.tasks.dispose();
  });
});
