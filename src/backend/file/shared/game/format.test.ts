import { read_zip_fixture, zip_text, write_zip } from "../../../../test/zip-fixture";
import JSZip from "jszip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { create_rpgmaker_mv_mz_adapter } from "../../rpgmaker-mv-mz/rpgmaker-format";
import { GameFormat, read_game_container } from "./format";

it("游戏 拒绝没有原稿文件的容器", async () => {
  const zip = new JSZip().folder("data")!;
  await expect(
    read_game_container(await zip.generateAsync({ type: "uint8array" }), "game.zip"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});

it("容器只固化调用方提供的数据字节，字体保留在游戏文件清单", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-container-"));
  const native = new NativeFs();
  const format = new GameFormat(create_rpgmaker_mv_mz_adapter({ target_language: "ZH" }), native);
  native.write_file_sync(path.join(temp.path, "fonts/main.ttf"), "font");
  const data = new Map([["data/System.json", Buffer.from("original")]]);
  native.write_file_sync(path.join(temp.path, "data/System.json"), "changed on disk");
  const prepared = await format.create_container(data, "game.zip", temp.path);
  const { members, game_files } = await read_game_container(prepared.content, "game.zip");
  expect([...members.keys()]).toEqual(["data/System.json"]);
  expect(
    (await members.get("data/System.json")!.async("nodebuffer")).equals(
      data.get("data/System.json")!,
    ),
  ).toBe(true);
  expect(await game_files!.async("string")).toContain("fonts/main.ttf");
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
});

it("游戏 解析通过共享容器入口拒绝越界成员", async () => {
  const format = new GameFormat(
    create_rpgmaker_mv_mz_adapter({ target_language: "ZH" }),
    new NativeFs(),
  );
  const bytes = await write_zip(new Map([["../outside.json", "{}"]]));
  await expect(format.read_from_stream(bytes, "game.zip")).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
});

it("解析失败保留原始字节，零条目导出仍包含该文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-errors-"));
  fs.mkdirSync(path.join(temp.path, "data"));
  fs.mkdirSync(path.join(temp.path, "js"));
  fs.writeFileSync(path.join(temp.path, "data/System.json"), "{}");
  fs.writeFileSync(path.join(temp.path, "data/Broken.json"), "{");
  fs.mkdirSync(path.join(temp.path, "img/pictures"), { recursive: true });
  fs.writeFileSync(path.join(temp.path, "img/pictures/Actor1.png"), "");
  const native = new NativeFs();
  const service = new GameFormat(create_rpgmaker_mv_mz_adapter({ target_language: "ZH" }), native);
  const files = new Map(
    ["data/Broken.json", "data/System.json"].map((name) => [
      name,
      native.read_file(path.join(temp.path, name)),
    ]),
  );
  const prepared = await service.create_container(files, "game.zip", temp.path);
  const parsed = await service.read_from_stream(prepared.content, "game.zip");
  expect(parsed.items).toEqual([]);
  expect([...prepared.warnings, ...parsed.warnings]).toMatchObject([
    { code: "internal_file_parse_failed", internal_file_path: "data/Broken.json" },
  ]);
  expect(Buffer.from(prepared.content).readUInt16LE(8)).toBe(0); // ZIP STORE 是原稿存储协议。
  const archive = await read_zip_fixture(prepared.content);
  expect([...archive.keys()]).toEqual(["data/Broken.json", "data/System.json", "game_files.txt"]);
  expect(zip_text(archive, "game_files.txt")).toBe(
    "data/Broken.json\ndata/System.json\nimg/pictures/Actor1.png",
  );
  expect(zip_text(archive, "data/Broken.json")).toBe("{");
  const output = path.join(temp.path, "out");
  await service.write_to_path([], {
    paths: { translated_path: output, bilingual_path: output },
    source_files: [{ path: "game.zip", file_type: "RPGMAKER_MV_MZ" }],
    asset_reader: () => Buffer.from(prepared.content),
  });
  expect(fs.readFileSync(path.join(output, "game/data/Broken.json"), "utf8")).toBe("{");
  expect(fs.readFileSync(path.join(output, "game/data/System.json"), "utf8")).toBe("{}");
  expect(fs.existsSync(path.join(output, "game/game_files.txt"))).toBe(false);
});
