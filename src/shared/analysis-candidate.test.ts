import { describe, expect, it } from "vitest";

import {
  build_analysis_glossary_entries_from_candidates,
  collect_analysis_candidate_srcs_from_aggregate,
  count_analysis_glossary_candidates,
} from "./analysis-candidate";

describe("analysis candidate helpers", () => {
  it("按共享口径生成可导出术语并排除无效候选", () => {
    const candidates = {
      艾琳: {
        src: "艾琳",
        dst_votes: { Erin: 2 },
        info_votes: { 角色名: 1 },
        case_sensitive: true,
      },
      无效自映射: {
        src: "无效自映射",
        dst_votes: { 无效自映射: 1 },
        info_votes: { 术语: 1 },
      },
      其它类型: {
        src: "其它类型",
        dst_votes: { Other: 1 },
        info_votes: { 其他: 1 },
      },
      "\\n[1]": {
        src: "\\n[1]",
        dst_votes: { "\\n[1]": 1 },
        info_votes: { 控制码: 1 },
      },
    };

    expect(build_analysis_glossary_entries_from_candidates(candidates)).toEqual([
      {
        src: "\\n[1]",
        dst: "\\n[1]",
        info: "控制码",
        regex: false,
        case_sensitive: false,
      },
      {
        src: "艾琳",
        dst: "Erin",
        info: "角色名",
        regex: false,
        case_sensitive: true,
      },
    ]);
    expect(count_analysis_glossary_candidates(Object.values(candidates))).toBe(2);
  });

  it("候选池消费列表覆盖本轮有译文票数的候选原文", () => {
    expect(
      collect_analysis_candidate_srcs_from_aggregate({
        艾琳: {
          src: " 艾琳 ",
          dst_votes: { Erin: 1 },
          info_votes: { 角色名: 1 },
        },
        王: {
          src: "王",
          dst_votes: { King: 1 },
          info_votes: { 其他: 1 },
        },
        空译文: {
          src: "空译文",
          dst_votes: {},
        },
      }),
    ).toEqual(["艾琳", "王"]);
  });
});
