import { expect, it } from "vitest";
import { wolf_crypt_vectors } from "../../../test/wolf-crypt-vectors";
import { wolf_vector } from "../../../test/wolf-crypt-fixture";
import { restore_wolf_core, restore_wolf_project } from "./protection";
import { read_wolf_game } from "./game-data";

it.each(wolf_crypt_vectors.cores)(
  "$name 保护还原匹配独立参考并保持二次准备幂等",
  async ({ name, input, output }) => {
    const filename = "Data/BasicData/" + name;
    const result = await restore_wolf_core(filename, wolf_vector(input));
    expect(result?.protected).toBe(true);
    expect(result!.bytes.equals(wolf_vector(output))).toBe(true);
    expect(await restore_wolf_core(filename, result!.bytes)).toBeNull();
    if (name === "Game.dat") expect(() => read_wolf_game(result!.bytes)).not.toThrow();
  },
);

it("拒绝历史保护和截断，project RNG 从零重新开始", async () => {
  await expect(
    restore_wolf_core("Data/BasicData/Game.dat", Buffer.from([0, 0x50, 0, 0, 0, 0x55])),
  ).rejects.toThrow("Unsupported WOLF core protection");
  // MSVC srand(0) 的前八次低字节，独立于生产 RNG。
  expect(
    (await restore_wolf_project(Buffer.alloc(8))).equals(Buffer.from("2627f6859715ad1d", "hex")),
  ).toBe(true);
});
