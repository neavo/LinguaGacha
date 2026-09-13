import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type LogAppendPayload } from "../../shared/log";
import { LogManager } from "../log/log-manager";
import {
  AgentSessionLog,
  normalize_agent_tool_log_output,
  type AgentLogContent,
} from "./agent-log";
import { agent_tool_result } from "./model-tools/definition";

describe("AgentSessionLog", () => {
  afterEach(() => vi.useRealTimers());

  it("完整工具结果只存一份，文件详情可见且保留输入快照和实际起止时间", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-09-13T00:00:00.000Z");
    using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "agent-log-"));
    const console_writer = vi.fn();
    const manager = new LogManager({ logDir: directory.path, consoleWriter: console_writer });
    try {
      const log = new AgentSessionLog(manager);
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
      log.handle_event({
        type: "tool_execution_end",
        toolCallId: "call",
        toolName: "fixture_tool",
        result: agent_tool_result(details),
        isError: false,
      });
      details.text = "修改后的结果";
      log.finish_run("success");

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
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "部分回答",
        partial: message,
      },
    });
    log.request_stop();
    expect(records().filter((record) => record.event === "message")).toHaveLength(1);
    log.finish_run("success");
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
    log.handle_event({ type: "compaction_start", reason: "threshold" });
    log.handle_event({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: "压缩失败",
    });
    log.finish_run("success");
    const starts = records().filter((record) => record.event === "run_start");
    expect(starts[0]?.session_id).toBe(starts[1]?.session_id);
    expect(starts[0]?.round_id).toBe(starts[1]?.round_id);
    expect(starts[0]?.run_id).not.toBe(starts[1]?.run_id);
    expect(records().find((record) => record.event === "compaction_end")).toMatchObject({
      status: "error",
      error: "压缩失败",
      started_at: expect.any(String),
      ended_at: expect.any(String),
    });
  });
});

/** 用公开写入口观察事件顺序与身份，不绑定内部缓存结构。 */
function create_log(): { log: AgentSessionLog; records: () => AgentLogContent[] } {
  const append = vi.fn<(payload: LogAppendPayload) => void>();
  return {
    log: new AgentSessionLog({ append }),
    records: () => append.mock.calls.map(([payload]) => payload.content as AgentLogContent),
  };
}
