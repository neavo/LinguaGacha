import { discover_sources } from "../source-discovery";
import { png_fixture } from "../../../test/media-fixture";
import { discover_rpgmaker_source } from "./source";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { encrypted_media, evb_fixture, MEDIA_KEY } from "../../../test/evb-fixture";
import { prepare_rpgmaker_source, stage_rpgmaker_source } from "./prepare";
import { FileFormatService } from "../file-format-service";
import JSZip from "jszip";

const PLAIN = png_fixture();
const SYSTEM =
  '{"gameTitle":"原稿","hasEncryptedImages":true,"hasEncryptedAudio":false,"encryptionKey":"' +
  MEDIA_KEY +
  '","large":9007199254740993,"negative":-0}';
/** 加密图片、已存在明文和大整数共同验证准备后固化的原稿。 */
function fixture(root: string, packed: boolean): string {
  const files = new Map([
    ["www/data/System.json", Buffer.from(SYSTEM)],
    ["www/js/rpg_core.js", Buffer.from("// fixture")],
    ["www/img/a.rpgmvp", encrypted_media(PLAIN)],
    ["www/img/a.png", Buffer.from("old plaintext")],
  ]);
  if (packed) {
    const source = path.join(root, "Selected.exe");
    files.set("Selected.exe", Buffer.from("embedded launcher"));
    fs.writeFileSync(source, evb_fixture(files));
    return source;
  }
  for (const [name, bytes] of files) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return root;
}

it.each([false, true])("准备 %s 固化明文配置，清理原封装并保持重复导入无副作用", async (packed) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-prepare-"));
  const source = fixture(temp.path, packed);
  if (!packed) fs.writeFileSync(path.join(temp.path, "www/data/System.json"), "\uFEFF" + SYSTEM);
  const original = packed ? fs.readFileSync(source) : null;
  const service = new FileFormatService({ target_language: "ZH" }, async () => null);
  const entries = await service.collect_source_file_entries([source]);
  expect(entries[0]!.source_path).toBe(source);
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
  const prepared = await service.prepare_source(
    (await service.discover_import_sources([{ source_path: source, rel_path: "game.zip" }]))[0]!,
  );
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png"))).toEqual(PLAIN);
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.rpgmvp"))).toEqual(encrypted_media(PLAIN));
  if (packed) expect(fs.readFileSync(source)).not.toEqual(original);
  expect(fs.existsSync(path.join(temp.path, ".lg-original"))).toBe(false);
  const zip = await JSZip.loadAsync(prepared.content);
  for (const [name, member] of Object.entries(zip.files))
    expect(fs.readFileSync(path.join(temp.path, "backup_lg", name))).toEqual(
      await member.async("nodebuffer"),
    );
  expect(fs.existsSync(path.join(temp.path, "backup_lg/Selected.exe"))).toBe(false);
  const system = await zip.file("www/data/System.json")!.async("string");
  expect(system).toContain('"hasEncryptedImages":false');
  expect(system).toContain('"large":9007199254740993');
  expect(system).toContain('"negative":-0');
  const before = fs.statSync(path.join(temp.path, "www/img/a.png")).mtimeMs;
  await service.prepare_source(
    (await service.discover_import_sources([{ source_path: source, rel_path: "game.zip" }]))[0]!,
  );
  expect(fs.statSync(path.join(temp.path, "www/img/a.png")).mtimeMs).toBe(before);
});

it.each(["media", "commit"])("准备失败 %s 保留原配置和明文", async (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-fail-"));
  const source = fixture(temp.path, false),
    native = new NativeFs();
  if (phase === "media") fs.writeFileSync(path.join(temp.path, "www/img/b.rpgmvp"), "broken");
  if (phase === "commit") {
    const rename = native.rename.bind(native);
    vi.spyOn(native, "rename").mockImplementation((from, to) => {
      rename(from, to);
      if (from.includes(path.join("backup_lg", ".tmp", "stage")) && to.endsWith("a.png")) {
        throw new Error("commit failure");
      }
    });
  }
  await expect(
    prepare_rpgmaker_source((await discover_rpgmaker_source(source, native))!, native),
  ).rejects.toThrow();
  expect(fs.readFileSync(path.join(temp.path, "www/data/System.json"), "utf8")).toBe(SYSTEM);
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png"), "utf8")).toBe("old plaintext");
  expect(fs.readdirSync(temp.path).some((name) => name.startsWith(".linguagacha-"))).toBe(false);
});

