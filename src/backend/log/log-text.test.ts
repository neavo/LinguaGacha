import { afterEach, describe, expect, it } from "vitest";

import { set_main_log_language_reader, t_main_log } from "./log-text";

describe("main log text", () => {
  afterEach(() => {
    set_main_log_language_reader(null);
  });

  it("按当前 app_language 生成日志正文", () => {
    set_main_log_language_reader(() => "EN");

    expect(t_main_log("app.log.api_gateway_started", { BASE_URL: "http://127.0.0.1:65425" })).toBe(
      "API Gateway started - http://127.0.0.1:65425",
    );
  });

  it("语言读取器失败时回退默认中文日志正文", () => {
    set_main_log_language_reader(() => {
      throw new Error("配置暂不可读");
    });

    expect(t_main_log("app.log.api_gateway_started", { BASE_URL: "http://127.0.0.1:65425" })).toBe(
      "API Gateway 已启动 - http://127.0.0.1:65425",
    );
  });
});
