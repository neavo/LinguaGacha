import { describe, expect, it } from "vitest";

import type { MutableJsonRecord } from "../../../domain/json";
import { create_item } from "../../../domain/item";
import { RPGMakerTransProcessor } from "./rpgmaker-processor";
import { WolfTransProcessor } from "./wolf-processor";
import { collect_patch_targets, patch_trans_row, type PatchTarget } from "./trans-patch-writer";

describe("collect_patch_targets", () => {
  it("拒绝缺失 trans_ref 的条目，避免猜测写回位置", () => {
    const item = create_item({
      extra_field: {},
    });

    expect(() => collect_patch_targets([item], { "/demo.map": { data: [["原文", ""]] } })).toThrow(
      expect.objectContaining({ code: "file.invalid_structure" }),
    );
  });
});

describe("patch_trans_row", () => {
  it("按 trans_ref 最小补丁更新 PROCESSED 译文列", () => {
    const files: MutableJsonRecord = {
      "/demo.map": {
        data: [["原文", ""]],
        tags: [[]],
        context: [[]],
        parameters: [[]],
      },
    };
    const target = create_target({
      item: create_item({
        src: "原文",
        dst: "译文",
        status: "PROCESSED",
      }),
    });

    patch_trans_row(files, target, new WolfTransProcessor({}), 1);

    expect(files["/demo.map"]).toMatchObject({
      data: [["原文", "译文"]],
    });
  });

  it("混合分区生成参数但不污染 span schema", () => {
    const files: MutableJsonRecord = {
      "common/1.json": {
        data: [
          ["混合", ""],
          ["span", ""],
        ],
        tags: [[], []],
        context: [
          ["common/1.json/Message/stringArgs/0", "common/1.json/name"],
          ["common/1.json/Message/stringArgs/0", "common/1.json/name"],
        ],
        parameters: [[], [{ start: 1, end: 2 }]],
      },
    };
    const processor = new WolfTransProcessor({});

    patch_trans_row(
      files,
      create_target({
        file_key: "common/1.json",
        row_index: 0,
        item: create_item({
          src: "混合",
          dst: "译文",
          status: "PROCESSED",
        }),
      }),
      processor,
      1,
    );
    patch_trans_row(
      files,
      create_target({
        file_key: "common/1.json",
        row_index: 1,
        item: create_item({
          src: "span",
          dst: "译文",
          status: "PROCESSED",
        }),
      }),
      processor,
      1,
    );

    expect(files["common/1.json"]).toMatchObject({
      tags: [["gold"], ["gold"]],
      parameters: [
        [
          { contextStr: "common/1.json/Message/stringArgs/0", translation: "" },
          { contextStr: "common/1.json/name", translation: "混合" },
        ],
        [{ start: 1, end: 2 }],
      ],
    });
  });

  it("全过滤行补充 gold 但不生成分区参数", () => {
    const files: MutableJsonRecord = {
      "data/CommonEvents.json": {
        data: [["ShowMessage", ""]],
        tags: [[]],
        context: [["CommonEvents/1/list/0/MZ Plugin Command/command"]],
        parameters: [[]],
      },
    };

    patch_trans_row(
      files,
      create_target({
        file_key: "data/CommonEvents.json",
        item: create_item({
          src: "ShowMessage",
          status: "EXCLUDED",
        }),
      }),
      new RPGMakerTransProcessor({}),
      1,
    );

    expect(files["data/CommonEvents.json"]).toMatchObject({
      tags: [["gold"]],
      parameters: [[]],
    });
  });
});

/** 写回测试直接提供已校验的目标，定位校验由 `collect_patch_targets` 用例负责。 */
function create_target(overrides: Partial<PatchTarget> = {}): PatchTarget {
  return {
    item: create_item({ src: "原文" }),
    file_key: "/demo.map",
    row_index: 0,
    ...overrides,
  };
}
