import { expect, it } from "vitest";
import { wolf_vector, wolf_vectors } from "../../../test/wolf-vectors";
import { restore_wolf_core, restore_wolf_project } from "./protection";
it("拒绝截断保护头", async () => {
  await expect(
    restore_wolf_core("Data/BasicData/Game.dat", Buffer.from([0, 0x50, 0, 0, 0, 0x55])),
  ).rejects.toThrow("Truncated WOLF core protection");
});

it.each(wolf_vectors.cores)(
  "$branch $name seed=$seed 匹配独立解码器",
  async ({ name, input, output, seed }) => {
    const result = await restore_wolf_core("Data/BasicData/" + name, wolf_vector(input));
    expect(result?.bytes.equals(wolf_vector(output))).toBe(true);
    expect(result).toHaveProperty("project_seed", seed);
    expect(await restore_wolf_core("Data/BasicData/" + name, result!.bytes)).toBeNull();
  },
);

it.each(wolf_vectors.projects)(
  "project seed=$seed 保留无符号种子的完整取值",
  async ({ seed, input, output }) => {
    expect((await restore_wolf_project(wolf_vector(input), seed)).equals(wolf_vector(output))).toBe(
      true,
    );
  },
);
it("未知 Pro 标记不能误用 0x57 解码", async () => {
  const input = wolf_vector(
    wolf_vectors.cores.find((vector) => vector.branch === "pro57" && vector.name === "Game.dat")!
      .input,
  );
  input[5] = 0x58;
  await expect(restore_wolf_core("Game.dat", input)).rejects.toThrow(
    "Unsupported WOLF core protection",
  );
});
