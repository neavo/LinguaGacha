import { describe, expect, it } from "vitest";

import { QualityCache } from "./quality-cache";

describe("QualityCache", () => {
  it("返回质量块克隆并保留质量检查占位形状", () => {
    const cache = new QualityCache();
    cache.replace({ glossary: { entries: [{ src: "HP" }] } });
    const block = cache.readBlock();
    block["glossary"] = {};

    expect(cache.readBlock()).toEqual({ glossary: { entries: [{ src: "HP" }] } });
    expect(cache.readQualityCheck(7)).toEqual({
      item_id: 7,
      warnings: [],
      warning_fragments_by_code: {},
    });
  });
});
