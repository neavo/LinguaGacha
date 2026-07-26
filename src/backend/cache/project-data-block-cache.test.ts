import { describe, expect, it, vi } from "vitest";

import { ProjectDataBlockCache } from "./project-data-block-cache";

describe("ProjectDataBlockCache", () => {
  it("替换、读取和清理隔离顶层对象", () => {
    const before_read = vi.fn();
    const cache = new ProjectDataBlockCache(before_read);
    const block = { entries: [{ src: "a" }] };

    cache.replace(block);
    block.entries = [];
    const snapshot = cache.readBlock();
    snapshot["changed"] = true;

    expect(before_read).toHaveBeenCalledTimes(1);
    expect(cache.readBlock()).toEqual({ entries: [{ src: "a" }] });
    cache.clear();
    expect(cache.readBlock()).toEqual({});
  });
});
