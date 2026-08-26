import { describe, expect, it } from "vitest";

import { create_text_resolver } from "@shared/i18n";
import { format_project_settings_aligned_toast } from "./project-settings-alignment-feedback";

describe("format_project_settings_aligned_toast", () => {
  it("只列出发生变化的设置，并使用当前状态文案", () => {
    const t = create_text_resolver("zh-CN");
    const result = format_project_settings_aligned_toast({
      settings: {
        source_language: "en",
        target_language: "ZH-HANT",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
      },
      changed_fields: {
        source_language: true,
        mtool_optimizer_enable: true,
      },
      t,
    });

    expect(result).toContain(t("app.project_settings_alignment.field.source_language"));
    expect(result).toContain(t("app.language.EN"));
    expect(result).toContain(t("app.project_settings_alignment.field.mtool_optimizer_enable"));
    expect(result).toContain(t("app.state.enabled"));
    expect(result).not.toContain(t("app.project_settings_alignment.field.target_language"));
    expect(result).not.toContain(
      t("app.project_settings_alignment.field.skip_duplicate_source_text_enable"),
    );
  });

  it("没有变化字段时只返回汇总提示", () => {
    const t = create_text_resolver("zh-CN");
    expect(
      format_project_settings_aligned_toast({
        settings: {
          source_language: "EN",
          target_language: "ZH",
          mtool_optimizer_enable: false,
          skip_duplicate_source_text_enable: false,
        },
        changed_fields: {},
        t,
      }),
    ).toBe(t("app.feedback.project_settings_aligned"));
  });
});
