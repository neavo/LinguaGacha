import { describe, expect, it } from "vitest";

import {
  normalize_app_language,
  normalize_project_save_mode,
  resolve_app_locale,
} from "./settings";

describe("settings 基础模型", () => {
  it("规范化应用语言、locale 和项目保存模式", () => {
    expect(normalize_app_language("en")).toBe("EN");
    expect(normalize_app_language("bad")).toBe("ZH");
    expect(resolve_app_locale("EN")).toBe("en-US");
    expect(resolve_app_locale("ZH")).toBe("zh-CN");
    expect(normalize_project_save_mode("FIXED")).toBe("FIXED");
    expect(normalize_project_save_mode("bad")).toBe("MANUAL");
  });
});
