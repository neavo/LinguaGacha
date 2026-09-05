import { describe, expect, it } from "vitest";

import {
  normalize_translation_actor,
  resolve_translation_prompt_mode,
  type TranslationRequestItem,
} from "./translation-item";

describe("翻译 item 模型", () => {
  it("归一姓名字段时只接受字符串姓名", () => {
    expect(normalize_translation_actor(null)).toBeNull();
    expect(normalize_translation_actor("  虎鉄  ")).toBe("虎鉄");
    expect(normalize_translation_actor("  ")).toBeNull();
    expect(normalize_translation_actor(["", " Alice ", 1, "Bob"])).toBeNull();
  });

  it("单次请求内存在有效姓名时切换到 actor/text 模式", () => {
    expect(
      resolve_translation_prompt_mode([
        create_item({ request_index: 0, text_src: "正文一", actor_src: null }),
        create_item({ request_index: 1, text_src: "正文二", actor_src: "虎鉄" }),
      ]),
    ).toBe("actor_text");
  });

  it("没有有效姓名的请求保持纯文本模式", () => {
    expect(resolve_translation_prompt_mode([create_item({ text_src: "正文" })])).toBe("text");
  });
});

function create_item(overrides: Partial<TranslationRequestItem>): TranslationRequestItem {
  return { request_index: 0, item_index: 0, text_src: "", actor_src: null, ...overrides };
}
