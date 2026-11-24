import { expect, it } from "vitest";

import { create_text_resolver } from "@shared/i18n";
import { format_project_settings_saved_toast } from "./project-settings-feedback";

it("反馈列出已保存的语言和开关，包括禁用状态", () => {
  const t = create_text_resolver("zh-CN");
  const result = format_project_settings_saved_toast(
    { source_language: "EN", mtool_optimizer_enable: false },
    t,
  );

  expect(result).toContain(t("app.language.EN"));
  expect(result).toContain(t("app.state.disabled"));
  expect(result).not.toContain(t("app.language_role.target"));
});
