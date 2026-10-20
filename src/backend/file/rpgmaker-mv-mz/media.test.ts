import { media_fixture, encrypted_media, MEDIA_KEY } from "../../../test/media-fixture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { decrypt_media } from "./media";

it.each([
  ["rpgmvp", "png"],
  ["png_", "png"],
  ["rpgmvo", "ogg"],
  ["ogg_", "ogg"],
  ["rpgmvm", "m4a"],
] as const)("%s 解密为 %s 并保留协议夹具字节", async (encrypted, extension) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-media-"));
  const plain = media_fixture(extension);
  const source = path.join(temp.path, "asset." + encrypted),
    target = path.join(temp.path, "asset." + extension);
  fs.writeFileSync(source, encrypted_media(plain));
  await decrypt_media(source, target, MEDIA_KEY, new NativeFs());
  expect(fs.readFileSync(target).equals(plain)).toBe(true);
});

it.each([
  ["png", 8],
  ["png", 15],
  ["ogg", 6],
  ["ogg", 15],
  ["m4a", 3],
] as const)("签名正确但受加密字段损坏 %s/%s 时拒绝创建明文", async (extension, offset) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-media-key-"));
  const plain = media_fixture(extension);
  const source = path.join(temp.path, "encrypted"),
    target = path.join(temp.path, "asset." + extension);
  fs.writeFileSync(source, encrypted_media(plain));
  const key = Buffer.from(MEDIA_KEY, "hex");
  key[offset] = key[offset]! ^ 1;
  await expect(decrypt_media(source, target, key.toString("hex"), new NativeFs())).rejects.toThrow(
    "structure validation failed",
  );
  expect(fs.existsSync(target)).toBe(false);
});

it("Ogg 截断页与损坏 CRC 拒绝创建输出", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-media-ogg-"));
  const plain = media_fixture("ogg");
  const source = path.join(temp.path, "encrypted"),
    target = path.join(temp.path, "out.ogg");
  for (const broken of [plain.subarray(0, 28), Buffer.from(plain)]) {
    if (broken.length > 28) broken[22] = broken[22]! ^ 1;
    fs.writeFileSync(source, encrypted_media(broken));
    await expect(decrypt_media(source, target, MEDIA_KEY, new NativeFs())).rejects.toThrow();
    expect(fs.existsSync(target)).toBe(false);
  }
});

it.each(["key", "header", "truncated", "signature"])(
  "无效媒体 %s 在生成明文前失败",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-media-bad-"));
    let bytes = encrypted_media(Buffer.alloc(32));
    if (kind === "truncated") bytes = bytes.subarray(0, 31);
    if (kind === "header") bytes[0] = 0;
    const source = path.join(temp.path, "asset.png_"),
      target = path.join(temp.path, "asset.png");
    fs.writeFileSync(source, bytes);
    await expect(
      decrypt_media(source, target, kind === "key" ? "bad" : MEDIA_KEY, new NativeFs()),
    ).rejects.toThrow();
    expect(fs.existsSync(target)).toBe(false);
  },
);
