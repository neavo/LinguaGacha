import { describe, expect, it } from "vitest";

import { LANGUAGE_DISPLAY_NAMES } from "../../../../domain/language";
import { zh_cn_app } from "./app";

describe("zh_cn_app", () => {
  it("中文主资源包含所有语言显示名", () => {
    expect(Object.keys(zh_cn_app.language).sort()).toEqual(
      Object.keys(LANGUAGE_DISPLAY_NAMES).sort(),
    );
  });
});
