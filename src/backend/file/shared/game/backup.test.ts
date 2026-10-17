import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { write_game_backup } from "./backup";

const files = new Map([
  ["data/System.json", Buffer.from("{}")],
  ["js/plugins/Menu.js", Buffer.from("original")],
]);
const HISTORY = "backup_lg_20200102_030405";
const TIME = new Date(2020, 0, 2, 3, 4, 5).getTime();

/** 仅替换旧内容元数据，归档命名不依赖真实创建时间或等待。 */
function old_times(native: NativeFs, directory: string) {
  const stat = native.stat.bind(native);
  vi.spyOn(native, "stat").mockImplementation((target) => {
    const value = stat(target);
    if (target.startsWith(directory + path.sep))
      Object.assign(value, { birthtimeMs: TIME, mtimeMs: TIME });
    return value;
  });
}

it.each(["missing", "history"])("%s 备份目录直接保存本次字节", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-empty-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  if (kind === "history") native.write_file_sync(path.join(directory, HISTORY, "keep"), "history");
  await write_game_backup(temp.path, files, native);
  expect(fs.readdirSync(directory).sort()).toEqual(
    (kind === "history" ? [HISTORY, "data", "js"] : ["data", "js"]).sort(),
  );
  for (const [name, bytes] of files)
    expect(fs.readFileSync(path.join(directory, name))).toEqual(bytes);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});

it("轮换普通旧内容和旧标记，已有历史留在同层，旧工作区作为普通内容归档", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-rotate-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  const previous = "BACKUP_LG_20191231_235959_1";
  for (const name of [
    "data/old.json",
    ".linguagacha-backup.json",
    ".tmp/stage/keep",
    previous + "/keep",
  ])
    native.write_file_sync(path.join(directory, name), name);
  old_times(native, directory);
  await write_game_backup(temp.path, files, native);
  for (const name of ["data/old.json", ".linguagacha-backup.json", ".tmp/stage/keep"])
    expect(fs.readFileSync(path.join(directory, HISTORY, name), "utf8")).toBe(name);
  expect(fs.readFileSync(path.join(directory, previous, "keep"), "utf8")).toBe(previous + "/keep");
  expect(fs.existsSync(path.join(directory, HISTORY, previous))).toBe(false);
  expect(fs.existsSync(path.join(directory, ".linguagacha-backup.json"))).toBe(false);
  expect(fs.readFileSync(path.join(directory, "data/System.json"), "utf8")).toBe("{}");
});

it.each(["mtime", "directories"])("归档时间来自旧内容：%s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-time-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  native.make_dir(path.join(directory, "nested/empty"));
  if (kind === "mtime") {
    native.write_file_sync(path.join(directory, "nested/first"), "first");
    native.write_file_sync(path.join(directory, "later"), "later");
  }
  const stat = native.stat.bind(native);
  vi.spyOn(native, "stat").mockImplementation((target) => {
    const value = stat(target);
    const earliest = target.endsWith(kind === "directories" ? "empty" : "first");
    Object.assign(value, { birthtimeMs: 0, mtimeMs: earliest ? TIME : TIME + 60000 });
    return value;
  });
  await write_game_backup(temp.path, files, native);
  expect(fs.statSync(path.join(directory, HISTORY, "nested/empty")).isDirectory()).toBe(true);
});

it("目录时间早于文件时仍按文件时间归档，大小写目录和普通文件共同占用名称", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-collision-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  native.make_dir(path.join(directory, HISTORY.toUpperCase()));
  native.write_file_sync(path.join(directory, HISTORY + "_1"), "occupied file");
  native.write_file_sync(path.join(directory, "nested/old"), "old");
  const stat = native.stat.bind(native);
  vi.spyOn(native, "stat").mockImplementation((target) => {
    const value = stat(target);
    Object.assign(value, { birthtimeMs: value.isDirectory() ? TIME - 60000 : TIME });
    return value;
  });
  await write_game_backup(temp.path, files, native);
  expect(fs.readFileSync(path.join(directory, HISTORY + "_2", HISTORY + "_1"), "utf8")).toBe(
    "occupied file",
  );
  expect(fs.readFileSync(path.join(directory, HISTORY + "_2/nested/old"), "utf8")).toBe("old");
});

it.each(["EEXIST", "EACCES"])("归档排他创建错误 %s 只在重名时重试", async (code) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-create-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  native.write_file_sync(path.join(directory, "old"), "old");
  old_times(native, directory);
  const create = vi
    .spyOn(native, "make_dir_exclusive")
    .mockRejectedValueOnce(Object.assign(new Error(code), { code }));
  if (code === "EEXIST") {
    await write_game_backup(temp.path, files, native);
    expect(fs.readFileSync(path.join(directory, HISTORY + "_1/old"), "utf8")).toBe("old");
    expect(create).toHaveBeenCalledTimes(2);
  } else {
    await expect(write_game_backup(temp.path, files, native)).rejects.toThrow(code);
    expect(create).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(directory)).toEqual(["old"]);
  }
});

