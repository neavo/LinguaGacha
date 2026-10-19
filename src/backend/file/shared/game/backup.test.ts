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

it("按相对路径保存首次字节，同长度和不同长度修改均不覆盖或产生历史", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-first-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  await write_game_backup(temp.path, files, native);
  for (const content of ["[]", "longer content"]) {
    const next = new Map(files);
    next.set("data/System.json", Buffer.from(content));
    await write_game_backup(temp.path, next, native);
    for (const [name, bytes] of files)
      expect(fs.readFileSync(path.join(directory, name))).toEqual(bytes);
    expect(fs.readdirSync(directory).sort()).toEqual(["data", "js"]);
  }
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});

it("新增和改名只补存缺项，删除的路径继续保留", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-missing-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  await write_game_backup(temp.path, files, native);
  const next = new Map(files);
  next.delete("data/System.json");
  next.set("data/New.json", Buffer.from("new"));
  await write_game_backup(temp.path, next, native);
  for (const [name, bytes] of files)
    expect(fs.readFileSync(path.join(directory, name))).toEqual(bytes);
  expect(fs.readFileSync(path.join(directory, "data/New.json"), "utf8")).toBe("new");
  expect(fs.readdirSync(directory).sort()).toEqual(["data", "js"]);
});

it("沿用旧备份、空文件、历史和残留，无关路径不参与补存检查", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-legacy-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg"),
    outside = path.join(temp.path, "outside");
  const previous = new Map([
    ["data/System.json", ""],
    ["data/old.json", "old"],
    [HISTORY + "/data/System.json", "historical original"],
    [".linguagacha-backup.json", "old marker"],
    [".tmp/stage/keep", "old staging"],
  ]);
  for (const [name, bytes] of previous) native.write_file_sync(path.join(directory, name), bytes);
  native.write_file_sync(path.join(outside, "keep"), "outside");
  native.create_directory_link(outside, path.join(directory, "unrelated"));
  await write_game_backup(temp.path, files, native);
  for (const [name, bytes] of previous)
    expect(fs.readFileSync(path.join(directory, name), "utf8")).toBe(bytes);
  expect(fs.readFileSync(path.join(directory, "js/plugins/Menu.js"), "utf8")).toBe("original");
  expect(fs.lstatSync(path.join(directory, "unrelated")).isSymbolicLink()).toBe(true);
  expect(fs.readdirSync(outside)).toEqual(["keep"]);
});

it.each(["write", "cancel", "cancel-last"])(
  "%s 失败保留已完成文件，重试只补存缺失路径",
  async (phase) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-retry-"));
    const native = new NativeFs(),
      directory = path.join(temp.path, "backup_lg"),
      controller = new AbortController(),
      cause = new Error(phase + " failure");
    const write = native.write_file_atomic.bind(native),
      rename = native.rename.bind(native);
    if (phase === "write") {
      vi.spyOn(native, "rename").mockImplementation((from, to) => {
        if (to === path.join(directory, "js/plugins/Menu.js")) throw cause;
        rename(from, to);
      });
    } else {
      vi.spyOn(native, "write_file_atomic").mockImplementation((file, bytes) => {
        write(file, bytes);
        if (phase === "cancel-last") {
          if (file === path.join(directory, "js/plugins/Menu.js")) controller.abort(cause);
        } else setImmediate(() => controller.abort(cause));
      });
    }
    await expect(
      write_game_backup(temp.path, files, native, controller.signal),
    ).rejects.toMatchObject({
      code: "file.io_failed",
      cause,
      message: expect.stringContaining("\nGame backup: " + directory),
    });
    expect(fs.readFileSync(path.join(directory, "data/System.json"), "utf8")).toBe("{}");
    expect(fs.existsSync(path.join(directory, "js/plugins/Menu.js"))).toBe(phase === "cancel-last");
    vi.restoreAllMocks();
    const next = new Map([
      ["data/System.json", Buffer.from("changed")],
      ["js/plugins/Menu.js", Buffer.from("retry")],
    ]);
    await write_game_backup(temp.path, next, native);
    expect(fs.readFileSync(path.join(directory, "data/System.json"), "utf8")).toBe("{}");
    expect(fs.readFileSync(path.join(directory, "js/plugins/Menu.js"), "utf8")).toBe(
      phase === "cancel-last" ? "original" : "retry",
    );
    expect(fs.readdirSync(directory).sort()).toEqual(["data", "js"]);
  },
);

