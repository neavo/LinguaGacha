import { expect, it, vi } from "vitest";
import type { AgentEntry } from "@shared/agent";
import { AgentTimelineStore } from "./agent-timeline-store";

it("正文更新只通知对应条目，历史与轮次结构保持引用稳定", () => {
  const store = new AgentTimelineStore();
  const history: AgentEntry = {
    kind: "assistant_message",
    id: "history",
    parts: [{ kind: "text", text: "历史" }],
    status: "success",
    createdAt: 1,
  };
  const current: AgentEntry = {
    kind: "assistant_message",
    id: "current",
    parts: [{ kind: "text", text: "开头" }],
    status: "running",
    createdAt: 2,
  };
  store.replace([history, current]);
  store.notify();
  const structure = store.read();
  const old = store.entry("history");
  const structureChanged = vi.fn();
  const oldChanged = vi.fn();
  const currentChanged = vi.fn();
  store.subscribe(structureChanged);
  store.subscribe_entry("history", oldChanged);
  const unsubscribe = store.subscribe_entry("current", currentChanged);
  store.update([{ ...current, parts: [{ kind: "text", text: "开头和后续" }] }]);
  expect(currentChanged).not.toHaveBeenCalled();
  store.notify();
  expect(currentChanged).toHaveBeenCalledOnce();
  expect(structureChanged).not.toHaveBeenCalled();
  expect(oldChanged).not.toHaveBeenCalled();
  expect(store.read()).toBe(structure);
  expect(store.entry("history")).toBe(old);
  expect(store.entry("current")).toMatchObject({ parts: [{ text: "开头和后续" }] });
  unsubscribe();
  store.update([{ ...current, parts: [{ kind: "text", text: "取消订阅后的更新" }] }]);
  store.notify();
  expect(currentChanged).toHaveBeenCalledOnce();
});

it("快照替换清除旧轮次、操作状态和条目，并通知被移除条目的读者", () => {
  const store = new AgentTimelineStore();
  store.replace([
    {
      kind: "user_message",
      id: "round",
      delivery: "round",
      text: "输入",
      attachments: [],
      createdAt: 1,
      status: "running",
      endedAt: null,
      averageTokensPerSecond: null,
    },
    {
      kind: "tool_call",
      id: "tool",
      toolName: "workspace_apply",
      input: "{}",
      status: "running",
      output: null,
      createdAt: 2,
    },
    { kind: "context_compaction", id: "compact", status: "running" },
  ]);
  store.notify();
  expect(store.read()).toMatchObject({
    roundIds: ["round"],
    latestCompactionId: "compact",
    workspaceApplyRunning: true,
    compacting: true,
  });
  const removed = vi.fn(() => expect(store.entry("tool")).toBeUndefined());
  store.subscribe_entry("tool", removed);
  store.replace([]);
  store.notify();
  expect(removed).toHaveBeenCalledOnce();
  expect(store.read()).toEqual({
    entryIds: [],
    roundIds: [],
    latestRoundId: null,
    latestCompactionId: null,
    workspaceApplyRunning: false,
    compacting: false,
  });
  expect(store.round("round")).toEqual([]);
});

it("最近压缩身份随追加更新，旧条目的迟到更新不会覆盖最新身份", () => {
  const store = new AgentTimelineStore();
  const failed: AgentEntry = { kind: "context_compaction", id: "failed", status: "error" };
  store.replace([failed]);
  expect(store.read()).toMatchObject({ latestCompactionId: "failed", compacting: false });
  store.update([{ kind: "context_compaction", id: "retry", status: "running" }]);
  expect(store.read()).toMatchObject({ latestCompactionId: "retry", compacting: true });
  store.update([{ ...failed, status: "success" }]);
  expect(store.read()).toMatchObject({ latestCompactionId: "retry", compacting: true });
  store.update([{ kind: "context_compaction", id: "retry", status: "success" }]);
  expect(store.read()).toMatchObject({ latestCompactionId: "retry", compacting: false });
  store.replace([failed]);
  expect(store.read()).toMatchObject({ latestCompactionId: "failed", compacting: false });
});
