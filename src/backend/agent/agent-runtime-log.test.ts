import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, type ToolResultMessage } from "@earendil-works/pi-ai";
import type { TaskId } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type LogAppendPayload } from "../../shared/log";
import { LogManager } from "../log/log-manager";
import { agent_tool_result } from "./tool-definition";
import {
  AgentRuntimeLog,
  normalize_agent_tool_log_output,
  type AgentLogContent,
} from "./agent-runtime-log";

const TOOL_RESULT_RECORD = { byTaskId: 1 as TaskId }; // 提交回执用任务身份消费宿主诊断。

it("图片工具日志只保留来源摘要和媒体类型", () => {
  const result = normalize_agent_tool_log_output({
    content: [
      { type: "text", text: '{"path":"work/page.webp"}' },
      { type: "image", mimeType: "image/webp", data: "private-image-bytes" },
    ],
    details: { path: "work/page.webp" },
  });
  expect(JSON.stringify(result)).not.toContain("private-image-bytes");
  expect(result).toMatchObject({
    kind: "content",
    content: [{ type: "text" }, { type: "image", mimeType: "image/webp" }],
  });
});

describe("AgentRuntimeLog", () => {
  afterEach(() => vi.useRealTimers());

  it("按最终等级选择控制台输出，正常停止静默且刷新不重复提交", () => {
    const append = vi.fn<(payload: LogAppendPayload) => void>();
    const log = new AgentRuntimeLog({ append }, "chat-test");
    log.begin_run("round", "prompt");
    for (const level of ["debug", "info", "warning", "error", "fatal"] as const) {
      log.handle_event({
        type: "tool_execution_start",
        toolCallId: level,
        toolName: "fixture_tool",
        args: {},
      });
      log.record_tool_diagnostic(TOOL_RESULT_RECORD.byTaskId, {
        toolCallId: level,
        toolName: "fixture_tool",
        level,
      });
      log.record_tool_result(TOOL_RESULT_RECORD, tool_message(level, { isError: true }));
    }
    log.handle_event({ type: "compaction_start", reason: "threshold", task_id: 1 });
    log.handle_event({
      type: "compaction_end",
      reason: "threshold",
      task_id: 1,
      status: "error",
      error: "fixture compaction",
    });
    log.report_failure("cleanup", new Error("fixture cleanup"));
    log.finish_run("stopped", { stop_reason: "user" });
    log.flush();

    expect(
      append.mock.calls
        .filter(([payload]) => payload.targets?.console)
        .map(([payload]) => payload.level),
    ).toEqual(["warning", "error", "fatal", "error", "warning"]);
    expect(
      append.mock.calls.find(([payload]) => payload.error !== undefined)?.[0].error,
    ).toMatchObject({
      message: "fixture compaction",
    });
    append.mockClear();
    log.flush();
    expect(append).not.toHaveBeenCalled();
  });

  it("完整工具结果只存一份，文件详情可见且保留输入快照和实际起止时间", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-09-13T00:00:00.000Z");
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "agent-runtime-log-"));
    const console_writer = vi.fn();
    const manager = new LogManager({ logDir: directory.path, consoleWriter: console_writer });
    try {
      const log = new AgentRuntimeLog(manager, "chat-test");
      const input = { query: "原始输入", items: Array.from({ length: 40 }, (_, index) => index) };
      const details = { text: '正文 "引号"\n'.repeat(2_000), items: input.items };
      const expected = structuredClone(details);
      log.begin_run("round", "prompt");
      log.handle_event({
        type: "tool_execution_start",
        toolCallId: "call",
        toolName: "fixture_tool",
        args: input,
      });
      input.query = "修改后的输入";
      vi.setSystemTime("2026-09-13T00:00:02.000Z");
      const message = tool_message("call", { ...agent_tool_result(details), durationMs: 125 });
      log.record_tool_result(TOOL_RESULT_RECORD, message);
      log.record_tool_result(TOOL_RESULT_RECORD, message);
      details.text = "修改后的结果";
      log.finish_run("success");

      log.flush();
      const date = manager.files.list_dates()[0]!;
      const records = fs
        .readFileSync(path.join(directory.path, `app.${date}.jsonl`), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records[1].content.input).toEqual({ ...input, query: "原始输入" });
      expect(records[2].content).toMatchObject({
        event: "tool_end",
        status: "success",
        started_at: "2026-09-13T00:00:00.000Z",
        ended_at: "2026-09-13T00:00:02.000Z",
        duration_ms: 125,
      });
      expect(records[2].content.output).toEqual({ kind: "json", value: expected });
      const page = await manager.files.read_page({ date, direction: "latest" });
      expect(page.entries).toHaveLength(4);
      const entry = page.entries[2]!;
      expect((await manager.files.read_detail(entry.id, entry.revision))?.content).toEqual(
        records[2].content,
      );
      expect(console_writer).not.toHaveBeenCalled();
    } finally {
      await manager.shutdown();
    }
  });

  it("独有 details 和不相同的 JSON 文本完整保留", () => {
    const output = {
      content: [{ type: "text", text: "网页正文" }],
      details: { provider: "fixture", truncated: true },
    };
    expect(normalize_agent_tool_log_output(output)).toEqual({ kind: "content", ...output });
    const formatted = {
      content: [{ type: "text", text: '{ "value": 1 }' }],
      details: { value: 1 },
    };
    expect(normalize_agent_tool_log_output(formatted)).toEqual({ kind: "content", ...formatted });
  });

  it("停止时保存后续流式正文，图片只记录类型", () => {
    const { log, records } = create_log();
    log.begin_run("round", "prompt");
    log.handle_event({
      type: "message_start",
      message: {
        role: "user",
        timestamp: Date.now(),
        content: [
          { type: "text", text: "查看图片" },
          { type: "image", data: "image-binary", mimeType: "image/webp" },
        ],
      },
    });
    const message = fauxAssistantMessage("");
    log.handle_event({ type: "message_start", message });
    message.content = [{ type: "text", text: "部分回答" }];
    log.handle_event({
      type: "message_update",
      message,
    });
    log.request_stop("user");
    log.flush();
    expect(records().filter((record) => record.event === "message")).toHaveLength(1);
    log.finish_run("stopped", { stop_reason: "user" });
    log.flush();
    const messages = records().filter((record) => record.event === "message");
    expect(messages).toMatchObject([
      {
        role: "user",
        parts: [
          { kind: "text", text: "查看图片" },
          { kind: "image", mime_type: "image/webp" },
        ],
      },
      {
        role: "assistant",
        status: "stopped",
        parts: [{ kind: "text", text: "部分回答" }],
      },
    ]);
  });

  it("继续执行分配新执行身份并保留轮次，压缩拥有独立起止记录", () => {
    const { log, records } = create_log();
    log.begin_run("round", "prompt");
    log.finish_run("error");
    log.begin_run("round", "continue");
    log.handle_event({ type: "compaction_start", reason: "threshold", task_id: 1 });
    log.handle_event({
      type: "compaction_end",
      reason: "threshold",
      task_id: 1,
      status: "error",
      error: new Error("压缩失败"),
    });
    log.finish_run("success");
    expect(records()).toEqual([]);
    log.flush();
    const starts = records().filter((record) => record.event === "run_start");
    expect(starts[0]?.runtime_id).toBe(starts[1]?.runtime_id);
    expect(starts[0]?.round_id).toBe(starts[1]?.round_id);
    expect(starts[0]?.run_id).not.toBe(starts[1]?.run_id);
    expect(records().find((record) => record.event === "compaction_end")).toMatchObject({
      status: "error",
      task_id: 1,
      started_at: expect.any(String),
      ended_at: expect.any(String),
    });
  });

  it("取消使用 SDK 诊断和原执行停止来源，不补造执行耗时", () => {
    const { log, records } = create_log();
    log.begin_run("round", "prompt");
    log.handle_event({
      type: "tool_execution_start",
      toolCallId: "call",
      toolName: "fixture_tool",
      args: {},
    });
    log.record_tool_diagnostic(TOOL_RESULT_RECORD.byTaskId, {
      toolCallId: "call",
      toolName: "fixture_tool",
      stop_reason: "project_change",
    });
    log.record_tool_result(
      { ...TOOL_RESULT_RECORD, data: { diagnostics: [{ code: "aborted" }] } },
      tool_message("call", { isError: true }),
      "user",
    );
    log.finish_run("stopped");
    log.flush();
    const result = records().find((record) => record.event === "tool_end");
    expect(result).toMatchObject({ status: "stopped", stop_reason: "project_change" });
    expect(result).not.toHaveProperty("duration_ms");
    expect(records().filter((record) => record.event === "tool_end")).toHaveLength(1);
  });

  it("未提交的工具异常在收尾时保留诊断，不生成工具完成事实", () => {
    const append = vi.fn<(payload: LogAppendPayload) => void>();
    const log = new AgentRuntimeLog({ append }, "chat-test");
    log.begin_run("round", "prompt");
    log.handle_event({
      type: "tool_execution_start",
      toolCallId: "call",
      toolName: "fixture_tool",
      args: {},
    });
    const failure = new Error("工具故障", { cause: new Error("原始原因") });
    log.record_tool_diagnostic(7, {
      toolCallId: "call",
      toolName: "fixture_tool",
      level: "error",
      error: failure,
    });
    failure.message = "后续改写";
    failure.cause = new Error("后续原因");
    log.flush();
    expect(
      append.mock.calls.map(([payload]) => (payload.content as AgentLogContent).event),
    ).toEqual(["run_start", "tool_start"]);
    log.finish_run("error", { error: new Error("提交失败") });
    log.finish_tools();
    log.flush();
    const diagnostics = append.mock.calls.filter(
      ([payload]) => (payload.content as AgentLogContent).event === "tool_diagnostic",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]![0]).toMatchObject({
      level: "error",
      error: { message: "工具故障", cause_chain: [{ message: "原始原因" }] },
      content: { task_id: 7, round_id: "round" },
    });
    expect(
      append.mock.calls.some(
        ([payload]) => (payload.content as AgentLogContent).event === "tool_end",
      ),
    ).toBe(false);
  });

  it("助手日志透传请求耗时，旧消息保留缺失值", () => {
    const { log, records } = create_log();
    for (const durationMs of [321, undefined]) {
      const message = fauxAssistantMessage("完成");
      log.handle_event({ type: "message_start", message });
      if (durationMs !== undefined) message.durationMs = durationMs;
      log.handle_event({ type: "message_end", message });
    }
    log.flush();
    expect(records()[0]).toMatchObject({ duration_ms: 321 });
    expect(records()[1]).not.toHaveProperty("duration_ms");
  });
});

/** 使用 SDK 消息形状验证回执投影，耗时由各场景显式提供。 */
function tool_message(
  toolCallId: string,
  result: Partial<ToolResultMessage> = {},
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "fixture_tool",
    content: [],
    isError: false,
    timestamp: Date.now(),
    ...result,
  };
}

/** 用公开写入口观察事件顺序与身份，不绑定内部缓存结构。 */
function create_log(): { log: AgentRuntimeLog; records: () => AgentLogContent[] } {
  const append = vi.fn<(payload: LogAppendPayload) => void>();
  return {
    log: new AgentRuntimeLog({ append }, "chat-test"),
    records: () => append.mock.calls.map(([payload]) => payload.content as AgentLogContent),
  };
}
