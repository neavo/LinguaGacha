import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { collect_game_source_files } from "./source-files";

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
        { staging, result: { writes } },
      ),
    ).toThrow();
  },
);
