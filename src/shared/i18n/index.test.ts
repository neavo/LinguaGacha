import { describe, expect, it } from "vitest";

import { create_text_resolver, resolve_i18n_locale } from "./index";

describe("shared i18n", () => {
  it("按 app_language 解析 locale 并替换日志参数", () => {
    const zh_t = create_text_resolver(resolve_i18n_locale("ZH"));
    const en_t = create_text_resolver(resolve_i18n_locale("EN"));

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
  });

  it("未知 app_language 回退中文界面", () => {
    const t = create_text_resolver(resolve_i18n_locale("bad"));

    expect(t("app.diagnostic.lifecycle.app_start_failed")).toBe("LinguaGacha 启动失败 …");
  });
});
