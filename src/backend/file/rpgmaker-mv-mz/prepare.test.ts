import { prepare_game_source } from "../shared/game/engines";
import { discover_sources } from "../source-discovery";
import {
  png_fixture,
  media_fixture,
  encrypted_media,
  MEDIA_KEY,
} from "../../../test/media-fixture";
import { discover_rpgmaker_source, type RPGMakerSource } from "./source";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { evb_fixture } from "../../../test/evb-fixture";
import { stage_rpgmaker_source } from "./prepare";

/** 为各准备场景补齐引擎来源身份，统一经过正式目录事务。 */
function prepare_source(game: RPGMakerSource, fs: NativeFs): Promise<void> {
  return prepare_game_source({ kind: "game", file_type: "RPGMAKER_MV_MZ", game }, fs);
}

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

it.each([false, true])("准备 %s 发布明文并清理密文，重复导入不重复准备", async (packed) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-prepare-"));
  const source = fixture(temp.path, packed),
    native = new NativeFs();
  if (!packed) fs.writeFileSync(path.join(temp.path, "www/data/System.json"), "\uFEFF" + SYSTEM);
  const original = packed ? fs.readFileSync(source) : null;
  await prepare_source((await discover_rpgmaker_source(source, native))!, native);
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png")).equals(PLAIN)).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "www/img/a.rpgmvp"))).toBe(false);
  if (packed) expect(fs.readFileSync(source).equals(original!)).toBe(false);
  const system = fs.readFileSync(path.join(temp.path, "www/data/System.json"), "utf8");
  expect(system).toContain('"hasEncryptedImages":false');
  expect(system).toContain('"large":9007199254740993');
  expect(system).toContain('"negative":-0');
  const before = fs.statSync(path.join(temp.path, "www/img/a.png")).mtimeMs;
  await prepare_source((await discover_rpgmaker_source(source, native))!, native);
  expect(fs.statSync(path.join(temp.path, "www/img/a.png")).mtimeMs).toBe(before);
});

it.each(["media", "commit"])("准备失败 %s 恢复原配置、明文与密文", async (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-fail-"));
  const source = fixture(temp.path, false),
    native = new NativeFs();
  if (phase === "media") fs.writeFileSync(path.join(temp.path, "www/img/b.rpgmvp"), "broken");
  if (phase === "commit") {
    const unlink = native.unlink.bind(native);
    vi.spyOn(native, "unlink").mockImplementation((file, options) => {
      unlink(file, options);
      if (file === path.join(temp.path, "www/img/a.rpgmvp")) {
        throw new Error("commit failure");
      }
    });
  }
  await expect(
    prepare_source((await discover_rpgmaker_source(source, native))!, native),
  ).rejects.toThrow();
  expect(fs.readFileSync(path.join(temp.path, "www/data/System.json"), "utf8")).toBe(SYSTEM);
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png"), "utf8")).toBe("old plaintext");
  expect(
    fs.readFileSync(path.join(temp.path, "www/img/a.rpgmvp")).equals(encrypted_media(PLAIN)),
  ).toBe(true);
  if (phase === "media")
    expect(fs.readFileSync(path.join(temp.path, "www/img/b.rpgmvp"), "utf8")).toBe("broken");
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});

