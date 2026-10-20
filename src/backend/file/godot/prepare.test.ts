import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import {
  create_godot_fixture,
  godot_pack_fixture,
  build_resource,
} from "../../../test/godot-fixture";
import { discover_godot_source } from "./source";
import { prepare_game_source } from "../shared/game/engines";
import { read_resource } from "./resource";
import { u32 } from "./binary";
import { FileFormatService } from "../file-format-service";
import { create_pdf_execution } from "../pdf/test-support";
import { read_godot_metadata } from "./item";
import { read_translation } from "./translation";
import { read_game_container } from "../shared/game/format";

it.each(["external", "embedded"])("%s 载体准备、字体回退、重复导入与原载体备份", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-prepare-"));
  const native = new NativeFs(),
    files = create_godot_fixture();
  files.set(
    ".godot/imported/font.fontdata",
    build_resource(
      "FontFile",
      new Map([["allow_system_fallback", Buffer.concat([u32(2), u32(0)])]]),
    ),
  );
  const prefix = Buffer.alloc(256, 42),
    bytes = godot_pack_fixture(files, { prefix: kind === "embedded" ? prefix : undefined });
  const carrier = path.join(temp.path, kind === "embedded" ? "game.exe" : "game.pck");
  fs.writeFileSync(carrier, bytes);
  if (kind === "external") fs.writeFileSync(path.join(temp.path, "game.exe"), prefix);
  const game = (await discover_godot_source(carrier, native))!;
  expect(game.carrier?.kind).toBe(kind === "embedded" ? "embedded" : "pck");
  const copy = vi.spyOn(native, "copy_file");
  await prepare_game_source({ kind: "game", file_type: "GODOT", game }, native);
  expect(copy).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(temp.path, "backup_lg", path.basename(carrier)))).toEqual(bytes);
  expect(fs.readFileSync(path.join(temp.path, "game.exe"))).toEqual(prefix);
  expect(fs.existsSync(path.join(temp.path, "game.pck"))).toBe(false);
  expect(
    read_resource(fs.readFileSync(path.join(temp.path, ".godot/imported/font.fontdata")))
      .properties[0]!.value.value,
  ).toBe(true);
  const loose = (await discover_godot_source(temp.path, native))!;
  expect(loose.carrier).toBeNull();
  const create = vi.spyOn(native, "make_dir_exclusive");
  await prepare_game_source({ kind: "game", file_type: "GODOT", game: loose }, native);
  expect(create).not.toHaveBeenCalled();
});

it("产品门面完成来源摘要、准备、容器、翻译与导出，原稿字节与备份各有归属", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-product-"));
  const root = path.join(temp.path, "game"),
    native = new NativeFs(),
    files = create_godot_fixture();
  native.write_file_sync(path.join(root, "game.pck"), godot_pack_fixture(files));
  const service = new FileFormatService({ target_language: "ZH" }, create_pdf_execution(), native);
  expect(await service.summarize_source_files([root])).toMatchObject({
    source_file_count: 1,
    format_hit_counts: { godot: 1 },
  });
  const entry = (await service.collect_source_file_entries([root]))[0]!;
  const container = await service.prepare_source(entry);
  expect(
    [...(await read_game_container(container.content, entry.rel_path)).members.keys()].every(
      (name) => !name.endsWith(".fontdata"),
    ),
  ).toBe(true);
  const parsed = await service.parse_asset(entry.rel_path, container.content, entry.file_type);
  if (parsed.kind !== "items") throw new Error("Expected game items");
  expect(parsed.warnings).toEqual([]);
  expect(
    parsed.items.some((item) => FileFormatService.default_status(item) === "RULE_SKIPPED"),
  ).toBe(true);
  const item = parsed.items.find(
    (item) => read_godot_metadata(item.extra_field).internal_file_path === "messages.translation",
  )!;
  const out = path.join(temp.path, "translated");
  await service.write_items([{ ...item, status: "PROCESSED", dst: "产品译文" }], {
    paths: { translated_path: out, bilingual_path: path.join(temp.path, "bilingual") },
    source_files: [{ path: entry.rel_path, file_type: "GODOT" }],
    asset_reader: () => Buffer.from(container.content),
  });
  const output = path.join(out, path.basename(entry.rel_path, ".zip"), "messages.translation");
  expect(
    read_translation(fs.readFileSync(output)).slots.some((slot) => slot.text === "产品译文"),
  ).toBe(true);
  expect(fs.readFileSync(path.join(root, "backup_lg/messages.translation"))).toEqual(
    files.get("messages.translation"),
  );
});