it("原稿备份失败保留已解包游戏，重试保存准备后的配置", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-backup-retry-"));
  const source = fixture(temp.path, true);
  const service = new FileFormatService({ target_language: "ZH" }, async () => null);
  const write = NativeFs.prototype.write_file;
  const mock = vi.spyOn(NativeFs.prototype, "write_file").mockImplementation(async function (
    this: NativeFs,
    file,
    bytes,
  ) {
    if (file.endsWith(".linguagacha-backup.json")) throw new Error("backup failure");
    return write.call(this, file, bytes);
  });
  try {
    await expect(
      service.prepare_source((await service.collect_source_file_entries([source]))[0]!),
    ).rejects.toThrow("backup failure");
  } finally {
    mock.mockRestore();
  }
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png"))).toEqual(PLAIN);
  expect(fs.readdirSync(path.join(temp.path, "backup_lg"))).toEqual([]);
  await service.prepare_source((await service.collect_source_file_entries([source]))[0]!);
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/www/data/System.json"), "utf8")).toContain(
    '"hasEncryptedImages":false',
  );
});

it("多个 EVB 入口要求明确选择，同根冲突输入明确失败", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-entries-"));
  const source = fixture(temp.path, true),
    second = path.join(temp.path, "Other.exe");
  fs.copyFileSync(source, second);
  const service = new FileFormatService({ target_language: "ZH" }, async () => null);
  await expect(service.collect_source_file_entries([temp.path])).rejects.toThrow("Multiple EVB");
  await expect(service.collect_source_file_entries([source, second])).rejects.toThrow(
    "Conflicting game",
  );
  expect((await service.collect_source_file_entries([source]))[0]!.source_path).toBe(source);
});

it("显式选择散装启动器时保留入口，不在正式准备时转选同目录封装", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-explicit-"));
  fixture(temp.path, false);
  const packed = fixture(temp.path, true),
    original = fs.readFileSync(packed);
  const executable = path.join(temp.path, "Unpacked.exe");
  fs.writeFileSync(executable, "unpacked launcher");
  const service = new FileFormatService({ target_language: "ZH" }, async () => null);
  const entry = (await service.collect_source_file_entries([executable]))[0]!;
  expect(entry.source_path).toBe(executable);
  await service.prepare_source(entry);
  expect(fs.readFileSync(packed)).toEqual(original);
  expect(fs.readFileSync(executable, "utf8")).toBe("unpacked launcher");
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png"))).toEqual(PLAIN);
});

it("准备消费已识别来源，worker 打开文件后重新核对实际清单", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-identity-"));
  const source = path.join(temp.path, "Game.exe"),
    native = new NativeFs();
  const packed = evb_fixture(
    new Map([
      ["data/System.json", Buffer.from("{}")],
      ["js/rmmz_core.js", Buffer.from("// engine")],
    ]),
  );
  fs.writeFileSync(source, packed);
  const open = vi.spyOn(native, "open_file");
  const entry = (await discover_sources([source], native))[0]!;
  expect(open.mock.calls.filter(([file]) => file === source)).toHaveLength(1);
  if (entry.source.kind !== "mv_mz") throw new Error("Missing game source");
  const staging = path.join(temp.path, "stage");
  fs.mkdirSync(staging);
  fs.writeFileSync(
    source,
    evb_fixture(
      new Map([
        ["www/data/System.json", Buffer.from("{}")],
        ["www/js/rpg_core.js", Buffer.from("// changed engine")],
      ]),
    ),
  );
  await expect(stage_rpgmaker_source({ game: entry.source.game, staging }, native)).rejects.toThrow(
    "identity changed",
  );
  expect(fs.readdirSync(staging)).toEqual([]);
});
