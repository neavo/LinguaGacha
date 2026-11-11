import { create_text_resolver } from "../../shared/i18n";
import { log_error_from_message } from "../../shared/error";
import { format_log_content_text, type LogAppendPayload } from "../../shared/log";
import { read_batch_task_snapshot } from "../../shared/batch-task";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchRequestService } from "./batch-request-service";
import { BatchTaskRuntime } from "../batch-task/batch-task-runtime";
import { RequestRatePool } from "../batch-task/request-rate";
import { ProjectSessionState } from "../project/project-session-state";
import { RuntimeOperationGate } from "../runtime-operation-gate";
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
/** 每次启动复制设置，模拟 Agent 入口向批量服务交付快照。 */
async function setup(request: LLMClientPort["request"] = async () => response()) {
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
        auth_type: "api_key",
        api_key: "private",
        model_id: "model",
        thinking: { level: "HIGH" },
        threshold: { concurrency_limit: 1, rpm_limit: 0 },
      },
    ],
  };
  const append = vi.fn<(payload: LogAppendPayload) => void>();
  const service = new BatchRequestService(
    tasks,
    new RequestRatePool(),
    { request },
    { bind: () => "session" },
    { append },
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
    append,
    settings,
    write_manifest,
    run: () =>
      service.run(
        lease,
        new AbortController().signal,
        root,
        { model: structuredClone(settings.models[0]!), config_snapshot: structuredClone(settings) },
        "manifest.json",
      ),
  };
}
describe("batch request", () => {
  it("同批后续请求固定配置，下一批采用新快照", async () => {
    const request = vi.fn<LLMClientPort["request"]>();
    const f = await setup(request);
    await f.write_manifest([
      { id: "one", input_file: "good.json" },
      { id: "two", input_file: "good.json" },
    ]);
    request.mockImplementation(async () => {
      f.settings.models[0]!.model_id = "next-model";
      f.settings.models[0]!.api_url = "https://next.test/v1";
      return response();
    });
    await f.run();
    expect(request).toHaveBeenCalledTimes(2);
    for (const [input] of request.mock.calls)
      expect(input.model).toMatchObject({ model_id: "model", api_url: "https://example.test/v1" });
    await f.run();
    expect(request.mock.calls[2]![0].model).toMatchObject({
      model_id: "next-model",
      api_url: "https://next.test/v1",
    });
    await f.tasks.dispose();
  });
  it("文本批次逐项发布结果，坏正文只失败本项", async () => {
    const request = vi.fn<LLMClientPort["request"]>().mockResolvedValue(response());
    const f = await setup(request);
    await f.write_manifest([
      { id: "first", input_file: "good.json" },
      { id: "second", input_file: "bad.json" },
    ]);
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
    expect(
      read_batch_task_snapshot(
        JSON.parse(JSON.stringify({ batch_task: f.tasks.build_snapshot() })),
      ),
    ).toMatchObject({
      kind: "request",
      progress: { total: 2, succeeded: 1, failed: 1 },
    });
    const logs = f.append.mock.calls.map(([entry]) => entry);
    const results = logs.filter(
      (entry) => typeof entry.content !== "string" && entry.content.kind === "request_result",
    );
    expect(results).toMatchObject([
      { level: "info", content: { run_id: summary.run_id, request_id: "first" } },
      { level: "error", content: { run_id: summary.run_id, request_id: "second" } },
    ]);
    expect(logs.at(-1)).toMatchObject({ level: "warning", source: "batch-request" });
    expect(format_log_content_text(logs.at(-1)!.content)).toContain(summary.result_file);
    expect(f.gate.get_snapshot().owner).toBe("agent");
    await f.tasks.dispose();
  });
  it("媒体通过统一客户端发送，确定性拒绝只失败该项", async () => {
    const request = vi
      .fn<LLMClientPort["request"]>()
      .mockResolvedValueOnce({
        ...response(),
        http_status: 400,
        request_error: log_error_from_message("Unsupported audio"),
      })
      .mockResolvedValueOnce(response());
    const f = await setup(request);
    f.settings.models[0]!.api_format = "Anthropic";
    const messages = [
      {
        role: "user",
        content: [
          { type: "audio", mime_type: "audio/mpeg", data: "YWJj" },
          { type: "text", text: "transcribe" },
        ],
      },
    ];
    await fs.writeFile(path.join(f.root, "good.json"), JSON.stringify({ messages }));
    await f.write_manifest([
      { id: "one", input_file: "good.json" },
      { id: "two", input_file: "good.json" },
    ]);
    const summary = await f.run();
    expect(summary).toMatchObject({ succeeded: 1, failed: 1 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![0].messages).toEqual(messages);
    const index = JSON.parse(await fs.readFile(summary.result_file, "utf8"));
    const failed = JSON.parse(
      await fs.readFile(
        path.resolve(path.dirname(summary.result_file), index.requests[0].result_file),
        "utf8",
      ),
    );
    expect(failed).toMatchObject({ status: "failed", error: "Unsupported audio" });
    await f.tasks.dispose();
  });

  it.each([
    { type: "audio", mime_type: "video/mp4", data: "YWJj" },
    { type: "video", mime_type: "video/mp4", data: "%%%=" },
    { type: "audio", mime_type: "audio/mpeg", data: "YWJjY" },
  ])("非法媒体输入不发送到服务端：%j", async (part) => {
    const request = vi.fn<LLMClientPort["request"]>();
    const f = await setup(request);
    await fs.writeFile(
      path.join(f.root, "good.json"),
      JSON.stringify({ messages: [{ role: "user", content: [part] }] }),
    );
    await f.write_manifest([{ id: "one", input_file: "good.json" }]);
    expect(await f.run()).toMatchObject({ failed: 1 });
    expect(request).not.toHaveBeenCalled();
    await f.tasks.dispose();
  });

  it("统一响应与错误在发布前脱敏，保留截断失败", async () => {
    const request = vi.fn<LLMClientPort["request"]>().mockResolvedValue({
      ...response(),
      response_result: "partial private",
      response_error: log_error_from_message("truncated private"),
    });
    const f = await setup(request);
    await f.write_manifest([{ id: "one", input_file: "good.json" }]);
    const summary = await f.run();
    expect(summary).toMatchObject({ failed: 1 });
    const index = JSON.parse(await fs.readFile(summary.result_file, "utf8"));
    const saved = await fs.readFile(
      path.resolve(path.dirname(summary.result_file), index.requests[0].result_file),
      "utf8",
    );
    expect(saved).not.toContain("private");
    expect(JSON.parse(saved)).toMatchObject({
      status: "failed",
      error: "truncated [REDACTED]",
      response: { text: "partial [REDACTED]" },
    });
    expect(JSON.stringify(f.append.mock.calls)).not.toContain("private");
    await f.tasks.dispose();
  });

  it("失败后换密钥成功只结算一次，日志采用累计用量", async () => {
    const request = vi
      .fn<LLMClientPort["request"]>()
      .mockResolvedValueOnce({
        ...response(),
        request_error: log_error_from_message("temporary failure"),
        usage_complete: true,
      })
      .mockResolvedValueOnce({ ...response(), usage_complete: true });
    const f = await setup(request);
    f.settings.models[0]!.api_key = "first\nsecond";
    await f.write_manifest([{ id: "one", input_file: "good.json" }]);
    try {
      const value = await f.run();
      expect(value).toMatchObject({
        succeeded: 1,
        failed: 0,
        usage: { input_tokens: 4, reasoning_tokens: 2, output_tokens: 6, usage_complete: true },
      });
      const logs = f.append.mock.calls.map(([entry]) => entry);
      expect(logs.filter((entry) => entry.level === "warning")).toHaveLength(1);
      const results = logs.filter(
        (entry) => typeof entry.content !== "string" && entry.content.kind === "request_result",
      );
      expect(results).toHaveLength(1);
      const content = results[0]!.content;
      if (typeof content === "string" || content.kind !== "request_result")
        throw new Error("Expected request result log");
      expect(content.summary).toContain(
        create_text_resolver("zh-CN")("app.log.task_stats", {
          COUNT: "1",
          TIME: ((Date.parse(content.ended_at) - Date.parse(content.started_at)) / 1000).toFixed(2),
          PT: "4",
          RT: "2",
          CT: "6",
        }),
      );
    } finally {
      await f.tasks.dispose();
    }
  });

  it.each(["progress", "completion"])("成果发布后 %s 事件失败保留逐项成功", async (event) => {
    const f = await setup();
    await f.write_manifest([{ id: "one", input_file: "good.json" }]);
    f.tasks.subscribe((snapshot) => {
      if (event === "completion" ? snapshot.status === "done" : snapshot.progress?.succeeded === 1)
        throw new Error("event failure");
    });
    try {
      await expect(f.run()).rejects.toMatchObject({
        summary: { status: "error", succeeded: 1, unfinished: 0 },
      });
      const logs = f.append.mock.calls.map(([entry]) => entry);
      expect(
        logs.filter(
          (entry) => typeof entry.content !== "string" && entry.content.kind === "request_result",
        ),
      ).toMatchObject([{ level: "info" }]);
      expect(logs.at(-1)).toMatchObject({ level: "error" });
      expect(format_log_content_text(logs.at(-1)!.content)).toContain("error");
    } finally {
      await f.tasks.dispose();
    }
  });

  it("重复 ID 在派发前拒绝", async () => {
    const request = vi.fn<LLMClientPort["request"]>();
    const f = await setup(request);
    await f.write_manifest([
      { id: "same", input_file: "good.json" },
      { id: "same", input_file: "good.json" },
    ]);
    await expect(f.run()).rejects.toThrow("Duplicate");
    expect(request).not.toHaveBeenCalled();
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
    const logs = f.append.mock.calls.map(([entry]) => entry);
    expect(logs.at(-1)).toMatchObject({ level: "error" });
    expect(
      logs.filter(
        (entry) => typeof entry.content !== "string" && entry.content.kind === "request_result",
      ),
    ).toHaveLength(1);
    expect(logs.map((entry) => format_log_content_text(entry.content)).join("\n")).toContain(
      "disk failure",
    );
    await f.tasks.dispose();
  });
});
