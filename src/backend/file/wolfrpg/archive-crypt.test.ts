import { createHash } from "node:crypto";
import { aes_ctr } from "./crypt";
import { expect, it } from "vitest";
import { wolf_crypt_vectors, wolf_vector } from "../../../test/wolf-crypt-fixture";
import { aes_keys, derive_archive_key, generate_key, type WolfKeyType } from "./archive-crypt";

it.each(wolf_crypt_vectors.keys)("$type 密钥派生匹配独立参考字节", async ({ type, input, key }) => {
  expect(await derive_archive_key(wolf_vector(input), type as WolfKeyType)).toEqual(
    Buffer.from(key, "hex"),
  );
  await expect(
    derive_archive_key(wolf_vector(input).subarray(0, 20), type as WolfKeyType),
  ).rejects.toThrow();
});

it.each(wolf_crypt_vectors.archiveKeys)(
  "$version 的 tail、内层流和 AES 参数匹配独立向量",
  ({ version, key, output }) => {
    const bytes = Buffer.from(key, "hex"),
      tail = bytes.subarray(bytes.indexOf(0) + 1),
      pw = Uint8Array.from({ length: 15 }, (_, i) => i + 1);
    const aes = aes_keys(pw, version, tail);
    expect(
      Buffer.concat([generate_key(pw, false, version, undefined, tail), aes.key, aes.iv]),
    ).toEqual(wolf_vector(output));
  },
);

// 固定输入向量由仓库外 UberWolf 对照探针生成，不依赖本测试的归档编码器。
it.each([
  [
    331,
    [
      "634ac6a20d7604bfe4ab7fa6129fc2568cdf45b838af69869e3c7a048a13d73d",
      "656c36fb48196674ccbdd752b98f801f16205fc9f85255b66f64f5397f11802f",
      "9a2ca7c31fe4b4023615b6f824306f054635161da5ebf41851f44c546fbfd335",
      "5b1e370e2a9b92ac3a57aa94a86984d8321c001cda00f1125252ef19bac98a06",
    ],
  ],
  [
    350,
    [
      "a63e50f4ef530766a59570ddf6da1b4fb6a57510afaca18945d5109029dca267",
      "a74b59b32f423d785ae75f251b375352bc2f7e41749b2c0dccc5f120670b0b76",
      "008e674fbbe517738fb0e2e618db14c82e8c45d9bb590d33477c0c09c3cd5c96",
      "33e20de2cff6238dfedc4e77df8525cf2900234bb8b1b7e88d3c6ed35623e73f",
    ],
  ],
] as const)("加密 %i 的密钥派生、修改版 AES 扩展与 CTR 匹配独立向量", async (version, expected) => {
  const pw = Uint8Array.from({ length: 15 }, (_, i) => i + 1);
  const values = [
    generate_key(pw, false, version),
    generate_key(pw, true, version),
    aes_keys(pw, version).key,
    await aes_ctr(Buffer.alloc(128, 42), aes_keys(pw, version), 2),
  ];
  expect(values.map((bytes) => createHash("sha256").update(bytes).digest("hex"))).toEqual(expected);
});
