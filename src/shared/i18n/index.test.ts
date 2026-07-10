import { describe, expect, it } from "vitest";

import { create_text_resolver, LOCALES, MESSAGE_MAP_BY_LOCALE } from "./index";

describe("shared i18n", () => {
  it("按 locale 解析文案并替换日志参数", () => {
    const zh_t = create_text_resolver("zh-CN");
    const en_t = create_text_resolver("en-US");

    expect(zh_t("app.log.api_gateway_started", { BASE_URL: "http://127.0.0.1:65425" })).toBe(
      "API Gateway 已启动 - http://127.0.0.1:65425",
    );
    expect(en_t("app.log.api_gateway_started", { BASE_URL: "http://127.0.0.1:65425" })).toBe(
      "API Gateway started - http://127.0.0.1:65425",
    );
    expect(zh_t("app.log.api_test_token_info", { CT: "23", PT: "5", TIME: "3.54" })).toBe(
      "任务耗时 3.54 秒，输入消耗 5 Tokens，输出消耗 23 Tokens",
    );
    expect(en_t("app.log.api_test_token_info", { CT: "23", PT: "5", TIME: "3.54" })).toBe(
      "Task time 3.54 seconds, input tokens 5, output tokens 23",
    );
    expect(zh_t("app.log.app_version", { VERSION: "9.8.7" })).toBe("LinguaGacha v9.8.7 …");
    expect(en_t("app.log.app_version", { VERSION: "9.8.7" })).toBe("LinguaGacha v9.8.7 …");
    expect(zh_t("app.system_proxy.startup_notice", { PROXY: "http://127.0.0.1:7890" })).toBe(
      "检查到系统代理设置 - http://127.0.0.1:7890",
    );
    expect(en_t("app.system_proxy.startup_notice", { PROXY: "http://127.0.0.1:7890" })).toBe(
      "System proxy setting detected - http://127.0.0.1:7890",
    );
    expect(zh_t("app.log.system_proxy_startup_detected", { PROXY: "http://127.0.0.1:7890" })).toBe(
      "检查到系统代理设置 - http://127.0.0.1:7890",
    );
  });

  it("解析德语文案", () => {
    const de_t = create_text_resolver("de-DE");

    expect(de_t("app.log.api_gateway_started", { BASE_URL: "http://127.0.0.1:65425" })).toBe(
      "API Gateway gestartet - http://127.0.0.1:65425",
    );
    expect(de_t("app.action.cancel")).toBe("Abbrechen");
    expect(de_t("app.navigation_action.language")).toBe("Sprache");
  });

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
});

function read_message_placeholders(message: string): string[] {
  return [...message.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1] ?? "").sort();
}
