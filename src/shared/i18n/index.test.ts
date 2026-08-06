import { describe, expect, it } from "vitest";

import { create_text_resolver, format_i18n_message, LOCALES, MESSAGE_MAP_BY_LOCALE } from "./index";

describe("shared i18n", () => {
  it("所有 locale 保持相同消息 key 和插值参数", () => {
    const reference_map = MESSAGE_MAP_BY_LOCALE["zh-CN"];
    const reference_keys = [...reference_map.keys()].sort();

    for (const locale of LOCALES) {
      const message_map = MESSAGE_MAP_BY_LOCALE[locale];
      expect([...message_map.keys()].sort()).toEqual(reference_keys);
      for (const key of reference_keys) {
        expect(read_message_placeholders(message_map.get(key)!)).toEqual(
          read_message_placeholders(reference_map.get(key)!),
        );
      }
    }
  });

  it("按 locale 解析消息并替换参数", () => {
    expect(format_i18n_message("zh-CN", "app.feedback.feature_enabled", { TITLE: "术语表" })).toBe(
      "术语表已启用 …",
    );
    expect(
      create_text_resolver("de-DE")("app.feedback.feature_enabled", { TITLE: "Glossar" }),
    ).toBe("Glossar aktiviert …");
  });

  it("相关 UI 统一使用命中词表", () => {
    const keys = [
      "glossary_page.fields.hit",
      "text_replacement_page.fields.hit",
      "text_preserve_page.fields.hit",
    ] as const;
    for (const key of keys) {
      expect(create_text_resolver("zh-CN")(key)).toBe("命中");
      expect(create_text_resolver("en-US")(key)).toBe("Hits");
      expect(create_text_resolver("de-DE")(key)).toBe("Treffer");
    }
    expect(
      create_text_resolver("en-US")("agent_page.mention.term_hits", {
        count: "7",
      }),
    ).toBe("7 Hits");
  });

  it("解析 AGENT 品牌、英文任务按钮与模型默认容量文案", () => {
    for (const locale of LOCALES) {
      expect(create_text_resolver(locale)("agent_page.title")).toBe("AGENT");
    }

    expect(create_text_resolver("en-US")("agent_page.action.new_task")).toBe("New Task");
    expect(
      create_text_resolver("zh-CN")("model_page.fields.context_window.description", {
        DEFAULT: "288000",
      }),
    ).toBe("仅对 AGENT 任务生效，默认值为 288000");
    expect(
      create_text_resolver("zh-CN")("model_page.fields.max_output_tokens.description", {
        DEFAULT: "32000",
      }),
    ).toBe("仅对 AGENT 任务生效，默认值为 32000");
    expect(
      create_text_resolver("en-US")("model_page.fields.context_window.description", {
        DEFAULT: "288000",
      }),
    ).toBe("Only applies to AGENT tasks, default value: 288000");
    expect(
      create_text_resolver("de-DE")("model_page.fields.context_window.description", {
        DEFAULT: "288000",
      }),
    ).toBe("Gilt nur für AGENT-Aufgaben, standardwert: 288000");
  });
});

/**
 * 只比较插值参数名，允许不同语言自由调整参数顺序和周边文案。
 */
function read_message_placeholders(message: string): string[] {
  return [...message.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1] ?? "").sort();
}
