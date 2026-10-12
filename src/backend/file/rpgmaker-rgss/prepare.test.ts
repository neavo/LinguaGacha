import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { rgss_archive_fixture } from "../../../test/rgss-archive-fixture";
import { prepare_rgss_source } from "./prepare";
import { discover_rgss_source, RGSS_ARCHIVES, RGSS_VERSIONS, type RGSSVersion } from "./source";

/** 构造归档与内容不同的散装文件，验证覆盖和恢复的数据来源。 */
function game(
  root: string,
  version: RGSSVersion,
  unpacked = false,
): { archive: string; files: Map<string, Buffer> } {
  const extension = RGSS_VERSIONS[version];
  fs.mkdirSync(path.join(root, "Data"), { recursive: true });
  fs.mkdirSync(path.join(root, "Custom"), { recursive: true });
  fs.writeFileSync(path.join(root, "Game.ini"), "[Game]\nScripts=Custom/Main" + extension);
  fs.writeFileSync(path.join(root, "Custom/Main" + extension), "old script");
  fs.writeFileSync(path.join(root, "Data/Actors" + extension), "old actors");
  if (unpacked) fs.writeFileSync(path.join(root, "Data/System" + extension), "existing system");
  const files = new Map([
    ["Data/System" + extension, Buffer.from("system")],
    ["Data/Actors" + extension, Buffer.from("actors")],
    ["Custom/Main" + extension, Buffer.from("scripts")],
    ["Graphics/picture.png", Buffer.from("picture")],
  ]);
  const archive = path.join(root, "Game" + RGSS_ARCHIVES[version]);
  fs.writeFileSync(archive, rgss_archive_fixture(version === "ace" ? 3 : 1, files));
  return { archive, files };
}

it.each(["xp", "vx", "ace"] as const)(
  "%s 完整解包备份覆盖目标，重复准备直接使用散装来源",
  async (version) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-prepare-"));
    const { archive, files } = game(temp.path, version);
    fs.mkdirSync(path.join(temp.path, "Graphics"));
    fs.writeFileSync(path.join(temp.path, "Graphics/picture.png"), "old picture");
    const native = new NativeFs();
    expect(discover_rgss_source(archive, native)?.version).toBe(version);
    await prepare_rgss_source(archive, native);
    expect(fs.existsSync(archive)).toBe(false);
    for (const [name, bytes] of files)
      expect(fs.readFileSync(path.join(temp.path, name))).toEqual(bytes);
    expect(
      fs.readFileSync(path.join(temp.path, "backup/Data/Actors" + RGSS_VERSIONS[version]), "utf8"),
    ).toBe("old actors");
    expect(
      fs.readFileSync(path.join(temp.path, "backup/Custom/Main" + RGSS_VERSIONS[version]), "utf8"),
    ).toBe("old script");
    expect(fs.readFileSync(path.join(temp.path, "backup/Graphics/picture.png"), "utf8")).toBe(
      "old picture",
    );
    expect(fs.readFileSync(path.join(temp.path, "backup/Game.ini"))).toEqual(
      fs.readFileSync(path.join(temp.path, "Game.ini")),
    );
    await prepare_rgss_source(temp.path, native);
    expect(fs.existsSync(path.join(temp.path, "backup_2"))).toBe(false);
  },
);

it("已有 System 仍完整解包，备份退让并保留归档外的独立文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-ready-"));
  const { archive } = game(temp.path, "ace", true);
  fs.mkdirSync(path.join(temp.path, "backup"));
  fs.writeFileSync(path.join(temp.path, "backup_2"), "occupied");
  fs.writeFileSync(path.join(temp.path, "Data/extra.txt"), "extra");
  const original = fs.readFileSync(archive);
  await prepare_rgss_source(temp.path, new NativeFs());
  expect(fs.readFileSync(path.join(temp.path, "backup_3/Game.rgss3a"))).toEqual(original);
  expect(fs.readFileSync(path.join(temp.path, "Data/System.rvdata2"), "utf8")).toBe("system");
  expect(fs.readFileSync(path.join(temp.path, "backup_3/Data/System.rvdata2"), "utf8")).toBe(
    "existing system",
  );
  expect(fs.readFileSync(path.join(temp.path, "Data/extra.txt"), "utf8")).toBe("extra");
  expect(fs.readFileSync(path.join(temp.path, "backup_3/Data/extra.txt"), "utf8")).toBe("extra");
  expect(fs.readFileSync(path.join(temp.path, "backup_3/Custom/Main.rvdata2"), "utf8")).toBe(
    "old script",
  );
  expect(fs.readFileSync(path.join(temp.path, "Graphics/picture.png"), "utf8")).toBe("picture");
});

