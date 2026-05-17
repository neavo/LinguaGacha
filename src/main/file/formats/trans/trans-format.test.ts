import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../../base/item";
import { TRANSFormat } from "./trans-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-trans-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

function encode_trans(project: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ project }));
}

describe("TRANSFormat", () => {
  it.each([
    ["kag", "KAG"],
    ["vntrans", "KAG"],
    ["renpy", "RENPY"],
    ["wolf", "WOLF"],
    ["wolfrpg", "WOLF"],
    ["rmmz", "RPGMAKER"],
    ["unknown", "NONE"],
  ] as const)("按 gameEngine=%s 选择文本类型 %s", (gameEngine, expected_type) => {
    const [item] = new TRANSFormat().read_from_stream(
      encode_trans({
        gameEngine,
        files: {
          "file.json": {
            data: [["原文", ""]],
            tags: [[]],
            context: [[]],
            parameters: [[]],
          },
        },
      }),
      "demo.trans",
    );

    expect(item?.text_type).toBe(expected_type);
  });

  it("处理空源文、aqua 标签、已有译文和缺失译文列", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        gameEngine: "",
        files: {
          "file.json": {
            data: [["", ""], ["src", "src"], ["src", "dst"], ["src-only"]],
            tags: [[], ["aqua"], [], []],
            context: [["ctx"], ["ctx"], ["ctx"], ["ctx"]],
            parameters: [[], [], [], []],
          },
        },
      }),
      "demo.trans",
    );

    expect(items.map((item) => [item.src, item.dst, item.status])).toEqual([
      ["", "", "EXCLUDED"],
      ["src", "src", "NONE"],
      ["src", "dst", "PROCESSED"],
      ["src-only", "", "NONE"],
    ]);
    expect(items[1]?.extra_field).toEqual(expect.objectContaining({ tag: ["aqua"] }));
    expect(items[1]?.skip_internal_filter).toBe(true);
  });

  it("默认处理器按资源扩展名和颜色标签过滤", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        gameEngine: "",
        files: {
          "file.json": {
            data: [
              ["a.mp3", ""],
              ["hello", ""],
              ["hello", ""],
            ],
            tags: [[], ["red"], []],
            context: [["1", "2"], ["1"], ["1", "2"]],
            parameters: [[], [], []],
          },
        },
      }),
      "demo.trans",
    );

    expect(items.map((item) => item.status)).toEqual(["EXCLUDED", "EXCLUDED", "NONE"]);
  });

  it("过滤结果不混合时移除派生 gold，混合时补充 gold", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        gameEngine: "wolf",
        files: {
          "common/1.json": {
            data: [
              ["hello", ""],
              ["mixed", ""],
            ],
            tags: [["gold", "keep"], ["keep"]],
            context: [
              ["common/1.json/Message/stringArgs/0"],
              ["common/1.json/Message/stringArgs/0", "common/1.json/name"],
            ],
            parameters: [[], []],
          },
        },
      }),
      "wolf.trans",
    );

    expect(items[0]?.extra_field).toEqual(expect.objectContaining({ tag: ["keep"] }));
    expect(items[1]?.extra_field).toEqual(expect.objectContaining({ tag: ["keep", "gold"] }));
  });

  it("按 RPGMaker 地址黑名单和已有译文生成状态", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        indexOriginal: 0,
        indexTranslation: 1,
        gameEngine: "rmmz",
        files: {
          "data/Actors.json": {
            data: [
              ["ステラ", ""],
              ["ActorName", ""],
              ["Done", "已完成"],
            ],
            tags: [[], [], []],
            context: [["Actors/1/nickname"], ["MapInfos/1/name"], []],
            parameters: [[], [], []],
          },
        },
      }),
      "demo.trans",
    );

    expect(items.map((item) => [item.src, item.status, item.text_type])).toEqual([
      ["ステラ", "NONE", "RPGMAKER"],
      ["ActorName", "EXCLUDED", "RPGMAKER"],
      ["Done", "PROCESSED", "RPGMAKER"],
    ]);
  });

  it("RPGMaker 按资源扩展名、路径缓存、颜色标签和地址黑名单过滤", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        gameEngine: "rmmz",
        files: {
          "plugin.js": {
            data: [["hello", ""]],
            tags: [[]],
            context: [["ctx1"]],
            parameters: [[]],
          },
          "Map001.json": {
            data: [
              ["sound.mp3", ""],
              ["hello", ""],
              ["hello", ""],
              ["hello", ""],
            ],
            tags: [[], ["blue"], [], []],
            context: [["ctx1", "ctx2"], ["any"], ["MapInfos/1/name"], []],
            parameters: [[], [], [], []],
          },
        },
      }),
      "rpg.trans",
    );

    expect(items.map((item) => item.status)).toEqual([
      "EXCLUDED",
      "EXCLUDED",
      "EXCLUDED",
      "EXCLUDED",
      "NONE",
    ]);
  });

  it("WOLF 混合分区会派生 gold 标签并生成分区参数", () => {
    const [item] = new TRANSFormat().read_from_stream(
      encode_trans({
        indexOriginal: 0,
        indexTranslation: 1,
        gameEngine: "wolf",
        files: {
          "common/1.json": {
            data: [["共通文本", ""]],
            tags: [[]],
            context: [["common/1.json/commands/1/Database/stringArgs/0", "common/1.json/name"]],
            parameters: [[]],
          },
        },
      }),
      "wolf.trans",
    );

    expect(item).toEqual(
      expect.objectContaining({
        src: "共通文本",
        status: "NONE",
        text_type: "WOLF",
        extra_field: expect.objectContaining({ tag: ["gold"] }),
      }),
    );
  });

  it("WOLF 根据数据库非零 stringArgs 收集屏蔽文本", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        gameEngine: "wolf",
        files: {
          "a.json": {
            data: [
              ["block_me", ""],
              ["keep", ""],
              ["block_me", ""],
            ],
            tags: [[], [], []],
            context: [
              ["common/110.json/commands/29/Database/stringArgs/1"],
              ["common/110.json/commands/29/Database/stringArgs/0"],
              ["DataBase.json/types/1/data/2/data/3/value"],
            ],
            parameters: [[], [], []],
          },
        },
      }),
      "wolf.trans",
    );

    expect(items.map((item) => [item.src, item.status])).toEqual([
      ["block_me", "EXCLUDED"],
      ["keep", "NONE"],
      ["block_me", "EXCLUDED"],
    ]);
  });

  it("WOLF 应用白名单、黑名单、common 规则和空 context 颜色规则", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        gameEngine: "wolf",
        files: {
          path: {
            data: [
              ["hello", ""],
              ["hello", ""],
              ["hello", ""],
              ["plain_text", ""],
              ["sound.mp3", ""],
              ["hello", ""],
              ["hello", ""],
            ],
            tags: [[], [], [], [], [], ["red"], []],
            context: [
              ["common/1.json/Message/stringArgs/0"],
              ["common/1.json/name"],
              ["common/1.json/anything"],
              ["map/001.json/events/3/message"],
              ["a", "b", "c"],
              ["x/y"],
              [],
            ],
            parameters: [[], [], [], [], [], [], []],
          },
        },
      }),
      "wolf.trans",
    );

    expect(items.map((item) => item.status)).toEqual([
      "NONE",
      "EXCLUDED",
      "EXCLUDED",
      "NONE",
      "EXCLUDED",
      "EXCLUDED",
      "NONE",
    ]);
  });

  it("写回时通过 trans_ref 最小补丁更新 PROCESSED 译文列", async () => {
    const original = {
      project: {
        indexOriginal: 0,
        indexTranslation: 1,
        gameEngine: "",
        files: {
          "/demo.map": {
            data: [["原文", ""]],
            tags: [[]],
            context: [[]],
            parameters: [[]],
          },
        },
      },
    };

    await new TRANSFormat().write_to_path(
      [
        Item.from_json({
          src: "原文",
          dst: "译文",
          tag: "/demo.map",
          row: 0,
          file_type: "TRANS",
          file_path: "demo.trans",
          status: "PROCESSED",
          extra_field: { trans_ref: { file_key: "/demo.map", row_index: 0 } },
        }),
      ],
      { translated_path: temp_dir, bilingual_path: path.join(temp_dir, "bilingual") },
      () => Buffer.from(JSON.stringify(original)),
    );

    const written = JSON.parse(fs.readFileSync(path.join(temp_dir, "demo.trans"), "utf-8"));
    expect(written.project.files["/demo.map"].data[0]).toEqual(["原文", "译文"]);
  });

  it("写回混合分区时生成参数但不污染 span schema", async () => {
    const original = {
      project: {
        gameEngine: "wolf",
        files: {
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
        },
      },
    };

    await new TRANSFormat().write_to_path(
      [
        Item.from_json({
          src: "混合",
          dst: "译文",
          tag: "common/1.json",
          row: 0,
          file_type: "TRANS",
          file_path: "wolf.trans",
          status: "PROCESSED",
          extra_field: { trans_ref: { file_key: "common/1.json", row_index: 0 } },
        }),
        Item.from_json({
          src: "span",
          dst: "译文",
          tag: "common/1.json",
          row: 1,
          file_type: "TRANS",
          file_path: "wolf.trans",
          status: "PROCESSED",
          extra_field: { trans_ref: { file_key: "common/1.json", row_index: 1 } },
        }),
      ],
      { translated_path: temp_dir, bilingual_path: path.join(temp_dir, "bilingual") },
      () => Buffer.from(JSON.stringify(original)),
    );

    const written = JSON.parse(fs.readFileSync(path.join(temp_dir, "wolf.trans"), "utf-8"));
    expect(written.project.files["common/1.json"].tags[0]).toEqual(["gold"]);
    expect(written.project.files["common/1.json"].parameters[0]).toEqual([
      { contextStr: "common/1.json/Message/stringArgs/0", translation: "" },
      { contextStr: "common/1.json/name", translation: "混合" },
    ]);
    expect(written.project.files["common/1.json"].parameters[1]).toEqual([{ start: 1, end: 2 }]);
  });

  it("缺失资产时跳过写回", async () => {
    await new TRANSFormat().write_to_path(
      [
        Item.from_json({
          src: "原文",
          dst: "译文",
          tag: "/demo.map",
          row: 0,
          file_type: "TRANS",
          file_path: "missing.trans",
          status: "PROCESSED",
        }),
      ],
      { translated_path: temp_dir, bilingual_path: path.join(temp_dir, "bilingual") },
      () => null,
    );

    expect(fs.existsSync(path.join(temp_dir, "missing.trans"))).toBe(false);
  });

  it("缺失 trans_ref 时拒绝写回", async () => {
    const original = {
      project: {
        gameEngine: "",
        files: {
          "/demo.map": {
            data: [["原文", ""]],
            tags: [[]],
            context: [[]],
            parameters: [[]],
          },
        },
      },
    };

    await expect(
      new TRANSFormat().write_to_path(
        [
          Item.from_json({
            src: "原文",
            dst: "译文",
            tag: "/demo.map",
            row: 0,
            file_type: "TRANS",
            file_path: "demo.trans",
            status: "PROCESSED",
          }),
        ],
        { translated_path: temp_dir, bilingual_path: path.join(temp_dir, "bilingual") },
        () => Buffer.from(JSON.stringify(original)),
      ),
    ).rejects.toMatchObject({
      code: "file.invalid_structure",
      public_details: { format: "TRANS" },
    });
    expect(fs.existsSync(path.join(temp_dir, "demo.trans"))).toBe(false);
  });
});
