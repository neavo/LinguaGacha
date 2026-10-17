import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { check_game_backup, read_game_backup_engine, write_game_backup } from "./backup";
import { prepare_game_directory } from "./prepare";

/** 数据与插件共同验证备份按游戏相对路径保存。 */
const files = new Map([
  ["data/System.json", Buffer.from("{}")],
  ["js/plugins/Menu.js", Buffer.from("original")],
]);

it.each([null, "invalid json", '{"version":2,"engine":"mz"}', '{"version":1,"engine":"unknown"}'])(
  "缺失或无效标记 %s 不提供备份身份",
  (marker) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-marker-"));
    if (marker !== null) fs.writeFileSync(path.join(temp.path, ".linguagacha-backup.json"), marker);
    expect(read_game_backup_engine(temp.path, new NativeFs())).toBeNull();
  },
);

it.each([".linguagacha-backup", ".lg-original", "backup_lg/.tmp", "backup_lg"])(
  "遗留状态 %s 阻止准备和备份，保留恢复文件",
  async (directory) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-interrupted-"));
    const native = new NativeFs();
    const saved = path.join(temp.path, directory, "keep");
    native.write_file_sync(saved, "recovery");
    const stage = vi.fn(async () => ({ writes: [] }));
    await expect(prepare_game_directory(temp.path, native, stage)).rejects.toThrow();
    expect(stage).not.toHaveBeenCalled();
    expect(() => check_game_backup(temp.path, "mz", [...files.keys()], native)).toThrow();
    await expect(write_game_backup(temp.path, "mz", files, native)).rejects.toThrow();
    expect(fs.readFileSync(saved, "utf8")).toBe("recovery");
  },
);

it("备份写入拒绝原稿占用临时目录", async () => {
  const name = ".tmp/a.json";
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-reserved-"));
  await expect(
    write_game_backup(temp.path, "mz", new Map([[name, Buffer.from("original")]]), new NativeFs()),
  ).rejects.toThrow("Member conflicts with preparation files");
  expect(fs.readdirSync(temp.path)).toEqual([]);
});

it("完成标记发布后清理失败保留完整原稿，并阻止再次写入", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-cleanup-"));
  const native = new NativeFs();
  vi.spyOn(native, "remove_async").mockRejectedValueOnce(new Error("cleanup failure"));
  await expect(write_game_backup(temp.path, "mz", files, native)).rejects.toThrow(
    "Game backup committed. Cleanup failed:",
  );
  expect(fs.existsSync(path.join(temp.path, "backup_lg/.linguagacha-backup.json"))).toBe(true);
  for (const [name, bytes] of files)
    expect(fs.readFileSync(path.join(temp.path, "backup_lg", name))).toEqual(bytes);
  expect(() => check_game_backup(temp.path, "mz", [...files.keys()], native)).toThrow(
    "Unfinished game operation",
  );
});

it.each(["write", "publish", "marker", "cancel"])(
  "首次备份 %s 失败可重试，完整发布前不可复用",
  async (phase) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-fail-"));
    const native = new NativeFs();
    const controller = new AbortController();
    if (phase === "publish" || phase === "marker") {
      const rename = native.rename.bind(native);
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        if (phase === "publish" || to.endsWith(".linguagacha-backup.json"))
          throw new Error(phase + " failure");
        rename(from, to);
      });
    } else {
      const write = native.write_file.bind(native);
      vi.spyOn(native, "write_file").mockImplementationOnce(async (file, bytes) => {
        await write(file, bytes);
        expect(() => check_game_backup(temp.path, "mz", [...files.keys()], native)).toThrow(
          "Unfinished game operation",
        );
        if (phase === "write") throw new Error("write failure");
        controller.abort(new Error("cancel failure"));
      });
    }
    await expect(
      write_game_backup(temp.path, "mz", files, native, controller.signal),
    ).rejects.toThrow(phase + " failure");
    expect(fs.readdirSync(path.join(temp.path, "backup_lg"))).toEqual([]);
    vi.restoreAllMocks();
    await write_game_backup(temp.path, "mz", files, native);
    expect(check_game_backup(temp.path, "mz", [...files.keys()], native)).toBe(true);
    for (const [name, bytes] of files)
      expect(fs.readFileSync(path.join(temp.path, "backup_lg", name))).toEqual(bytes);
  },
);

it("已有备份拒绝重复写入和不同引擎，保留原稿", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-conflict-"));
  const native = new NativeFs();
  await write_game_backup(temp.path, "mv", files, native);
  expect(() => check_game_backup(temp.path, "mz", [...files.keys()], native)).toThrow(
    "Invalid game backup",
  );
  await expect(write_game_backup(temp.path, "mv", files, native)).rejects.toThrow();
  for (const [name, bytes] of files)
    expect(fs.readFileSync(path.join(temp.path, "backup_lg", name))).toEqual(bytes);
});

it.each(["added", "missing", "directory", "link"])(
  "备份覆盖冲突 %s 保留原稿且不补写",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-coverage-"));
    const native = new NativeFs();
    await write_game_backup(temp.path, "mz", files, native);
    const names = [...files.keys()];
    const directory = path.join(temp.path, "backup_lg");
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