it.each(["backup", "extract", "commit", "remove", "cleanup"])(
  "%s 失败保留归档并恢复覆盖与新增文件",
  async (phase) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-rollback-"));
    const { archive } = game(temp.path, "ace");
    const native = new NativeFs();
    if (phase === "backup")
      vi.spyOn(native, "copy_file").mockImplementationOnce(() => {
        throw new Error("backup failure");
      });
    if (phase === "extract") {
      const open = native.open_file.bind(native);
      vi.spyOn(native, "open_file").mockImplementation(async (file, flags) => {
        if (flags === "wx") throw new Error("extract failure");
        return open(file, flags);
      });
    }
    if (phase === "commit") {
      const copy = native.copy_file_atomic.bind(native);
      vi.spyOn(native, "copy_file_atomic").mockImplementation((from, to) => {
        if (to.endsWith("picture.png") && from.includes(".linguagacha-rgss-"))
          throw new Error("commit failure");
        copy(from, to);
      });
    }
    if (phase === "cleanup")
      vi.spyOn(native, "remove_async").mockRejectedValueOnce(new Error("cleanup failure"));
    if (phase === "remove")
      vi.spyOn(native, "unlink").mockImplementationOnce(() => {
        throw new Error("remove failure");
      });
    await expect(prepare_rgss_source(temp.path, native)).rejects.toThrow(phase + " failure");
    expect(fs.existsSync(archive)).toBe(true);
    expect(fs.readFileSync(path.join(temp.path, "Data/Actors.rvdata2"), "utf8")).toBe("old actors");
    expect(fs.readFileSync(path.join(temp.path, "Custom/Main.rvdata2"), "utf8")).toBe("old script");
    expect(fs.existsSync(path.join(temp.path, "Data/System.rvdata2"))).toBe(false);
    expect(fs.existsSync(path.join(temp.path, "Graphics"))).toBe(false);
    expect(fs.readdirSync(temp.path).some((name) => name.startsWith(".linguagacha-rgss-"))).toBe(
      false,
    );
  },
);

it("拒绝经过目录链接的成员，外部文件保持原状", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-link-"));
  const root = path.join(temp.path, "game");
  const { archive } = game(root, "ace");
  const outside = path.join(temp.path, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "picture.png"), "outside");
  new NativeFs().create_directory_link(outside, path.join(root, "Graphics"));
  await expect(prepare_rgss_source(root, new NativeFs())).rejects.toThrow(
    "Unsafe RGSS filesystem path",
  );
  expect(fs.existsSync(archive)).toBe(true);
  expect(fs.readFileSync(path.join(outside, "picture.png"), "utf8")).toBe("outside");
});

it("恢复失败保留备份与暂存材料，错误提供两者位置", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-recovery-"));
  const { archive } = game(temp.path, "ace");
  const native = new NativeFs();
  const copy = native.copy_file_atomic.bind(native);
  vi.spyOn(native, "copy_file_atomic").mockImplementation((from, to) => {
    if (to.endsWith("picture.png")) throw new Error("commit failed");
    if (from.includes("backup")) throw new Error("restore failed");
    copy(from, to);
  });
  await expect(prepare_rgss_source(temp.path, native)).rejects.toThrow(
    /Backup:.*backup[\s\S]*Recovery or cleanup failed:.*restore failed[\s\S]*Staging:/u,
  );
  expect(fs.existsSync(archive)).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "backup/Data/Actors.rvdata2"), "utf8")).toBe(
    "old actors",
  );
  expect(fs.readdirSync(temp.path).some((name) => name.startsWith(".linguagacha-rgss-"))).toBe(
    true,
  );
});

it.each(["engine", "protocol", "directory-system"])("%s 冲突在备份与改写之前失败", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-conflict-"));
  const { archive } = game(temp.path, "ace");
  if (kind === "engine")
    fs.appendFileSync(path.join(temp.path, "Game.ini"), "\nLibrary=RGSS202J.dll");
  if (kind === "protocol")
    fs.writeFileSync(
      archive,
      rgss_archive_fixture(1, new Map([["Data/System.rvdata2", Buffer.from("x")]])),
    );
  if (kind === "directory-system") fs.mkdirSync(path.join(temp.path, "Data/System.rvdata2"));
  await expect(prepare_rgss_source(temp.path, new NativeFs())).rejects.toThrow();
  expect(fs.existsSync(archive)).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "backup"))).toBe(false);
});

it("归档不含 System 也完成合并，数据完整性由原稿解析负责", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-no-system-"));
  const { archive } = game(temp.path, "ace");
  fs.writeFileSync(
    archive,
    rgss_archive_fixture(3, new Map([["Data/Actors.rvdata2", Buffer.from("new actors")]])),
  );
  await prepare_rgss_source(temp.path, new NativeFs());
  expect(fs.existsSync(archive)).toBe(false);
  expect(fs.existsSync(path.join(temp.path, "Data/System.rvdata2"))).toBe(false);
  expect(fs.readFileSync(path.join(temp.path, "Data/Actors.rvdata2"), "utf8")).toBe("new actors");
  expect(fs.readFileSync(path.join(temp.path, "Custom/Main.rvdata2"), "utf8")).toBe("old script");
});
