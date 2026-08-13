import { describe, expect, it, vi } from "vitest";

import {
  AGENT_INPUT_HISTORY_LIMIT,
  AGENT_INPUT_HISTORY_STORAGE_KEY,
  read_agent_input_history,
  replace_agent_input_history,
  update_agent_input_history,
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

  it("读取纯文本历史并只保留容量内的最近记录", () => {
    const history = Array.from(
      { length: AGENT_INPUT_HISTORY_LIMIT + 1 },
      (_, index) => `消息 ${index.toString()}`,
    );
    expect(read_agent_input_history(create_storage(JSON.stringify(history)).storage)).toEqual(
      history.slice(1),
    );
  });

  it("读取旧重复记录时保留最近使用位置，并让容量作用于唯一消息", () => {
    const history = Array.from(
      { length: AGENT_INPUT_HISTORY_LIMIT },
      (_, index) => `消息 ${index.toString()}`,
    );
    const repeated = history[5]!;
    const { storage, setItem } = create_storage(JSON.stringify([...history, repeated]));

    expect(read_agent_input_history(storage)).toEqual([
      ...history.filter((message) => message !== repeated),
      repeated,
    ]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each([
    ["非法 JSON", "{"],
    ["非数组", JSON.stringify({})],
    ["旧结构化载荷", JSON.stringify([[{ kind: "text", text: "旧消息" }]])],
    ["纯空白消息", JSON.stringify([" \n "])],
    ["未规范化消息", JSON.stringify([" 消息 "])],
  ])("%s 使整份历史不可用且不回写", (_name, raw) => {
    const { storage, setItem } = create_storage(raw);
    expect(read_agent_input_history(storage)).toEqual([]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("更新时裁剪最旧记录并写入纯文本", () => {
    const current = Array.from(
      { length: AGENT_INPUT_HISTORY_LIMIT },
      (_, index) => `消息 ${index.toString()}`,
    );
    const { storage, setItem } = create_storage(null);
    const next = update_agent_input_history(storage, current, "最新消息");

    expect(next).toEqual([...current.slice(1), "最新消息"]);
    expect(setItem).toHaveBeenCalledWith(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(next));
  });

  it.each([["非连续重复", ["第一条", "重复", "第三条"], "重复", ["第一条", "第三条", "重复"]]])(
    "%s 输入只保留最近位置",
    (_name, current, text, expected) => {
      const { storage } = create_storage(null);
      const next = update_agent_input_history(storage, current, text);

      expect(next).toEqual(expected);
    },
  );

  it("持久化写入失败时仍返回包含新消息的内存历史", () => {
    const { storage } = create_storage(
      null,
      vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    );
    expect(update_agent_input_history(storage, [], "@skill(glossary-audit)")).toEqual([
      "@skill(glossary-audit)",
    ]);
  });

  it("修改 user 消息时删除旧正文并把新正文放到最近位置", () => {
    const { storage } = create_storage(null);
    expect(
      replace_agent_input_history(storage, ["第一条", "旧正文", "第三条"], "旧正文", "新正文"),
    ).toEqual(["第一条", "第三条", "新正文"]);
    expect(replace_agent_input_history(storage, ["第一条", "旧正文"], "旧正文", "")).toEqual([
      "第一条",
    ]);
  });
});

/** 构造最小 Storage 边界，并暴露唯一需要观察的持久化调用。 */
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
