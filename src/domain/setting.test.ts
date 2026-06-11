import { describe, expect, it } from "vitest";

import {
  normalize_app_language,
  normalize_project_save_mode,
  normalize_project_settings_snapshot,
  normalize_setting_snapshot,
  resolve_app_locale,
} from "./setting";

describe("settings 基础模型", () => {
  it("规范化应用语言、locale 和项目保存模式", () => {
    expect(normalize_app_language("en")).toBe("EN");
    expect(normalize_app_language("bad")).toBe("ZH");
    expect(resolve_app_locale("EN")).toBe("en-US");
    expect(resolve_app_locale("ZH")).toBe("zh-CN");
    expect(normalize_project_save_mode("FIXED")).toBe("FIXED");
    expect(normalize_project_save_mode("bad")).toBe("MANUAL");
  });

  it("设置快照缺字段时统一使用领域默认值", () => {
    expect(normalize_setting_snapshot({})).toMatchObject({
      source_language: "JA",
      target_language: "ZH",
      output_folder_open_on_finish: false,
      request_timeout: 120,
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    });
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

  it("项目设置镜像按请求、项目事实和默认值顺序归一", () => {
    const stored_settings = normalize_project_settings_snapshot({
      source_language: "EN",
      mtool_optimizer_enable: false,
    });

    expect(normalize_project_settings_snapshot({ target_language: "KO" }, stored_settings)).toEqual(
      {
        source_language: "EN",
        target_language: "KO",
        mtool_optimizer_enable: false,
        skip_duplicate_source_text_enable: true,
      },
    );
  });
});
