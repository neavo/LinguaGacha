import { GameFormat } from "../game/format";
import { NativeFs } from "../../../native/native-fs";
import JSZip from "jszip";
import { create_item } from "../../../domain/item";
import { expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import {
  ruby_array as a,
  ruby_object as o,
  ruby_string as s,
  ruby_integer as n,
} from "../../../test/rgss-fixture";
import { create_pdf_execution } from "../pdf/test-support";
import { FileFormatService } from "../file-format-service";
import { decode, encode, field } from "./marshal";
import { array, text, bytes } from "./value";
import * as source from "./source";
import { create_rpgmaker_rgss_adapter } from "./rpgmaker-format";

it.each([
  ["xp", ".rxdata"],
  ["vx", ".rvdata"],
  ["ace", ".rvdata2"],
])("%s 从真实目录导入，删除来源后从原稿重建并导出", async (_version, extension) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-"));
  const source = path.join(temp.path, "game"),
    data = path.join(source, "Data");
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(source, "Custom"));
  const actors = encode(
    a([{ t: "0" }, o("RPG::Actor", { "@name": s("hero"), "@character_name": s("resource") })]),
  );
  const title = "吸血鬼ノート";
  const ini = Buffer.from(
    "[Game]\r\nTitle=" + title + "\r\nScripts=Custom\\Main" + extension + "\r\n",
  );
  fs.writeFileSync(path.join(source, "Game.ini"), ini);
  fs.writeFileSync(path.join(source, "Game.exe"), "");
  fs.writeFileSync(
    path.join(source, "Custom/Main" + extension),
    encode(
      a([a([n(1), s("Vocab"), { t: '"', data: deflateSync(Buffer.from('puts "menu", "keep"')) }])]),
    ),
  );
  fs.writeFileSync(
    path.join(data, "System" + extension),
    encode(o("RPG::System", { "@game_title": s(title), "@currency_unit": s("ゴールド") })),
  );
  fs.writeFileSync(path.join(data, "Actors" + extension), actors);
  fs.writeFileSync(path.join(data, "Broken" + extension), "broken");
  const service = new FileFormatService({ target_language: "ZH" }, create_pdf_execution());
  const entries = await service.collect_source_file_entries([
    source,
    path.join(source, "Game.exe"),
    path.join(source, "Game.ini"),
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.file_type).toBe("RPGMAKER_RGSS");
  expect((await service.summarize_source_files([source])).format_hit_counts.rpgmaker_rgss).toBe(1);
  const prepared = await service.prepare_source(
    (await service.discover_import_sources([{ source_path: source, rel_path: "game.zip" }]))[0]!,
  );
  expect(prepared.warnings).toEqual([]);
  fs.rmSync(source, { recursive: true });
  const result = await service.parse_asset("game.zip", prepared.content, "RPGMAKER_RGSS");
  if (result.kind !== "items") throw Error("Expected items");
  expect(result.warnings).toMatchObject([
    { code: "internal_file_parse_failed", internal_file_path: "Data/Broken" + extension },
  ]);
  expect(result.items.map((item) => item.status)).toEqual(
    result.items.map(FileFormatService.default_status),
  );
  expect(result.items.map((item) => [item.src, FileFormatService.default_status(item)])).toEqual([
    ["hero", "NONE"],
    ["resource", "RULE_SKIPPED"],
    [title, "RULE_SKIPPED"],
    ["ゴールド", "NONE"],
    ["menu", "RULE_SKIPPED"],
    ["keep", "RULE_SKIPPED"],
  ]);
  const title_item = result.items.find((item) => item.src === title)!;
  expect(title_item.extra_field).toMatchObject({ rpgmaker_rgss: { usage: "metadata" } });
  title_item.dst = "吸血鬼笔记";
  const currency = result.items.find((item) => item.src === "ゴールド")!;
  currency.dst = "金币";
  currency.status = "PROCESSED";
  const menu = result.items.find((item) => item.src === "menu")!;
  menu.dst = "菜单";
  menu.status = "PROCESSED";
  const keep = result.items.find((item) => item.src === "keep")!;
  keep.dst = "不应写入";
  const item = result.items.find((item) => item.src === "hero")!;
  item.dst = "英雄";
  item.status = "PROCESSED";
  const output = path.join(temp.path, "output");
  await service.write_items(result.items, {
    source_files: [{ path: "game.zip", file_type: "RPGMAKER_RGSS" }],
    asset_reader: () => Buffer.from(prepared.content),
    paths: { translated_path: output, bilingual_path: path.join(temp.path, "bilingual") },
  });
  const changed = decode(fs.readFileSync(path.join(output, "game/Data/Actors" + extension)));
  expect(text(field(array(changed)[1]!, "@name")!)).toBe("英雄");
  const system = decode(fs.readFileSync(path.join(output, "game/Data/System" + extension)));
  expect(text(field(system, "@game_title")!)).toBe(title);
  expect(text(field(system, "@currency_unit")!)).toBe("金币");
  expect(fs.readFileSync(path.join(output, "game/Game.ini"))).toEqual(ini);
  expect(fs.readFileSync(path.join(output, "game/Data/Broken" + extension), "utf8")).toBe("broken");
  const archive = decode(fs.readFileSync(path.join(output, "game/Custom/Main" + extension)));
  expect(inflateSync(bytes(array(array(archive)[0]!)[2]!)).toString()).toBe('puts "菜单", "keep"');
  const unchanged = path.join(temp.path, "unchanged");
  await new GameFormat(create_rpgmaker_rgss_adapter(), new NativeFs()).write_to_path([], {
    source_files: [{ path: "game.zip", file_type: "RPGMAKER_RGSS" }],
    asset_reader: () => Buffer.from(prepared.content),
    paths: { translated_path: unchanged, bilingual_path: unchanged },
  });
  expect(fs.readFileSync(path.join(unchanged, "game/Data/Actors" + extension))).toEqual(actors);
});

