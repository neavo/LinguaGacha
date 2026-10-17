import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { wolf_files } from "../../../test/wolf-fixture";
import { wolf_archive_fixture } from "../../../test/wolf-archive-fixture";
import { FileFormatService } from "../file-format-service";

it("名为 Data 的游戏根目录仍可识别，单独归档不能成为工程入口", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-source-"));
  const root = path.join(temp.path, "Data"),
    native = new NativeFs();
  for (const [name, bytes] of wolf_files()) native.write_file_sync(path.join(root, name), bytes);
  native.write_file_sync(
    path.join(root, "Data/Picture.wolf"),
    await wolf_archive_fixture(new Map()),
  );
  const service = new FileFormatService({ target_language: "ZH" }, async () => null, native);
  const entries = await service.collect_source_file_entries([root, path.join(root, "Data")]);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.file_type).toBe("WOLF3");
  expect(await service.collect_source_file_entries([path.join(root, "Data/Picture.wolf")])).toEqual(
    [],
  );
});
it("坏游戏边界阻止普通文件递归导入，根归档与分目录归档冲突在准备前失败", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-source-"));
  const native = new NativeFs(),
    root = path.join(temp.path, "game"),
    service = new FileFormatService({ target_language: "ZH" }, async () => null, native);
  native.write_file_sync(path.join(root, "Data/BasicData.wolf"), Buffer.alloc(64));
  native.write_file_sync(path.join(root, "notes.txt"), "must not become an ordinary source");
  const entries = await service.collect_source_file_entries([temp.path]);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.source.kind).toBe("failure");
  native.write_file_sync(path.join(root, "Data.wolf"), await wolf_archive_fixture(new Map()));
  await expect(service.collect_source_file_entries([root])).rejects.toThrow(
    "Conflicting WOLF data archives",
  );
  expect(fs.existsSync(path.join(root, "backup_lg"))).toBe(false);
});
