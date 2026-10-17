import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../native/native-fs";
import { evb_fixture } from "../../test/evb-fixture";
import { discover_source, discover_sources } from "./source-discovery";

it.each(["backup_lg", ".tmp"])(
  "管理目录 %s 扫描时排除，显式选择内部路径报告错误且保留兄弟来源",
  async (name) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-managed-"));
    const native = new NativeFs();
    const directory = path.join(temp.path, name);
    const saved = path.join(directory, "nested/story.txt");
    const normal = path.join(temp.path, "normal.txt");
    native.write_file_sync(saved, "old");
    native.write_file_sync(normal, "normal");
    expect((await discover_sources([temp.path], native)).map((entry) => entry.source_path)).toEqual(
      [normal],
    );
    const selections = [directory, path.dirname(saved), saved];
    const entries = await discover_sources([temp.path, ...selections], native);
    for (const selected of selections) {
      const entry = entries.find((value) => value.source_path === selected)!;
      expect(entry.source).toMatchObject({
        kind: "failure",
        error: new Error(
          "Game management directory cannot be used as an import source: " + directory,
        ),
      });
      expect((await discover_source(selected, native)).source.kind).toBe("failure");
    }
    expect(entries.find((entry) => entry.source_path === normal)!.source.kind).toBe("file");
  },
);

it("管理目录识别读取失败归集来源错误，保留正常兄弟来源", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-managed-io-"));
  const native = new NativeFs(),
    directory = path.join(temp.path, "backup_lg"),
    saved = path.join(directory, "story.txt"),
    normal = path.join(temp.path, "normal.txt");
  native.write_file_sync(saved, "old");
  native.write_file_sync(normal, "normal");
  const failure = Object.assign(new Error("access denied"), { code: "EACCES" });
  const stat = native.stat.bind(native);
  vi.spyOn(native, "stat").mockImplementation((target) => {
    if (target === directory) throw failure;
    return stat(target);
  });
  const entries = await discover_sources([temp.path, saved], native);
  expect(entries.find((entry) => entry.source_path === normal)!.source.kind).toBe("file");
  expect(entries.find((entry) => entry.source_path === saved)!.source).toEqual({
    kind: "failure",
    error: failure,
  });
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
