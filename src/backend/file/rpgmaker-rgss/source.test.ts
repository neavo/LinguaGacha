import { expect, it } from "vitest";
import { script_path, read_rgss_game } from "./source";
import { read_rpgmaker_container } from "../rpgmaker-shared";
import { write_zip } from "../../../test/zip-fixture";

it.each(["../Scripts.rvdata2", "C:\\Scripts.rvdata2", "Data/Scripts.rxdata"])(
  "拒绝配置中的越界路径和版本冲突：%s",
  (value) => {
    expect(() => script_path(Buffer.from("[Game]\nScripts=" + value), "ace")).toThrow();
  },
);
it("容器版本由原稿核对，混合版本不能继续解析", async () => {
  const files = await read_rpgmaker_container(
    await write_zip(
      new Map([
        ["Game.ini", "[Game]"],
        ["Data/System.rvdata2", ""],
        ["Data/Actors.rxdata", ""],
      ]),
    ),
    "game.zip",
  );
  await expect(read_rgss_game(files)).rejects.toThrow("Mixed RGSS");
});
