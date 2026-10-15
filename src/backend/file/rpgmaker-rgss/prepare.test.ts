import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { rgss_archive_fixture } from "../../../test/rgss-archive-fixture";
import { FileFormatService } from "../file-format-service";
import JSZip from "jszip";
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
  "%s 完整解包后备份原稿，重复准备直接使用散装来源",
  async (version) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-prepare-"));
    const { archive, files } = game(temp.path, version);
    fs.mkdirSync(path.join(temp.path, "Graphics"));
    fs.writeFileSync(path.join(temp.path, "Graphics/picture.png"), "old picture");
    const native = new NativeFs();
    expect(discover_rgss_source(archive, native)?.version).toBe(version);
    const service = new FileFormatService({ target_language: "ZH" }, async () => null);
    const prepared = await service.prepare_source(
      (await service.collect_source_file_entries([archive]))[0]!,
    );
    const zip = await JSZip.loadAsync(prepared.content);
    for (const [name, member] of Object.entries(zip.files))
      expect(fs.readFileSync(path.join(temp.path, "backup_lg", name))).toEqual(
        await member.async("nodebuffer"),
      );
    expect(fs.existsSync(path.join(temp.path, ".lg-original"))).toBe(false);
    expect(fs.existsSync(path.join(temp.path, "backup_lg/.tmp"))).toBe(false);
    expect(fs.existsSync(archive)).toBe(false);
    for (const [name, bytes] of files)
      expect(fs.readFileSync(path.join(temp.path, name))).toEqual(bytes);
    expect(
      fs.readFileSync(
        path.join(temp.path, "backup_lg/Custom/Main" + RGSS_VERSIONS[version]),
        "utf8",
      ),
    ).toBe("scripts");
    expect(fs.existsSync(path.join(temp.path, "backup_lg/Graphics"))).toBe(false);
    const prepared_entries = fs.readdirSync(temp.path);
    await prepare_rgss_source(discover_rgss_source(temp.path, native)!, native);
    expect(fs.readdirSync(temp.path)).toEqual(prepared_entries);
  },
);

it("已有 System 仍完整解包，保留旧备份和归档外的独立文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-ready-"));
  const { archive } = game(temp.path, "ace", true);
  fs.mkdirSync(path.join(temp.path, "backup"));
  fs.writeFileSync(path.join(temp.path, "backup_2"), "occupied");
  fs.writeFileSync(path.join(temp.path, "Data/extra.txt"), "extra");
  await prepare_rgss_source(discover_rgss_source(temp.path, new NativeFs())!, new NativeFs());
  expect(fs.existsSync(archive)).toBe(false);
  expect(fs.readFileSync(path.join(temp.path, "Data/System.rvdata2"), "utf8")).toBe("system");
  expect(fs.readFileSync(path.join(temp.path, "Data/extra.txt"), "utf8")).toBe("extra");
  expect(fs.readdirSync(path.join(temp.path, "backup"))).toEqual([]);
  expect(fs.readFileSync(path.join(temp.path, "backup_2"), "utf8")).toBe("occupied");
  expect(fs.readFileSync(path.join(temp.path, "Graphics/picture.png"), "utf8")).toBe("picture");
});

it("归档提取失败保留独立数据与归档", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-extract-"));
  const { archive } = game(temp.path, "ace");
  const native = new NativeFs();
  const open = native.open_file.bind(native);
  vi.spyOn(native, "open_file").mockImplementation(async (file, flags) => {
    if (flags === "wx") throw new Error("extract failure");
    return open(file, flags);
  });
  await expect(
    prepare_rgss_source(discover_rgss_source(temp.path, native)!, native),
  ).rejects.toThrow("extract failure");
  expect(fs.existsSync(archive)).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "Data/Actors.rvdata2"), "utf8")).toBe("old actors");
  expect(fs.readFileSync(path.join(temp.path, "Custom/Main.rvdata2"), "utf8")).toBe("old script");
  expect(fs.existsSync(path.join(temp.path, "Data/System.rvdata2"))).toBe(false);
  expect(fs.existsSync(path.join(temp.path, "backup_lg/.tmp"))).toBe(false);
});

it("拒绝经过目录链接的成员，外部文件保持原状", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-link-"));
  const root = path.join(temp.path, "game");
  const { archive } = game(root, "ace");
  const outside = path.join(temp.path, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "picture.png"), "outside");
  new NativeFs().create_directory_link(outside, path.join(root, "Graphics"));
  await expect(
    prepare_rgss_source(discover_rgss_source(root, new NativeFs())!, new NativeFs()),
  ).rejects.toThrow("Unsafe game filesystem path");
  expect(fs.existsSync(archive)).toBe(true);
  expect(fs.readFileSync(path.join(outside, "picture.png"), "utf8")).toBe("outside");
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
  await expect(
    (async () =>
      prepare_rgss_source(discover_rgss_source(temp.path, new NativeFs())!, new NativeFs()))(),
  ).rejects.toThrow();
  expect(fs.existsSync(archive)).toBe(true);
  expect(
    fs
      .readdirSync(temp.path)
      .some((name) => name.startsWith(".linguagacha-") || name.startsWith(".lg-original")),
  ).toBe(false);
});

it("归档不含 System 也完成合并，数据完整性由原稿解析负责", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-no-system-"));
  const { archive } = game(temp.path, "ace");
  fs.writeFileSync(
    archive,
    rgss_archive_fixture(3, new Map([["Data/Actors.rvdata2", Buffer.from("new actors")]])),
  );
  await prepare_rgss_source(discover_rgss_source(temp.path, new NativeFs())!, new NativeFs());
  expect(fs.existsSync(archive)).toBe(false);
  expect(fs.existsSync(path.join(temp.path, "Data/System.rvdata2"))).toBe(false);
  expect(fs.readFileSync(path.join(temp.path, "Data/Actors.rvdata2"), "utf8")).toBe("new actors");
  expect(fs.readFileSync(path.join(temp.path, "Custom/Main.rvdata2"), "utf8")).toBe("old script");
});
