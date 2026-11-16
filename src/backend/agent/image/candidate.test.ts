import { expect, it } from "vitest";
import type { ErasePageResult } from "./state";
import { read_candidate_decisions } from "./candidate";

const pages: ErasePageResult[] = [
  {
    pageId: "page",
    inputSha256: "a".repeat(64),
    materials: [],
    regions: [
      {
        regionId: "first",
        diagnostics: [],
        candidates: [
          {
            candidateId: "A",
            method: "fill",
            box: [0, 0, 1, 1],
            crop: "first.png",
            cropSha256: "b".repeat(64),
            mask: "first-mask.png",
            maskSha256: "c".repeat(64),
          },
        ],
      },
      { regionId: "second", diagnostics: [], candidates: [] },
    ],
  },
  { pageId: "preserved", inputSha256: "d".repeat(64), materials: [], regions: [] },
];

it("按运行顺序归一完整的产品 Agent 候选决定", () => {
  expect(
    read_candidate_decisions(pages, [
      {
        pageId: "page",
        regions: [
          { regionId: "second", value: "failed" },
          { regionId: "first", value: "A" },
        ],
      },
    ]),
  ).toEqual([
    {
      pageId: "page",
      regions: [
        { regionId: "first", value: "A" },
        { regionId: "second", value: "failed" },
      ],
    },
    { pageId: "preserved", regions: [] },
  ]);
});

it("拒绝缺失与重复的候选决定", () => {
  expect(() => read_candidate_decisions(pages, [])).toThrow("Missing page decision");
  expect(() =>
    read_candidate_decisions(pages, [
      {
        pageId: "page",
        regions: [
          { regionId: "first", value: "A" },
          { regionId: "first", value: "A" },
        ],
      },
    ]),
  ).toThrow("duplicate region decision");
});
