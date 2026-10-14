import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { check_game_backup, write_game_backup } from "./rpgmaker-backup";

/** 数据与插件共同验证备份按游戏相对路径保存。 */
const files = new Map([
  ["data/System.json", Buffer.from("{}")],
  ["js/plugins/Menu.js", Buffer.from("original")],
]);

it.each(["write", "publish", "cancel"])(
  "首次备份 %s 失败可重试，完整发布前不可复用",
  async (phase) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-fail-"));
    const native = new NativeFs();
    const controller = new AbortController();
    if (phase === "publish")
      vi.spyOn(native, "rename").mockImplementationOnce(() => {
        throw new Error("publish failure");
      });
    else {
      const write = native.write_file.bind(native);
      vi.spyOn(native, "write_file").mockImplementationOnce(async (file, bytes) => {
        await write(file, bytes);
        expect(check_game_backup(temp.path, "mz", [...files.keys()], native)).toBe(false);
        if (phase === "write") throw new Error("write failure");
        controller.abort(new Error("cancel failure"));
      });
    }
    await expect(
      write_game_backup(temp.path, "mz", files, native, controller.signal),
    ).rejects.toThrow(phase + " failure");
    expect(fs.readdirSync(temp.path)).toEqual([]);
    await write_game_backup(temp.path, "mz", files, native);
    expect(check_game_backup(temp.path, "mz", [...files.keys()], native)).toBe(true);
    for (const [name, bytes] of files)
      expect(fs.readFileSync(path.join(temp.path, ".linguagacha-backup", name))).toEqual(bytes);
  },
);

it.each(["unmarked", "engine"])("拒绝 %s 备份并保留现有内容", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-conflict-"));
  const native = new NativeFs();
  if (kind === "engine") await write_game_backup(temp.path, "mv", files, native);
  else native.write_file_sync(path.join(temp.path, ".linguagacha-backup/keep"), "user file");
  expect(() => check_game_backup(temp.path, "mz", [...files.keys()], native)).toThrow(
    "Invalid game backup",
  );
  const name = kind === "engine" ? "js/plugins/Menu.js" : "keep";
  expect(fs.readFileSync(path.join(temp.path, ".linguagacha-backup", name), "utf8")).toBe(
    kind === "engine" ? "original" : "user file",
  );
});

it.each(["added", "missing", "directory", "link"])(
  "备份覆盖冲突 %s 保留原稿且不补写",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-coverage-"));
    const native = new NativeFs();
    await write_game_backup(temp.path, "mz", files, native);
    const names = [...files.keys()];
    const directory = path.join(temp.path, ".linguagacha-backup");
    let conflict = path.join(directory, "js/plugins/Menu.js");
    if (kind === "added") {
      names.push("js/plugins/Added.js");
      conflict = path.join(directory, "js/plugins/Added.js");
    } else {
      fs.unlinkSync(conflict);
      if (kind === "directory") fs.mkdirSync(conflict);
      if (kind === "link") {
        fs.rmdirSync(path.dirname(conflict));
        const outside = path.join(temp.path, "outside");
        native.write_file_sync(path.join(outside, "Menu.js"), "outside");
        native.create_directory_link(outside, path.dirname(conflict));
      }
    }
    expect(() => check_game_backup(temp.path, "mz", names, native)).toThrow(
      "Game backup coverage conflict: " + conflict,
    );
    expect(fs.readFileSync(path.join(directory, "data/System.json"), "utf8")).toBe("{}");
    if (kind === "added" || kind === "missing") expect(fs.existsSync(conflict)).toBe(false);
    if (kind === "link") expect(fs.readFileSync(conflict, "utf8")).toBe("outside");
    expect(check_game_backup(temp.path, "mz", ["data/System.json"], native)).toBe(true);
  },
);
