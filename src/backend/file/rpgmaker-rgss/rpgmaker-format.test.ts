import { expect, it } from "vitest";
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
import { RPGMakerRGSSFormat } from "./rpgmaker-format";

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
  const entries = service.collect_source_file_entries([
    source,
    path.join(source, "Game.exe"),
    path.join(source, "Game.ini"),
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.file_type).toBe("RPGMAKER_RGSS");
  expect(service.summarize_source_files([source]).format_hit_counts.rpgmaker_rgss).toBe(1);
  const prepared = await service.prepare_source(source, "game.zip", "RPGMAKER_RGSS");
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
  expect(title_item.status).toBe("RULE_SKIPPED");
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
  await new RPGMakerRGSSFormat().write_to_path([], {
    source_files: [{ path: "game.zip", file_type: "RPGMAKER_RGSS" }],
    asset_reader: () => Buffer.from(prepared.content),
    paths: { translated_path: unchanged, bilingual_path: unchanged },
  });
  expect(fs.readFileSync(path.join(unchanged, "game/Data/Actors" + extension))).toEqual(actors);
});
