import JSZip from "jszip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { RPGMakerMvMzFormat } from "../rpgmaker-mv-mz/rpgmaker-format";
import { read_rpgmaker_container } from "./rpgmaker-format";

it("RM 拒绝没有原稿文件的容器", async () => {
  const zip = new JSZip().folder("data")!;
  await expect(
    read_rpgmaker_container(await zip.generateAsync({ type: "uint8array" }), "game.zip"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});

it("首次备份与容器共用读取字节，重复导入保留可覆盖恢复的原文", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-backup-"));
  const native = new NativeFs();
  const format = new RPGMakerMvMzFormat({ target_language: "ZH" }, native);
  const names = ["www/data/System.json", "www/js/plugins.js", "www/js/plugins/Menu.js"];
  const entries = names.map((rel_path) => ({
    rel_path,
    source_path: path.join(temp.path, rel_path),
  }));
  for (const entry of entries)
    native.write_file_sync(entry.source_path, "original " + entry.rel_path);
  const read = vi.spyOn(native, "read_file");
  const game = { root: temp.path, engine: "mv" };
  const prepared = await format.prepare_source(entries, "game.zip", game);
  const zip = await read_rpgmaker_container(prepared.content, "game.zip");
  for (const entry of entries) {
    expect(read.mock.calls.filter(([file]) => file === entry.source_path)).toHaveLength(1);
    expect(fs.readFileSync(path.join(temp.path, ".linguagacha-backup", entry.rel_path))).toEqual(
      await zip.get(entry.rel_path)!.async("nodebuffer"),
    );
    native.write_file_sync(entry.source_path, "translated");
  }
  await format.prepare_source(entries, "game.zip", game);
  const added = {
    rel_path: "www/js/plugins/Added.js",
    source_path: path.join(temp.path, "added.js"),
  };
  native.write_file_sync(added.source_path, "possibly translated");
  await expect(format.prepare_source([...entries, added], "game.zip", game)).rejects.toThrow(
    "Game backup coverage conflict",
  );
  fs.cpSync(path.join(temp.path, ".linguagacha-backup"), temp.path, { recursive: true });
  for (const entry of entries)
    expect(fs.readFileSync(entry.source_path, "utf8")).toBe("original " + entry.rel_path);
});

it.each([false, true])("已有备份 %s 时读取失败均中止导入，恢复读取后可重试", async (existing) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-read-"));
  const native = new NativeFs();
  const format = new RPGMakerMvMzFormat({ target_language: "ZH" }, native);
  const game = { root: temp.path, engine: "mz" };
  const entries = ["data/System.json", "js/plugins/Menu.js"].map((rel_path) => ({
    rel_path,
    source_path: path.join(temp.path, rel_path),
  }));
  for (const entry of entries) native.write_file_sync(entry.source_path, "original");
  if (existing) await format.prepare_source(entries, "game.zip", game);
  const read = native.read_file.bind(native);
  const mock = vi.spyOn(native, "read_file").mockImplementation((file) => {
    if (file === entries[1]!.source_path) throw new Error("read failure");
    return read(file);
  });
  await expect(format.prepare_source(entries, "game.zip", game)).rejects.toThrow("read failure");
  expect(fs.existsSync(path.join(temp.path, ".linguagacha-backup"))).toBe(existing);
  mock.mockRestore();
  await format.prepare_source(entries, "game.zip", game);
  for (const entry of entries)
    expect(
      fs.readFileSync(path.join(temp.path, ".linguagacha-backup", entry.rel_path), "utf8"),
    ).toBe("original");
});
