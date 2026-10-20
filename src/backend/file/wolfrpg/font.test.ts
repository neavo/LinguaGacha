import { expect, it } from "vitest";
import { wolf_game } from "../../../test/wolf-fixture";
import { wolf_font_outputs } from "./font";
import { read_wolf_game } from "./game-data";

it("WOLF 字体输出把四个字体槽位写成字体族名，并覆盖原字体文件", () => {
  const bytes = new Uint8Array([1, 2]);
  const outputs = wolf_font_outputs(
    new Map([["Data/BasicData/Game.dat", wolf_game(14, true)]]),
    new Map([["CUSTOM.TTF", new Uint8Array([9])]]),
    { bytes, file_name: "custom.ttf", families: ["Custom Gothic"] },
  );
  const game = read_wolf_game(outputs.get("Data/BasicData/Game.dat")!);
  expect((game.details as { fields: Record<number, string> }).fields).toMatchObject({
    3: "Custom Gothic",
    4: "Custom Gothic",
    5: "Custom Gothic",
    6: "Custom Gothic",
  });
  expect(outputs.get("CUSTOM.TTF")).toEqual(bytes);
});
