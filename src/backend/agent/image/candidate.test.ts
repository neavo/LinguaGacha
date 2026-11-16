import { expect, it } from "vitest";
import type { ErasePageResult } from "./state";
import { parse_candidate_decisions } from "./candidate";

/** 使用同一已知区域区分材料失败与模型选择失败。 */
const page = (status: ErasePageResult["status"]): ErasePageResult => ({
  pageId: "page",
  inputSha256: "a".repeat(64),
  status,
  materials: [],
  regions: [
    {
      regionId: "region",
      diagnostics: [],
      candidates: [],
    },
  ],
});

it("材料失败直接终结已知区域，不伪装成模型协议错误", () => {
  const result = parse_candidate_decisions([page("failed")], new Map());
  expect(result.decisions[0]!.regions).toEqual([{ regionId: "region", value: "failed" }]);
  expect(result.protocolErrors).toEqual([]);
});