it("EVB 同名密文覆盖散装来源，成功后清理正式密文", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-mixed-"));
  fixture(temp.path, false);
  const source = fixture(temp.path, true),
    native = new NativeFs();
  fs.writeFileSync(path.join(temp.path, "www/img/a.rpgmvp"), "invalid loose media");
  await prepare_source((await discover_rpgmaker_source(source, native))!, native);
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png")).equals(PLAIN)).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "www/img/a.rpgmvp"))).toBe(false);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});

it("仅启用音频加密时清理全部音频密文并保留图片", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-audio-"));
  const source = fixture(temp.path, false),
    native = new NativeFs();
  native.write_file_sync(
    path.join(temp.path, "www/data/System.json"),
    JSON.stringify({
      hasEncryptedImages: false,
      hasEncryptedAudio: true,
      encryptionKey: MEDIA_KEY,
    }),
  );
  const media = [
    ["a.rpgmvo", "a.ogg", media_fixture("ogg")],
    ["b.ogg_", "b.ogg", media_fixture("ogg")],
    ["c.rpgmvm", "c.m4a", media_fixture("m4a")],
  ] as const;
  for (const [name, , plain] of media)
    native.write_file_sync(path.join(temp.path, "www/audio", name), encrypted_media(plain));
  await prepare_source((await discover_rpgmaker_source(source, native))!, native);
  for (const [name, output, plain] of media) {
    expect(fs.readFileSync(path.join(temp.path, "www/audio", output)).equals(plain)).toBe(true);
    expect(fs.existsSync(path.join(temp.path, "www/audio", name))).toBe(false);
  }
  expect(
    fs.readFileSync(path.join(temp.path, "www/img/a.rpgmvp")).equals(encrypted_media(PLAIN)),
  ).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png"), "utf8")).toBe("old plaintext");
  expect(
    JSON.parse(fs.readFileSync(path.join(temp.path, "www/data/System.json"), "utf8")),
  ).toMatchObject({
    hasEncryptedImages: false,
    hasEncryptedAudio: false,
  });
});

it.each([false, true])("加密关闭 %s 时保留历史双份、未启用类别与范围外资源", async (disabled) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-scope-"));
  const source = fixture(temp.path, false),
    native = new NativeFs();
  const untouched = new Map([
    ["www/audio/a.rpgmvo", Buffer.from("disabled audio")],
    ["www/img/unknown._png", Buffer.from("unsupported extension")],
    ["outside.rpgmvp", encrypted_media(PLAIN)],
    ["www/img/plain.png", Buffer.from("user plaintext")],
  ]);
  if (disabled) {
    native.write_file_sync(
      path.join(temp.path, "www/data/System.json"),
      SYSTEM.replace('"hasEncryptedImages":true', '"hasEncryptedImages":false'),
    );
    untouched.set("www/img/a.rpgmvp", encrypted_media(PLAIN));
    untouched.set("www/img/a.png", Buffer.from("old plaintext"));
  }
  for (const [name, bytes] of untouched) native.write_file_sync(path.join(temp.path, name), bytes);
  await prepare_source((await discover_rpgmaker_source(source, native))!, native);
  for (const [name, bytes] of untouched)
    expect(fs.readFileSync(path.join(temp.path, name)).equals(bytes)).toBe(true);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});

it("多个密文映射到同一明文时整次失败并保留原目录", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-collision-"));
  const source = fixture(temp.path, false),
    native = new NativeFs();
  native.write_file_sync(path.join(temp.path, "www/img/a.png_"), encrypted_media(PLAIN));
  await expect(
    prepare_source((await discover_rpgmaker_source(source, native))!, native),
  ).rejects.toThrow("Multiple encrypted media sources");
  for (const name of ["a.rpgmvp", "a.png_"])
    expect(
      fs.readFileSync(path.join(temp.path, "www/img", name)).equals(encrypted_media(PLAIN)),
    ).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png"), "utf8")).toBe("old plaintext");
  expect(fs.readFileSync(path.join(temp.path, "www/data/System.json"), "utf8")).toBe(SYSTEM);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});

it("准备沿用显式选择的散装启动器", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-mv-explicit-"));
  fixture(temp.path, false);
  const native = new NativeFs(),
    packed = fixture(temp.path, true),
    original = fs.readFileSync(packed);
  const executable = path.join(temp.path, "Unpacked.exe");
  fs.writeFileSync(executable, "unpacked launcher");
  const game = (await discover_rpgmaker_source(executable, native))!;
  expect(game.executable).toBeUndefined();
  await prepare_source(game, native);
  expect(fs.readFileSync(packed).equals(original)).toBe(true);
  expect(fs.readFileSync(executable, "utf8")).toBe("unpacked launcher");
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png")).equals(PLAIN)).toBe(true);
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
  if (entry.source.kind !== "game" || entry.source.file_type !== "RPGMAKER_MV_MZ")
    throw new Error("Missing game source");
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
