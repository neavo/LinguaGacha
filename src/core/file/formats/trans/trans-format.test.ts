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

  it("按索引、行号和同位扩展字段读取 TRANS 条目", () => {
    const items = new TRANSFormat().read_from_stream(
      encode_trans({
        indexOriginal: 1,
        indexTranslation: 2,
        gameEngine: "",
        files: {
          "file.json": {
            data: [["id-1", "原文", "译文"]],
            tags: [["keep"]],
            context: [["ctx"]],
            parameters: [[{ note: "meta" }]],
          },
        },
      }),
      "demo.trans",
    );

    expect(items[0]).toMatchObject({
      src: "原文",
      dst: "译文",
      tag: "file.json",
      row: 0,
      file_type: "TRANS",
      file_path: "demo.trans",
      text_type: "NONE",
      status: "PROCESSED",
      extra_field: {
        tag: ["keep"],
        context: ["ctx"],
        parameter: [{ note: "meta" }],
        trans_ref: { file_key: "file.json", row_index: 0 },
      },
    });
  });

  it("写回可读取资产时输出转换后的 TRANS JSON", async () => {
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
});
