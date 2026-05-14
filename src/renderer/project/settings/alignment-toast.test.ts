import { describe, expect, it } from "vitest";

import { format_project_settings_aligned_toast } from "@/project/settings/alignment-toast";
import type { LocaleKey } from "@/app/locale/locale-provider";

const TEXT_BY_KEY: Partial<Record<LocaleKey, string>> = {
  "app.feedback.project_settings_aligned": "已按当前设置更新项目设置 …",
  "app.project_settings_alignment.field.source_language": "输入语言",
  "app.project_settings_alignment.field.target_language": "输出语言",
  "app.project_settings_alignment.field.mtool_optimizer_enable": "MTool 优化器",
  "app.project_settings_alignment.field.skip_duplicate_source_text_enable": "跳过重复原文",
  "app.language.JA": "日文",
  "app.language.ZH": "中文",
  "app.toggle.enabled": "启用",
};

function t(key: LocaleKey): string {
  return TEXT_BY_KEY[key] ?? key;
}

describe("format_project_settings_aligned_toast", () => {
  it("只列出实际变动项目并使用多行格式", () => {
    const text = format_project_settings_aligned_toast({
      settings: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
      changed_fields: {
        source_language: true,
        target_language: true,
      },
      t,
    });

    expect(text).toBe("已按当前设置更新项目设置 …\n输入语言 - 日文\n输出语言 - 中文");
  });

  it("MTool 未变动时不会列出 MTool 行", () => {
    const text = format_project_settings_aligned_toast({
      settings: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
      changed_fields: {
        source_language: true,
      },
      t,
    });

    expect(text).not.toContain("MTool 优化器");
  });
});
