import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTING,
  normalize_setting_snapshot,
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
    expect(setting.to_json()).not.toHaveProperty("clean_ruby");
    expect(setting.to_snapshot()).not.toHaveProperty("clean_ruby");
    expect(setting.to_json()).not.toHaveProperty("source_language"); // 语言归项目所有，旧配置字段不再保留
    expect(setting.to_snapshot()).toMatchObject({
      project_fixed_path: "Mixed/Path",
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
