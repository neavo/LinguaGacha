import { expect, it } from "vitest";
import { createCipheriv } from "node:crypto";
import { chacha20_xor, wolf_sha512 } from "./crypt";

it.each([0, 63, 65531, 131077])("ChaCha20 在偏移 %i 与 Node 原生算法一致", (start) => {
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i)),
    nonce = Buffer.from("000000090000004a00000000", "hex"),
    iv = Buffer.alloc(16);
  iv.writeUInt32LE(1 + Math.floor(start / 64));
  nonce.copy(iv, 4);
  const cipher = createCipheriv("chacha20", key, iv);
  cipher.update(Buffer.alloc(start % 64));
  const input = Buffer.alloc(65541, 42);
  expect(chacha20_xor(Buffer.from(input), key, nonce, start).equals(cipher.update(input))).toBe(
    true,
  );
});

it("修改版 SHA512 匹配固定 C++ 参考摘要", () => {
  expect(
    wolf_sha512(Buffer.concat([Buffer.from([0x45, 1, 0x32, 0x23]), Buffer.from("basicD1")])),
  ).toBe(
    "75f210aa1a0b5e24d9c71e72f0d32be60197e1736ba536ba70f7295b0502e77909d9d862cbb6344894951c9c7154eb51baf6a1dfa4c55dad0fc3bfcd62587fa2",
  );
});
