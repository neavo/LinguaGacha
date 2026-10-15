import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../native/native-fs";
import { evb_fixture } from "../../test/evb-fixture";
import { discover_source, discover_sources } from "./source-discovery";

it("普通同名目录正常扫描，非有效标记和临时目录不决定归属", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-ordinary-backup-"));
  const native = new NativeFs();
  const backup = path.join(temp.path, "backup_lg");
  const saved = path.join(backup, "story.txt");
  native.write_file_sync(saved, "original");
  native.make_dir(path.join(backup, ".tmp"));
  native.write_file_sync(path.join(backup, ".linguagacha-backup.json"), "invalid json");
  for (const selected of [temp.path, backup, saved]) {
    const entries = await discover_sources([selected], native);
    expect(
      entries.some((entry) => entry.source_path === saved && entry.source.kind === "file"),
    ).toBe(true);
    expect(entries.some((entry) => entry.source.kind === "failure")).toBe(false);
  }
});

it.each(["mv", "rgss", "packed", "moved"])(
  "%s 备份扫描时跳过，显式选择目录及内部路径时保留失败和正常兄弟来源",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-backup-"));
    const native = new NativeFs();
    const root = path.join(temp.path, "game");
    const backup = path.join(root, "backup_lg");
    const saved = path.join(backup, "nested/story.txt");
    native.write_file_sync(saved, "original");
    if (kind === "moved") {
      // 只有身份标记也足够识别，不在扫描阶段校验原稿覆盖。
      native.write_file_sync(
        path.join(backup, ".linguagacha-backup.json"),
        '{ "engine": "mz", "version": 1 }',
      );
    } else if (kind === "mv") {
      native.write_file_sync(path.join(root, "data/System.json"), "{}");
      native.write_file_sync(path.join(root, "js/rmmz_core.js"), "// engine");
    } else if (kind === "rgss") {
      native.write_file_sync(path.join(root, "Game.ini"), "[Game]\nScripts=Data/Scripts.rvdata2");
    } else {
      native.write_file_sync(
        path.join(root, "Game.exe"),
        evb_fixture(
          new Map([
            ["data/System.json", Buffer.from("{}")],
            ["js/rmmz_core.js", Buffer.from("// engine")],
          ]),
        ),
      );
    }
    const source = path.join(temp.path, "normal.txt");
    native.write_file_sync(source, "normal");
    const scanned = await discover_sources([temp.path], native);
    expect(scanned.some((entry) => entry.source_path === source)).toBe(true);
    expect(scanned.some((entry) => entry.source_path.startsWith(backup))).toBe(false);
    const selections = [backup, path.dirname(saved), saved];
    // 同批先扫描再显式选择，仍须报告备份输入，不能被扫描去重吞掉。
    const entries = await discover_sources([temp.path, ...selections], native);
    for (const selected of selections) {
      const entry = entries.find((value) => value.source_path === selected)!;
      expect(entry.source).toMatchObject({
        kind: "failure",
        error: new Error("Game backup cannot be used as an import source: " + backup),
      });
      expect((await discover_source(selected, native)).source.kind).toBe("failure");
    }
    expect(
      entries.some((entry) => entry.source_path === source && entry.source.kind === "file"),
    ).toBe(true);
  },
);

it.each(["marker", "parent"])("%s 读取失败报告来源错误并保留正常兄弟来源", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-backup-io-"));
  const native = new NativeFs();
  const root = path.join(temp.path, "game");
  const backup = path.join(root, "backup_lg");
  const saved = path.join(backup, "story.txt");
  const normal = path.join(temp.path, "normal.txt");
  native.write_file_sync(saved, "backup");
  native.write_file_sync(normal, "normal");
  const failure = Object.assign(new Error("access denied"), { code: "EACCES" });
  if (kind === "marker") {
    native.write_file_sync(
      path.join(backup, ".linguagacha-backup.json"),
      '{"version":1,"engine":"mz"}',
    );
    vi.spyOn(native, "read_text_file").mockImplementation(() => {
      throw failure;
    });
  } else {
    const read = native.read_dirents.bind(native);
    vi.spyOn(native, "read_dirents").mockImplementation((directory) => {
      if (directory === root) throw failure;
      return read(directory);
    });
  }
  for (const selections of [[temp.path], [backup, saved, normal]]) {
    const entries = await discover_sources(selections, native);
    expect(
      entries.some((entry) => entry.source.kind === "failure" && entry.source.error === failure),
    ).toBe(true);
    expect(
      entries.some((entry) => entry.source_path === normal && entry.source.kind === "file"),
    ).toBe(true);
    expect(
      entries.some((entry) => entry.source_path === saved && entry.source.kind !== "failure"),
    ).toBe(false);
  }
  expect((await discover_source(saved, native)).source).toEqual({
    kind: "failure",
    error: failure,
  });
});

it("目录识别失败不会去重掉显式选择的正常散装入口", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-failed-root-"));
  fs.mkdirSync(path.join(temp.path, "data"));
  fs.mkdirSync(path.join(temp.path, "js"));
  fs.writeFileSync(path.join(temp.path, "data/System.json"), "{}");
  fs.writeFileSync(path.join(temp.path, "js/rmmz_core.js"), "// engine");
  fs.writeFileSync(path.join(temp.path, "broken.exe"), evb_fixture(new Map()).subarray(0, -1));
  const selected = path.join(temp.path, "unpacked.exe");
  fs.writeFileSync(selected, "");
  const entries = await discover_sources([temp.path, selected], new NativeFs());
  expect(entries.map((entry) => entry.source.kind)).toEqual(["failure", "mv_mz"]);
  expect(entries[1]!.source_path).toBe(selected);
});

it("发现目录保留入口名称和文件名空格，过滤空输入并去重", async () => {
  using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-discovery-"));
  const left_dir = path.join(temp_dir.path, "left");
  const right_dir = path.join(temp_dir.path, "right");
  fs.mkdirSync(left_dir, { recursive: true });
  fs.mkdirSync(right_dir, { recursive: true });
  fs.writeFileSync(path.join(left_dir, "script.txt"), "左", "utf-8");
  fs.writeFileSync(path.join(right_dir, "script.txt"), "右", "utf-8");
  fs.writeFileSync(path.join(right_dir, "ignored.bin"), "x", "utf-8");
  fs.writeFileSync(path.join(left_dir, " script.txt"), "文件名含空格");

  expect(
    (await discover_sources([left_dir, left_dir, "", "  ", right_dir], new NativeFs())).map(
      (entry) => entry.rel_path.replace(/\\/gu, "/"),
    ),
  ).toEqual(["left/ script.txt", "left/script.txt", "right/script.txt"]);
});
