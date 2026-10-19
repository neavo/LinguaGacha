import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROXY_SETTING,
  DEFAULT_SETTING,
  normalize_setting_snapshot,
  read_proxy_setting,
  SETTING_SNAPSHOT_SCHEMA,
  Setting,
} from "./setting";
import { Check } from "typebox/value";

describe("设置快照", () => {
  it("读取与更新的结果满足同一快照结构，并保留文本边界", () => {
    const setting = Setting.from_json({
      source_language: " en ",
      project_fixed_path: " Mixed/Path ",
      clean_ruby: "1",
      request_timeout: "45",
      recent_projects: [{ path: " p.lg ", name: "工程" }],
    });
    expect(setting.to_json()["project_fixed_path"]).toBe(" Mixed/Path ");
    expect(setting.to_json()).not.toHaveProperty("source_language"); // 语言归项目所有，旧配置字段不再保留
    expect(setting.to_snapshot()).toMatchObject({
      project_fixed_path: "Mixed/Path",
      clean_ruby: true,
      request_timeout: 45,
    });
    expect(Check(SETTING_SNAPSHOT_SCHEMA, setting.to_snapshot())).toBe(true);
    expect(
      Check(
        SETTING_SNAPSHOT_SCHEMA,
        setting.with_setting_value("request_timeout", "bad").to_snapshot(),
      ),
    ).toBe(true);
  });
  it("缺失或非法设置沿用默认值，旧语言字段不进入应用设置快照", () => {
    const snapshot = normalize_setting_snapshot({
      source_language: " en ",
      request_timeout: Infinity,
      agent_approval_mode: "unknown",
    });
    expect(snapshot).toMatchObject({
      agent_approval_mode: "manual",
      request_timeout: DEFAULT_SETTING["request_timeout"],
    });
    expect(snapshot).not.toHaveProperty("source_language");
    expect(snapshot).not.toHaveProperty("target_language");
  });

  it("结果检查旧字段不会进入设置快照", () => {
    const snapshot = normalize_setting_snapshot({
      check_kana_residue: false,
      check_hangeul_residue: false,
      check_similarity: false,
    });

    expect(snapshot).not.toHaveProperty("check_kana_residue");
    expect(snapshot).not.toHaveProperty("check_hangeul_residue");
    expect(snapshot).not.toHaveProperty("check_similarity");
  });

  it("完整设置规范化模型选择并丢弃旧激活字段", () => {
    const legacy_key = ["activate", "model", "id"].join("_");
    const setting = Setting.from_json({
      [legacy_key]: "legacy",
      model_selection: {
        translation: " translation-model ",

        agent: "agent-model",
        unknown: "ignored",
      },
    }).to_json();

    expect(setting["model_selection"]).toEqual({
      translation: "translation-model",

      agent: "agent-model",
      agent_batch_translation: null,
    });
    expect(setting).not.toHaveProperty(legacy_key);
  });
});