it.each(["move", "write-cancel"])("%s 失败保留现场，下次导入可轮换重试", async (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-fail-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg"),
    controller = new AbortController();
  native.write_file_sync(path.join(directory, "a"), "old a");
  native.write_file_sync(path.join(directory, "b"), "old b");
  old_times(native, directory);
  const write = native.write_file.bind(native),
    rename = native.rename.bind(native);
  const writes = vi.spyOn(native, "write_file");
  if (phase.startsWith("move")) {
    let moved = 0;
    vi.spyOn(native, "rename").mockImplementation((from, to) => {
      if (moved++) throw new Error("move failure");
      rename(from, to);
      if (phase === "move-cancel") controller.abort(new Error("move-cancel failure"));
    });
  } else {
    let written = 0;
    writes.mockImplementation(async (file, bytes) => {
      if (written++) throw new Error("write failure");
      await write(file, bytes);
      if (phase === "write-cancel") controller.abort(new Error("write-cancel failure"));
    });
  }
  await expect(
    write_game_backup(temp.path, files, native, controller.signal),
  ).rejects.toMatchObject({
    cause: { message: phase + " failure" },
    message: expect.stringContaining(
      "\nGame backup: " + directory + "\nHistory: " + path.join(directory, HISTORY),
    ),
  });
  expect(fs.readFileSync(path.join(directory, HISTORY, "a"), "utf8")).toBe("old a");
  if (phase.startsWith("move")) {
    expect(writes).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(directory, "b"), "utf8")).toBe("old b");
  } else {
    expect(fs.readFileSync(path.join(directory, HISTORY, "b"), "utf8")).toBe("old b");
    expect(fs.readFileSync(path.join(directory, "data/System.json"), "utf8")).toBe("{}");
    expect(fs.existsSync(path.join(directory, "js"))).toBe(false);
  }
  vi.restoreAllMocks();
  await write_game_backup(temp.path, files, native);
  for (const [name, bytes] of files)
    expect(fs.readFileSync(path.join(directory, name))).toEqual(bytes);
  expect(fs.readFileSync(path.join(directory, HISTORY, "a"), "utf8")).toBe("old a");
});

it.each([".tmp/a", "backup_lg/a", HISTORY + "/a", "../outside", "Data/a|data/b", "data|data/a"])(
  "原稿路径校验失败不移动旧内容：%s",
  async (names) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-path-"));
    const native = new NativeFs(),
      directory = path.join(temp.path, "backup_lg");
    native.write_file_sync(path.join(directory, "keep"), "old");
    await expect(
      write_game_backup(
        temp.path,
        new Map(names.split("|").map((name) => [name, Buffer.from("new")])),
        native,
      ),
    ).rejects.toThrow();
    expect(fs.readdirSync(directory)).toEqual(["keep"]);
  },
);

it.each(["root", "current", "nested"])("拒绝备份中的链接：%s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-link-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg"),
    outside = path.join(temp.path, "outside");
  native.write_file_sync(path.join(outside, "keep"), "outside");
  const link =
    kind === "root" ? directory : path.join(directory, kind === "nested" ? "data/link" : "link");
  native.make_dir(path.dirname(link));
  native.create_directory_link(outside, link);
  await expect(write_game_backup(temp.path, files, native)).rejects.toThrow(
    "Unsafe game filesystem path",
  );
  expect(fs.readFileSync(path.join(outside, "keep"), "utf8")).toBe("outside");
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
});

it("归档前取消保留旧内容，备份流程不接管解包恢复目录", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-cancel-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg"),
    controller = new AbortController();
  native.write_file_sync(path.join(temp.path, ".tmp/rollback/keep"), "recovery");
  native.write_file_sync(path.join(directory, "keep"), "old");
  const stat = native.stat.bind(native);
  vi.spyOn(native, "stat").mockImplementation((target) => {
    const value = stat(target);
    if (target === path.join(directory, "keep"))
      controller.abort(new Error("cancel before archive"));
    return value;
  });
  await expect(write_game_backup(temp.path, files, native, controller.signal)).rejects.toThrow(
    "cancel before archive",
  );
  expect(fs.readdirSync(directory)).toEqual(["keep"]);
  expect(fs.readFileSync(path.join(temp.path, ".tmp/rollback/keep"), "utf8")).toBe("recovery");
});
