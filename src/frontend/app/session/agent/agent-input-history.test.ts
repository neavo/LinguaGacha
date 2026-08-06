import { describe, expect, it, vi } from "vitest";

import {
  AGENT_INPUT_HISTORY_LIMIT,
  AGENT_INPUT_HISTORY_STORAGE_KEY,
  append_agent_input_history,
  read_agent_input_history,
} from "./agent-input-history";

describe("Agent 输入历史持久化", () => {
  it("无历史或读取失败时降级为空数组", () => {
    expect(read_agent_input_history(create_storage(null).storage)).toEqual([]);
    const { storage } = create_storage(null);
    storage.getItem = vi.fn(() => {
      throw new Error("storage unavailable");
    });
    expect(read_agent_input_history(storage)).toEqual([]);
  });

  it("读取纯文本历史并只保留最后 20 条", () => {
    const history = Array.from(
      { length: AGENT_INPUT_HISTORY_LIMIT + 1 },
      (_, index) => `消息 ${index.toString()}`,
    );
    expect(read_agent_input_history(create_storage(JSON.stringify(history)).storage)).toEqual(
      history.slice(1),
    );
  });

  it.each([
    ["非法 JSON", "{"],
    ["非数组", JSON.stringify({})],
    ["旧结构化载荷", JSON.stringify([[{ kind: "text", text: "旧消息" }]])],
    ["混入非字符串", JSON.stringify(["合法", 1])],
    ["空消息", JSON.stringify([""])],
    ["纯空白消息", JSON.stringify([" \n "])],
    ["未规范化消息", JSON.stringify([" 消息 "])],
  ])("%s 使整份历史不可用且不回写", (_name, raw) => {
    const { storage, setItem } = create_storage(raw);
    expect(read_agent_input_history(storage)).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("追加时裁剪旧记录并写入纯文本", () => {
    const current = Array.from(
      { length: AGENT_INPUT_HISTORY_LIMIT },
      (_, index) => `消息 ${index.toString()}`,
    );
    const { storage, setItem } = create_storage(null);
    const next = append_agent_input_history(storage, current, "最新消息");

    expect(next).toEqual([...current.slice(1), "最新消息"]);
    expect(setItem).toHaveBeenCalledWith(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(next));
  });

  it("持久化写入失败时仍返回包含新消息的内存历史", () => {
    const { storage } = create_storage(
      null,
      vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    );
    expect(append_agent_input_history(storage, [], "@skill(glossary-audit)")).toEqual([
      "@skill(glossary-audit)",
    ]);
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
