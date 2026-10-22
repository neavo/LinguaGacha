import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { archive_fixture } from "../../../test/renpy-fixture";
import { read_archive, read_archive_member, copy_archive_member } from "./archive";

it.each([2, 3])("RPA-%s 的读取和流式复制都保留片段前缀", async (version) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-archive-"));
  const native = new NativeFs(),
    original = Buffer.from("fragmented resource");
  native.write_file_sync(
    path.join(temp.path, "archive.rpa"),
    archive_fixture(new Map([["asset.bin", original]]), version),
  );
  await using input = await native.open_file(path.join(temp.path, "archive.rpa"), "r");
  await using output = await native.open_file(path.join(temp.path, "output.bin"), "wx");
  const member = (await read_archive(input)).get("asset.bin")!;
  expect(await read_archive_member(input, member)).toEqual(original);
  await copy_archive_member(input, output, member);
  expect(native.read_file(path.join(temp.path, "output.bin"))).toEqual(original);
});
it("归档索引拒绝大小写冲突", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-index-"));
  const native = new NativeFs(),
    file = path.join(temp.path, "archive.rpa");
  native.write_file_sync(
    file,
    archive_fixture(
      new Map([
        ["A.txt", Buffer.from("a")],
        ["a.txt", Buffer.from("b")],
      ]),
    ),
  );
  await using input = await native.open_file(file, "r");
  await expect(read_archive(input)).rejects.toThrow();
});
