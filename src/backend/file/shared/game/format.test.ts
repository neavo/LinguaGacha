import { read_zip_fixture, zip_text, write_zip } from "../../../../test/zip-fixture";
import JSZip from "jszip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { create_rpgmaker_mv_mz_adapter } from "../../rpgmaker-mv-mz/rpgmaker-format";
import { GameFormat, read_game_container } from "./format";

it("游戏 拒绝没有原稿文件的容器", async () => {
  const zip = new JSZip().folder("data")!;
  await expect(
    read_game_container(await zip.generateAsync({ type: "uint8array" }), "game.zip"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});

it("每次备份与容器共用读取字节，重复导入归档旧字节且允许新增原稿", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-backup-"));
  const native = new NativeFs();
  const format = new GameFormat(create_rpgmaker_mv_mz_adapter({ target_language: "ZH" }), native);
  const names = ["www/data/System.json", "www/js/plugins.js", "www/js/plugins/Menu.js"];
  const entries = names.map((rel_path) => ({
    rel_path,
    source_path: path.join(temp.path, rel_path),
  }));
  for (const entry of entries)
    native.write_file_sync(entry.source_path, "original " + entry.rel_path);
  const read = vi.spyOn(native, "read_file");
  const root = temp.path;
  const prepared = await format.prepare_source(entries, "game.zip", root);
  const { members: zip } = await read_game_container(prepared.content, "game.zip");
  for (const entry of entries) {
    expect(read.mock.calls.filter(([file]) => file === entry.source_path)).toHaveLength(1);
    expect(fs.readFileSync(path.join(temp.path, "backup_lg", entry.rel_path))).toEqual(
      await zip.get(entry.rel_path)!.async("nodebuffer"),
    );
    native.write_file_sync(entry.source_path, "translated");
  }
  const repeated = await format.prepare_source(entries, "game.zip", root);
  const { members: repeated_members, game_files } = await read_game_container(
    repeated.content,
    "game.zip",
  );
  const directory = path.join(root, "backup_lg");
  const history = fs.readdirSync(directory).find((name) => name.startsWith("backup_lg_"))!;
  for (const entry of entries) {
    expect(fs.readFileSync(path.join(directory, history, entry.rel_path), "utf8")).toBe(
      "original " + entry.rel_path,
    );
    expect(fs.readFileSync(path.join(directory, entry.rel_path))).toEqual(
      await repeated_members.get(entry.rel_path)!.async("nodebuffer"),
    );
    expect(fs.readFileSync(path.join(directory, entry.rel_path), "utf8")).toBe("translated");
  }
  expect(await game_files!.async("string")).toBe(names.join("\n")); // 已有备份目录不属于游戏文件。
  const added = {
    rel_path: "www/js/plugins/Added.js",
    source_path: path.join(temp.path, "added.js"),
  };
  native.write_file_sync(added.source_path, "possibly translated");
  const expanded = await format.prepare_source([...entries, added], "game.zip", root);
  const { members: expanded_members } = await read_game_container(expanded.content, "game.zip");
  expect(fs.readFileSync(path.join(directory, added.rel_path))).toEqual(
    await expanded_members.get(added.rel_path)!.async("nodebuffer"),
  );
  expect(fs.readFileSync(path.join(directory, history, entries[0]!.rel_path), "utf8")).toBe(
    "original " + entries[0]!.rel_path,
  );
});

it.each([false, true])("已有备份 %s 时读取失败均中止导入，恢复读取后可重试", async (existing) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-read-"));
  const native = new NativeFs();
  const format = new GameFormat(create_rpgmaker_mv_mz_adapter({ target_language: "ZH" }), native);
  const root = temp.path;
  const entries = ["data/System.json", "js/plugins/Menu.js"].map((rel_path) => ({
    rel_path,
    source_path: path.join(temp.path, rel_path),
  }));
  for (const entry of entries) native.write_file_sync(entry.source_path, "original");
  if (existing) await format.prepare_source(entries, "game.zip", root);
  const read = native.read_file.bind(native);
  const mock = vi.spyOn(native, "read_file").mockImplementation((file) => {
    if (file === entries[1]!.source_path) throw new Error("read failure");
    return read(file);
  });
  await expect(format.prepare_source(entries, "game.zip", root)).rejects.toThrow("read failure");
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(existing);
  if (existing) {
    expect(fs.readdirSync(path.join(temp.path, "backup_lg")).sort()).toEqual(["data", "js"]);
    expect(fs.readFileSync(path.join(temp.path, "backup_lg", entries[0]!.rel_path), "utf8")).toBe(
      "original",
    );
  }
  mock.mockRestore();
  await format.prepare_source(entries, "game.zip", root);
  for (const entry of entries)
    expect(fs.readFileSync(path.join(temp.path, "backup_lg", entry.rel_path), "utf8")).toBe(
      "original",
    );
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

it("解析失败保留原始字节，备份与零条目导出仍包含该文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-errors-"));
  fs.mkdirSync(path.join(temp.path, "data"));
  fs.mkdirSync(path.join(temp.path, "js"));
  fs.writeFileSync(path.join(temp.path, "data/System.json"), "{}");
  fs.writeFileSync(path.join(temp.path, "data/Broken.json"), "{");
  fs.mkdirSync(path.join(temp.path, "img/pictures"), { recursive: true });
  fs.writeFileSync(path.join(temp.path, "img/pictures/Actor1.png"), "");
  const native = new NativeFs();
  const service = new GameFormat(create_rpgmaker_mv_mz_adapter({ target_language: "ZH" }), native);
  const entries = ["data/Broken.json", "data/System.json"].map((rel_path) => ({
    rel_path,
    source_path: path.join(temp.path, rel_path),
  }));
  const prepared = await service.prepare_source(entries, "game.zip", temp.path);
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
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/data/Broken.json"), "utf8")).toBe("{");
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

it("容器生成失败保留旧备份，下次导入可重新生成", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-container-fail-"));
  const native = new NativeFs(),
    format = new GameFormat(create_rpgmaker_mv_mz_adapter({ target_language: "ZH" }), native);
  const source_path = path.join(temp.path, "data/System.json");
  native.write_file_sync(source_path, "new");
  native.write_file_sync(path.join(temp.path, "backup_lg/keep"), "old");
  const entries = [{ source_path, rel_path: "data/System.json" }];
  const generate = vi
    .spyOn(JSZip.prototype, "generateAsync")
    .mockRejectedValueOnce(new Error("container failure"));
  await expect(format.prepare_source(entries, "game.zip", temp.path)).rejects.toThrow(
    "container failure",
  );
  generate.mockRestore();
  expect(fs.readdirSync(path.join(temp.path, "backup_lg"))).toEqual(["keep"]);
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/keep"), "utf8")).toBe("old");
  await format.prepare_source(entries, "game.zip", temp.path);
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/data/System.json"), "utf8")).toBe("new");
});
