import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../native/native-fs";
import { evb_fixture } from "../../test/evb-fixture";
import { discover_sources } from "./source-discovery";

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
