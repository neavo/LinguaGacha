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
    const message = format_i18n_message("zh-CN", "app.tooltip.value", {
      TITLE: "术语表",
      VALUE: "已启用",
    });
    expect(message).toContain("术语表");
    expect(message).toContain("已启用");
    expect(read_message_placeholders(message)).toEqual([]);
    expect(create_text_resolver("de-DE")("app.action.confirm")).toBe(
      MESSAGE_MAP_BY_LOCALE["de-DE"].get("app.action.confirm"),
    );
  });
});

/**
 * 只比较插值参数名，允许不同语言自由调整参数顺序和周边文案。
 */
function read_message_placeholders(message: string): string[] {
  return [...message.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1] ?? "").sort();
}
