import { expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeFs } from "../../../native/native-fs";
import { wolf_files } from "../../../test/wolf-fixture";
import { wolf_archive_fixture } from "../../../test/wolf-archive-fixture";
import { FileFormatService } from "../file-format-service";

it.each(["root", "split"])("%s 归档移除后保留空目录及嵌套空目录", async (mode) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-directories-"));
  const native = new NativeFs(),
    files = wolf_files();
  for (const [name, bytes] of files) native.write_file_sync(path.join(temp.path, name), bytes);
  const archives =
    mode === "root" ? ["Data.wolf"] : ["Data/EnemyGraphic.wolf", "Data/BasicData.wolf"];
  if (mode === "root") {
    const members = new Map([...files].map(([name, bytes]) => [name.slice(5), bytes]));
    members.set("EnemyGraphic/", Buffer.alloc(0));
    members.set("BasicData/Nested/Empty/", Buffer.alloc(0));
    native.write_file_sync(path.join(temp.path, archives[0]!), await wolf_archive_fixture(members));
  } else {
    native.write_file_sync(
      path.join(temp.path, archives[0]!),
      await wolf_archive_fixture(new Map()),
    );
    // 两个归档都没有文件，验证目录创建不依赖任何文件提交。
    const members = new Map([["Nested/Empty/", Buffer.alloc(0)]]);
    native.write_file_sync(path.join(temp.path, archives[1]!), await wolf_archive_fixture(members));
  }
  const service = new FileFormatService({ target_language: "ZH" }, async () => null, native);
  await service.prepare_source((await service.collect_source_file_entries([temp.path]))[0]!);
  expect(fs.statSync(path.join(temp.path, "Data/EnemyGraphic")).isDirectory()).toBe(true);
  expect(fs.statSync(path.join(temp.path, "Data/BasicData/Nested/Empty")).isDirectory()).toBe(true);
  for (const archive of archives) expect(fs.existsSync(path.join(temp.path, archive))).toBe(false);
});

it("归档中的数据提示前缀在暂存时移除，准备结果为引擎可读取的原文", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-marker-"));
  const native = new NativeFs(),
    files = wolf_files();
  const game = files.get("Data/BasicData/Game.dat")!;
  files.set(
    "Data/BasicData/Game.dat",
    Buffer.concat([
      Buffer.from("Extracting data from encrypted files violates the guidelines.\0"),
      game,
    ]),
  );
  native.write_file_sync(
    path.join(temp.path, "Data.wolf"),
    await wolf_archive_fixture(
      new Map([...files].map(([name, bytes]) => [name.slice(5), bytes])),
      350,
    ),
  );
  const service = new FileFormatService({ target_language: "ZH" }, async () => null, native);
  await service.prepare_source((await service.collect_source_file_entries([temp.path]))[0]!);
  expect(fs.readFileSync(path.join(temp.path, "Data/BasicData/Game.dat"))).toEqual(game);
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/Data/BasicData/Game.dat"))).toEqual(game);
});

it.each(["unsupported", "core", "map-read", "companion-read"])(
  "准备失败 %s 保留原归档和散装文件并清理工作区",
  async (failure) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-wolf-rollback-"));
    const native = new NativeFs(),
      files = wolf_files(),
      root = temp.path;
    if (failure === "companion-read") {
      files.set("Data/BasicData/DataBase.dat", files.get("Data/BasicData/SysDatabase.dat")!);
      files.set(
        "Data/BasicData/DataBase.project",
        files.get("Data/BasicData/SysDatabase.project")!,
      );
    }
    if (failure === "map-read" || failure === "companion-read") {
      const read = native.read_file.bind(native);
      const suffix = failure === "map-read" ? "Map001.mps" : "DataBase.project";
      vi.spyOn(native, "read_file").mockImplementation((file) => {
        if (file.includes(path.join(".tmp", "stage")) && file.endsWith(suffix))
          throw new Error("staged read failure");
        return read(file);
      });
    }
    if (failure === "core") files.delete("Data/BasicData/SysDatabase.project");
    const packed = await wolf_archive_fixture(
      new Map([...files].map(([name, bytes]) => [name.slice(5), bytes])),
    );
    if (failure === "unsupported") packed.writeUInt32LE((999 << 16) | 2, 44);
    native.write_file_sync(path.join(root, "Data.wolf"), packed);
    native.write_file_sync(path.join(root, "Data/BasicData/CommonEvent.dat"), "original loose");
    const service = new FileFormatService({ target_language: "ZH" }, async () => null, native);
    const entries = await service.collect_source_file_entries([root]);
    await expect(service.prepare_source(entries[0]!)).rejects.toThrow(
      failure === "unsupported"
        ? "crypt=999"
        : failure === "core"
          ? "Missing WOLF companion"
          : "staged read failure",
    );
    expect(fs.readFileSync(path.join(root, "Data.wolf"))).toEqual(packed);
    expect(fs.readFileSync(path.join(root, "Data/BasicData/CommonEvent.dat"), "utf8")).toBe(
      "original loose",
    );
    expect(fs.existsSync(path.join(root, ".tmp"))).toBe(false);
    expect(fs.existsSync(path.join(root, "Data/BasicData/Game.dat"))).toBe(false);
  },
);
