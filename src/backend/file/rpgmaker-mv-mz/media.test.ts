import { encrypted_media, MEDIA_KEY } from "../../../test/media-fixture";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { BINARY_IO_CHUNK_BYTES } from "../shared/binary";
import { decrypt_media } from "./media";

it("固定向量只还原载荷前十六字节，其余字节原样保留", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-media-vector-"));
  const source = path.join(temp.path, "asset.png_"),
    target = path.join(temp.path, "asset.png");
  fs.writeFileSync(
    source,
    Buffer.from("5250474d560000000003010000000000" + "ffc9ddd344452c31c1dfaabacdddeefe00", "hex"),
  );
  await decrypt_media(source, target, MEDIA_KEY, new NativeFs());
  expect(fs.readFileSync(target).toString("hex")).toBe("ffd8ffe000104a46494600010100000100");
});

it.each([
  [0, "png"],
  [1, "ogg"],
  [15, "m4a"],
  [16, "png"],
  [17, "ogg"],
  [BINARY_IO_CHUNK_BYTES + 17, "m4a"],
])("%i 字节载荷输出为 .%s 时按原字节还原，不受扩展名约束", async (length, extension) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-media-"));
  const plain = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + 11) & 255));
  const source = path.join(temp.path, "encrypted"),
    target = path.join(temp.path, "asset." + extension);
  fs.writeFileSync(source, encrypted_media(plain));
  await decrypt_media(source, target, MEDIA_KEY, new NativeFs());
  expect(fs.readFileSync(target).equals(plain)).toBe(true);
});

it.each(["key", "header", "truncated"])("无效 %s 在创建输出前失败", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-media-bad-"));
  let bytes = encrypted_media(Buffer.alloc(16));
  if (kind === "truncated") bytes = bytes.subarray(0, 15);
  if (kind === "header") bytes[0] = 0;
  const source = path.join(temp.path, "asset.png_"),
    target = path.join(temp.path, "asset.png");
  fs.writeFileSync(source, bytes);
  await expect(
    decrypt_media(source, target, kind === "key" ? "bad" : MEDIA_KEY, new NativeFs()),
  ).rejects.toThrow();
  expect(fs.existsSync(target)).toBe(false);
});
