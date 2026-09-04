import { describe, expect, it } from "vitest";

import { read_json_record, type JsonRecord } from "../../../../../domain/json";
import { execute_workspace_tool } from "./test-support";

describe("ws.tool.deriveCommonLiteralRoots 数据工具", () => {
  it("按可见字符长度稳定枚举全部公共连续片段", async () => {
    const result = read_json_record(
      await execute_workspace_tool(
        "deriveCommonLiteralRoots",
        { forms: ["ドトール家", "ドトール伯爵", "ドトール領"] },
        {},
      ),
    );
    const candidates = result["candidates"] as JsonRecord[];

    expect(candidates).toContainEqual({ root: "ドトール", grapheme_length: 4 });
    expect(candidates).toContainEqual({ root: "トール", grapheme_length: 3 });
    expect(candidates.map((candidate) => candidate["grapheme_length"])).toEqual(
      candidates
        .map((candidate) => candidate["grapheme_length"])
        .toSorted((left, right) => Number(left) - Number(right)),
    );
  });

  it("以 NFKC、大小写和 grapheme 比较并保留首项写法", async () => {
    await expect(
      execute_workspace_tool("deriveCommonLiteralRoots", { forms: ["Ａe\u0301家", "aÉ領"] }, {}),
    ).resolves.toMatchObject({
      candidates: expect.arrayContaining([{ root: "Ａe\u0301", grapheme_length: 2 }]),
    });

    await expect(
      execute_workspace_tool("deriveCommonLiteralRoots", { forms: ["同じ", "同じ"] }, {}),
    ).rejects.toThrow();
  });
});
