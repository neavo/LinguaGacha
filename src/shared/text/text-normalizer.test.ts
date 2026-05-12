import { describe, expect, it } from "vitest";

import { normalize_text_for_processing } from "./text-normalizer";

describe("normalize_text_for_processing", () => {
  it("将全角英数字转换为半角", () => {
    expect(normalize_text_for_processing("ＡＢＣ１２３")).toBe("ABC123");
  });

  it("将半角片假名转换为全角片假名", () => {
    expect(normalize_text_for_processing("ｱｲｳ")).toBe("アイウ");
  });

  it("先执行 NFC 正规化再应用自定义映射", () => {
    expect(normalize_text_for_processing("Cafe\u0301")).toBe("Café");
  });
});
