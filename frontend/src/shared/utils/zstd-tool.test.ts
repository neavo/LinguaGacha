import { describe, expect, it } from "vitest";

import { ZstdTool } from "./zstd-tool";

describe("ZstdTool", () => {
  it("使用固定的 .lg asset 压缩等级", () => {
    expect(ZstdTool.COMPRESSION_LEVEL).toBe(3);
  });

  it("按统一参数压缩并解压 bytes", () => {
    const raw = Buffer.from("LinguaGacha zstd payload");
    const compressed = ZstdTool.compress(raw);

    expect(compressed.equals(raw)).toBe(false);
    expect(ZstdTool.decompress(compressed)).toEqual(raw);
  });
});