it.each([".tmp/a", "backup_lg/a", HISTORY + "/a", "../outside", "Data/a|data/b", "data|data/a"])(
  "整批路径校验失败时不写入：%s",
  async (names) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-path-"));
    const native = new NativeFs(),
      directory = path.join(temp.path, "backup_lg");
    native.write_file_sync(path.join(directory, "keep"), "old");
    await expect(
      write_game_backup(
        temp.path,
        new Map(["first", ...names.split("|")].map((name) => [name, Buffer.from("new")])),
        native,
      ),
    ).rejects.toThrow();
    expect(fs.readdirSync(directory)).toEqual(["keep"]);
    expect(fs.readFileSync(path.join(directory, "keep"), "utf8")).toBe("old");
  },
);

it.each(["root", "ancestor", "target"])("拒绝本次访问路径中的链接：%s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-link-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg"),
    outside = path.join(temp.path, "outside");
  native.write_file_sync(path.join(outside, "keep"), "outside");
  const link =
    kind === "root"
      ? directory
      : path.join(directory, kind === "ancestor" ? "data" : "data/System.json");
  native.make_dir(path.dirname(link));
  native.create_directory_link(outside, link);
  await expect(write_game_backup(temp.path, files, native)).rejects.toThrow(
    "Unsafe game filesystem path",
  );
  expect(fs.readdirSync(outside)).toEqual(["keep"]);
  expect(fs.readFileSync(path.join(outside, "keep"), "utf8")).toBe("outside");
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
});

it.each(["root", "ancestor", "target"])("路径类型冲突时保留占用内容：%s", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-type-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  const occupied =
    kind === "root"
      ? directory
      : path.join(directory, kind === "ancestor" ? "data" : "data/System.json/keep");
  native.write_file_sync(occupied, "keep");
  await expect(write_game_backup(temp.path, files, native)).rejects.toMatchObject({
    code: "file.io_failed",
    message: expect.stringContaining("\nGame backup: " + directory),
  });
  expect(fs.readFileSync(occupied, "utf8")).toBe("keep");
  expect(fs.existsSync(path.join(directory, "js"))).toBe(false);
});

it.each(["before", "skip"])("%s 取消保留旧内容和根目录恢复材料，可重新补存", async (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-cancel-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg"),
    controller = new AbortController(),
    cause = new Error("cancel backup");
  native.write_file_sync(path.join(temp.path, ".tmp/rollback/keep"), "recovery");
  native.write_file_sync(path.join(directory, "data/System.json"), "old");
  if (phase === "before") controller.abort(cause);
  else {
    const stat = native.stat.bind(native);
    vi.spyOn(native, "stat").mockImplementation((target) => {
      const value = stat(target);
      if (target === path.join(directory, "data/System.json")) controller.abort(cause);
      return value;
    });
  }
  const current = new Map([["data/System.json", Buffer.from("new")]]);
  await expect(write_game_backup(temp.path, current, native, controller.signal)).rejects.toThrow(
    "cancel backup",
  );
  vi.restoreAllMocks();
  await write_game_backup(temp.path, files, native);
  expect(fs.readFileSync(path.join(directory, "data/System.json"), "utf8")).toBe("old");
  expect(fs.readFileSync(path.join(directory, "js/plugins/Menu.js"), "utf8")).toBe("original");
  expect(fs.readFileSync(path.join(temp.path, ".tmp/rollback/keep"), "utf8")).toBe("recovery");
});

it("目标元数据读取失败时保留已有备份并终止补存", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-backup-stat-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg");
  native.write_file_sync(path.join(directory, "data/System.json"), "old");
  const stat = native.stat.bind(native);
  vi.spyOn(native, "stat").mockImplementation((name) => {
    if (name === path.join(directory, "data/System.json")) throw new Error("stat failure");
    return stat(name);
  });
  await expect(write_game_backup(temp.path, files, native)).rejects.toThrow("stat failure");
  expect(fs.readFileSync(path.join(directory, "data/System.json"), "utf8")).toBe("old");
  expect(fs.readdirSync(directory)).toEqual(["data"]);
});
