import { beforeEach, describe, expect, it, vi } from "vitest";

const api_fetch_mock = vi.hoisted(() => vi.fn());

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

import { read_ts_conversion_query } from "./ts-conversion-query";

describe("ts-conversion-query", () => {
  beforeEach(() => {
    api_fetch_mock.mockReset();
  });

  it("读取简繁转换需要的后端 query view", async () => {
    const response = {
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 2, quality: 4 },
      items: [{ item_id: 1, src: "魔法", dst: "魔法" }],
      textPreserve: { mode: "custom", entries: [] },
    };
    api_fetch_mock.mockResolvedValue(response);

    await expect(read_ts_conversion_query()).resolves.toBe(response);
    expect(api_fetch_mock).toHaveBeenCalledWith("/api/project/query/ts-conversion", {});
  });
});
