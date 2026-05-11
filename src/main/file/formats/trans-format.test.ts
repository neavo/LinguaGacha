import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalize_file_item } from "../file-item";
import { TRANSFormat } from "./trans-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-trans-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("TRANSFormat", () => {
  it("按 RPGMaker 地址黑名单和已有译文生成状态", () => {
    const format = new TRANSFormat();
    const content = JSON.stringify({
      project: {
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
      },
    });

    const items = format.read_from_stream(new TextEncoder().encode(content), "demo.trans");

    expect(items.map((item) => [item.src, item.status, item.text_type])).toEqual([
      ["ステラ", "NONE", "RPGMAKER"],
      ["ActorName", "EXCLUDED", "RPGMAKER"],
      ["Done", "PROCESSED", "RPGMAKER"],
    ]);
  });

  it("WOLF 混合分区会派生 gold 标签并生成分区参数", () => {
    const format = new TRANSFormat();
    const content = JSON.stringify({
      project: {
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
      },
    });

    const [item] = format.read_from_stream(new TextEncoder().encode(content), "wolf.trans");

    expect(item).toEqual(
      expect.objectContaining({
        src: "共通文本",
        status: "NONE",
        text_type: "WOLF",
        extra_field: expect.objectContaining({ tag: ["gold"] }),
      }),
    );
  });

  it("写回时通过 trans_ref 最小补丁更新 PROCESSED 译文列", async () => {
    const format = new TRANSFormat();
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

    await format.write_to_path(
      [
        normalize_file_item({
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
});
