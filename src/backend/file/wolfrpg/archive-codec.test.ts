import { expect, it } from "vitest";
import { wolf_huffman_fixture, wolf_dx_lz_fixture } from "../../../test/wolf-archive-fixture";
import { decompress_huffman, decompress_dx_lz } from "./archive-codec";

it("Huffman 还原数据并拒绝截断的位流", async () => {
  const bytes = Buffer.from("日本語とバイナリ\0"),
    packed = wolf_huffman_fixture(bytes);
  expect(await decompress_huffman(packed)).toEqual(bytes);
  await expect(decompress_huffman(packed.subarray(0, -1))).rejects.toThrow();
});

it("DX LZ 还原转义零字节并拒绝越界回溯", async () => {
  const bytes = Buffer.from([0, 1, 0, 255]);
  expect(await decompress_dx_lz(wolf_dx_lz_fixture(bytes))).toEqual(bytes);
  await expect(
    decompress_dx_lz(Buffer.from([4, 0, 0, 0, 12, 0, 0, 0, 255, 255, 0, 0])),
  ).rejects.toThrow();
});