describe("代理设置", () => {
  it("旧配置缺少代理字段时补默认值，未知嵌套字段不进入设置", () => {
    expect(Setting.from_json({ request_timeout: 30 }).to_json()["proxy"]).toEqual(
      DEFAULT_PROXY_SETTING,
    );
    const proxy = Setting.from_json({
      proxy: { mode: "socks", protocol: "SOCKS4", extra: "ignored" },
    }).to_json()["proxy"];
    expect(proxy).toMatchObject({ mode: "system", protocol: "HTTP" });
    expect(proxy).not.toHaveProperty("extra");
  });

  it("代理端口接受字符串，主机与用户名裁剪空格，密码保留空格", () => {
    const setting = Setting.from_json({
      proxy: { host: " 127.0.0.1 ", port: "7890", username: " user ", password: " pa ss " },
    });
    const proxy = {
      mode: "system",
      protocol: "HTTP",
      host: "127.0.0.1",
      port: 7890,
      username: "user",
      password: " pa ss ",
    };
    expect(setting.to_json()["proxy"]).toEqual(proxy);
    expect(setting.to_snapshot().proxy).toEqual(proxy);
  });

  it("设置快照携带代理字段并通过结构检查", () => {
    const snapshot = normalize_setting_snapshot({});
    expect(snapshot.proxy).toEqual(DEFAULT_PROXY_SETTING);
    expect(Check(SETTING_SNAPSHOT_SCHEMA, snapshot)).toBe(true);
  });

  it("手动字段不完整时出站降级为跟随系统，并给出首个缺失字段", () => {
    expect(read_proxy_setting({ mode: "manual", host: "", port: 7890 })).toMatchObject({
      effective_mode: "system",
      incomplete_field: "proxy.host",
    });
    expect(read_proxy_setting({ mode: "manual", host: "127.0.0.1", port: 0 })).toMatchObject({
      effective_mode: "system",
      incomplete_field: "proxy.port",
    });
    expect(read_proxy_setting({ mode: "manual", host: "127.0.0.1", port: 70000 })).toMatchObject({
      effective_mode: "system",
      incomplete_field: "proxy.port",
    });
    expect(
      read_proxy_setting({ mode: "manual", host: "127.0.0.1", port: 1080, password: "token" }),
    ).toMatchObject({ effective_mode: "system", incomplete_field: "proxy.username" });
  });

  it("手动字段完整时出站使用手动模式", () => {
    expect(
      read_proxy_setting({
        mode: "manual",
        protocol: "SOCKS5",
        host: "127.0.0.1",
        port: 1080,
        username: "user",
        password: "token",
      }),
    ).toMatchObject({ effective_mode: "manual", incomplete_field: null });
  });

  it("代理主机接受域名、IPv4 与方括号 IPv6，拒绝会改变 URI 结构或非法的写法", () => {
    const incomplete_of = (host: string) =>
      read_proxy_setting({ mode: "manual", host, port: 7890 }).incomplete_field;

    expect(incomplete_of("proxy.example.com")).toBeNull();
    expect(incomplete_of("127.0.0.1")).toBeNull();
    expect(incomplete_of("[::1]")).toBeNull();
    expect(incomplete_of("http://proxy.example.com")).toBe("proxy.host");
    expect(incomplete_of("proxy.example.com:8080")).toBe("proxy.host");
    expect(incomplete_of("proxy example.com")).toBe("proxy.host");
    expect(incomplete_of("proxy.example.com?ignored")).toBe("proxy.host");
    expect(incomplete_of("proxy.example.com#ignored")).toBe("proxy.host");
    expect(incomplete_of("proxy.example.com/path")).toBe("proxy.host");
    expect(incomplete_of("user@proxy.example.com")).toBe("proxy.host");
    expect(incomplete_of("[:::]")).toBe("proxy.host");
    expect(incomplete_of("[::1]:8080")).toBe("proxy.host");
  });

  it("直连与跟随系统不检查手动字段", () => {
    expect(read_proxy_setting({ mode: "direct" })).toMatchObject({
      effective_mode: "direct",
      incomplete_field: null,
    });
    expect(read_proxy_setting({})).toMatchObject({
      effective_mode: "system",
      incomplete_field: null,
    });
  });

  it("读取与更新不因手动配置不完整而改写用户选择", () => {
    const setting = Setting.from_json({ proxy: { mode: "manual", host: "", port: 7890 } });

    expect(setting.to_json()["proxy"]).toMatchObject({ mode: "manual", host: "", port: 7890 });
    expect(setting.to_snapshot().proxy).toMatchObject({ mode: "manual" });
    expect(read_proxy_setting(setting.to_json()).effective_mode).toBe("system");
    expect(
      setting.with_setting_value("proxy", { mode: "direct", host: "", port: 0 }).to_json()["proxy"],
    ).toEqual({ mode: "direct", protocol: "HTTP", host: "", port: 0, username: "", password: "" });
  });
});
