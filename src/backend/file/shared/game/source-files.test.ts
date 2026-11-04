import { complete_game_preparation } from "./preparation";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { collect_game_source_files, collect_game_file_list } from "./source-files";

it("文件清单合并暂存身份与排除结果，收集不读取额外字节", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-list-"));
  const native = new NativeFs();
  for (const name of [
    "data/Text.json",
    "notes.txt",
    "img/actor.png",
    "removed.bin",
    ".tmp/stage/hidden.txt",
  ])
    native.write_file_sync(path.join(temp.path, name), "fixture");
  const read = vi.spyOn(native, "read_file");
  expect(
    collect_game_file_list(temp.path, native, undefined, {
      files: new Map([
        ["data/Text.json", null],
        ["staged.bin", null],
      ]),
      excluded: ["removed.bin"],
    }),
  ).toEqual(["data/Text.json", "img/actor.png", "notes.txt", "staged.bin"]);
  expect(read).not.toHaveBeenCalled();
});

it.each(["link", "staged-link", "case", "unsafe", "cancel"])(
  "收集边界失败时拒绝读取：%s",
  (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-files-fail-"));
    const native = new NativeFs();
    native.write_file_sync(path.join(temp.path, "data/System.json"), "{}");
    const staging = path.join(temp.path, ".tmp/stage");
    const controller = new AbortController();
    const writes: string[] = [];
    if (kind === "cancel") controller.abort(new Error("cancel source files"));
    if (kind === "unsafe") writes.push("../outside.json");
    if (kind === "case") {
      writes.push("data/system.json");
      native.write_file_sync(path.join(staging, writes[0]!), "staged");
    }
    if (kind.endsWith("link")) {
      const outside = path.join(temp.path, "outside");
      native.write_file_sync(path.join(outside, "a.ttf"), "outside");
      const base = kind === "link" ? temp.path : staging;
      native.make_dir(base);
      native.create_directory_link(outside, path.join(base, "fonts"));
      if (kind === "staged-link") writes.push("fonts/a.ttf");
    }
    expect(() =>
      collect_game_source_files(
        temp.path,
        ["data", "fonts"],
        (files) => [...files.keys()],
        () => false,
        native,
        controller.signal,
        complete_game_preparation(staging, { writes }).sources,
      ),
    ).toThrow();
  },
);