it.each([false, true])(
  "容器身份只解析一次，失败=%s 时保留成员诊断与未修改原稿",
  async (invalid) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-context-"));
    const zip = new JSZip();
    zip.file(
      "Game.ini",
      invalid ? "[Game]\nScripts=wrong.rxdata" : "[Game]\nScripts=Data/Scripts.rvdata2",
    );
    const original = encode(o("RPG::System", { "@currency_unit": s("gold") }));
    for (const name of ["System", "Map001", "Scripts"]) zip.file(`Data/${name}.rvdata2`, original);
    const content = await zip.generateAsync({ type: "uint8array" });
    const read = vi.spyOn(source, "read_rgss_game");
    try {
      const format = new GameFormat(create_rpgmaker_rgss_adapter(), new NativeFs());
      const parsed = await format.read_from_stream(content, "game.zip");
      expect(read).toHaveBeenCalledTimes(1);
      if (invalid) {
        expect(parsed.items).toEqual([]);
        expect(parsed.warnings.map((warning) => warning.internal_file_path)).toEqual([
          "Data/System.rvdata2",
          "Data/Map001.rvdata2",
          "Data/Scripts.rvdata2",
        ]);
      }
      const context = {
        source_files: [{ path: "game.zip", file_type: "RPGMAKER_RGSS" }],
        asset_reader: () => Buffer.from(content),
        paths: { translated_path: temp.path, bilingual_path: temp.path },
      };
      read.mockClear();
      await format.write_to_path([], context);
      expect(read).not.toHaveBeenCalled();
      expect(fs.readFileSync(path.join(temp.path, "game/Data/System.rvdata2"))).toEqual(original);
      if (invalid) {
        const valid = new JSZip();
        valid.file("Game.ini", "[Game]\nScripts=Data/Scripts.rvdata2");
        valid.file("Data/System.rvdata2", original);
        const result = await format.read_from_stream(
          await valid.generateAsync({ type: "uint8array" }),
          "game.zip",
        );
        read.mockClear();
        await expect(
          format.write_to_path(
            result.items.map((item) => create_item({ ...item, dst: "金币", status: "PROCESSED" })),
            context,
          ),
        ).rejects.toMatchObject({ code: "file.invalid_structure" });
        expect(read).toHaveBeenCalledTimes(1);
      } else {
        await format.write_to_path(
          parsed.items.map((item) => create_item({ ...item, dst: "金币", status: "PROCESSED" })),
          context,
        );
        expect(read).toHaveBeenCalledTimes(1);
        // 同一格式实例下一次操作须重新识别容器。
        await format.read_from_stream(content, "another.zip");
        expect(read).toHaveBeenCalledTimes(2);
      }
    } finally {
      read.mockRestore();
    }
  },
);
