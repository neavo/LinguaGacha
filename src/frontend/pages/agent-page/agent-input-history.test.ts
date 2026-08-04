import { describe, expect, it, vi } from "vitest";

import type { AgentUserMessagePart } from "@shared/agent";
import {
  AGENT_INPUT_HISTORY_LIMIT,
  AGENT_INPUT_HISTORY_STORAGE_KEY,
  append_agent_input_history,
  read_agent_input_history,
} from "./agent-input-history";

describe("Agent 输入历史", () => {
  it("无持久历史时返回空数组", () => {
    expect(read_agent_input_history(create_storage(null).storage)).toEqual([]);
  });

  it("读取存储失败时降级为空历史", () => {
    const { storage } = create_storage(null);
    storage.getItem = vi.fn(() => {
      throw new Error("storage unavailable");
    });

    expect(read_agent_input_history(storage)).toEqual([]);
  });

  it("读取合法的 text 与 skill 混排历史并保持顺序", () => {
    const raw = JSON.stringify([
      [
        { kind: "text", text: "第" },
        { kind: "text", text: "一条" },
        { kind: "text", text: "" },
      ],
      [
        { kind: "text", text: "检查 " },
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: " 结果" },
      ],
    ]);

    expect(read_agent_input_history(create_storage(raw).storage)).toEqual([
      [{ kind: "text", text: "第一条" }],
      [
        { kind: "text", text: "检查 " },
        { kind: "skill", name: "glossary-audit" },
        { kind: "text", text: " 结果" },
      ],
    ]);
  });

  it("读取超过上限的合法历史时只返回最后 20 条", () => {
    const history = Array.from({ length: AGENT_INPUT_HISTORY_LIMIT + 1 }, (_, index) => [
      { kind: "text" as const, text: `消息 ${index.toString()}` },
    ]);

    expect(read_agent_input_history(create_storage(JSON.stringify(history)).storage)).toEqual(
      history.slice(1),
    );
  });

  it.each([
    ["非法 JSON", "{"],
    ["非数组", JSON.stringify({})],
    ["任一非法消息", JSON.stringify([[{ kind: "text", text: "合法" }], [{ kind: "bad" }]])],
    ["空消息", JSON.stringify([[]])],
    ["纯空白消息", JSON.stringify([[{ kind: "text", text: " \n " }]])],
  ])("%s 使整份历史不可用且不回写", (_name, raw) => {
    const { storage, setItem } = create_storage(raw);

    expect(read_agent_input_history(storage)).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("成功追加时裁剪旧记录、写入规范顺序并隔离调用方引用", () => {
    const current = Array.from({ length: AGENT_INPUT_HISTORY_LIMIT }, (_, index) => [
      { kind: "text" as const, text: `消息 ${index.toString()}` },
    ]);
    const parts: AgentUserMessagePart[] = [{ kind: "text", text: "最新消息" }];
    const { storage, setItem } = create_storage(null);

    const next = append_agent_input_history(storage, current, parts);
    parts[0]!.text = "已被调用方修改";

    expect(next).toEqual([...current.slice(1), [{ kind: "text", text: "最新消息" }]]);
    expect(setItem).toHaveBeenCalledWith(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(next));
  });

  it("持久化写入失败时仍返回包含新消息的内存历史", () => {
    const { storage } = create_storage(
      null,
      vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    );

    expect(
      append_agent_input_history(storage, [], [{ kind: "skill", name: "glossary-audit" }]),
    ).toEqual([[{ kind: "skill", name: "glossary-audit" }]]);
  });
});

function create_storage(raw: string | null, setItem = vi.fn()) {
  const storage = {
    length: raw === null ? 0 : 1,
    clear: vi.fn(),
    getItem: vi.fn(() => raw),
    key: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem,
  } satisfies Storage;
  return { storage, setItem };
}
