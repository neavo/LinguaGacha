import { describe, expect, it } from "vitest";

import {
  build_project_execution_settings,
  parse_project_language_patch,
  read_project_language_settings,
  read_project_prefilter_settings,
} from "./project-settings";

describe("项目设置", () => {
  it("历史项目逐字段兜底，已有语言保留", () => {
    expect(read_project_language_settings({})).toEqual({
      source_language: "JA",
      target_language: "ZH",
    });
    expect(read_project_language_settings({ target_language: " ko " })).toEqual({
      source_language: "JA",
      target_language: "KO",
    });
    expect(
      read_project_language_settings({
        source_language: "",
        prefilter_config: { source_language: "en" },
      }),
    ).toEqual({ source_language: "EN", target_language: "ZH" });
    expect(
      read_project_language_settings({ source_language: "ALL", target_language: "XX" }),
    ).toEqual({ source_language: "ALL", target_language: "ZH" });
  });

  it("预过滤开关优先读取 meta，再回退旧镜像", () => {
    expect(
      read_project_prefilter_settings({
        mtool_optimizer_enable: false,
        prefilter_config: {
          mtool_optimizer_enable: true,
          skip_duplicate_source_text_enable: false,
        },
      }),
    ).toEqual({ mtool_optimizer_enable: false, skip_duplicate_source_text_enable: false });
  });

  it("请求边界拒绝未知字段与不支持的语言", () => {
    expect(parse_project_language_patch({ target_language: "zh-hant" })).toEqual({
      target_language: "ZH-HANT",
    });
    expect(() => parse_project_language_patch({ target_language: "ALL" })).toThrow();
    expect(() => parse_project_language_patch({ source_language: 1 })).toThrow();
    expect(() => parse_project_language_patch({ app_language: "ZH" })).toThrow();
  });

  it("执行快照组合应用设置与项目语言，应用设置不提供语言", () => {
    const settings = build_project_execution_settings(
      { source_language: "KO", request_timeout: 30 },
      { source_language: "EN", target_language: "DE" },
    );
    expect(settings).toMatchObject({
      source_language: "EN",
      target_language: "DE",
      request_timeout: 30,
    });
  });
});
