import { expect, it } from "vitest";
import { wolf_command } from "../../../test/wolf-fixture";
import { WolfReader } from "./binary";
import { read_wolf_command } from "./commands";

it("用途保护资源和程序参数，注释只进入可读原稿", () => {
  const commands = [
    wolf_command(150, ["显示"], [2 << 4]),
    wolf_command(150, ["文件"], [0]),
    wolf_command(122, ["赋值"], [0, 0]),
    wolf_command(122, ["搜索"], [0, 8 << 8]),
    wolf_command(300, ["事件名称"], []),
    wolf_command(103, ["注释"]),
    wolf_command(999, ["未知参数"]),
  ];
  const reader = new WolfReader(Buffer.concat(commands));
  const parsed = commands.map((_, command) =>
    read_wolf_command(reader, { kind: "common_command", event: 0, command }, false),
  );
  reader.done();
  expect(reader.slots.map(({ text, usage }) => [text, usage])).toEqual([
    ["显示", "text"],
    ["文件", "metadata"],
    ["赋值", "text"],
    ["搜索", "metadata"],
    ["事件名称", "metadata"],
    ["未知参数", "metadata"],
  ]);
  expect(JSON.stringify(parsed)).toContain("注释");
});
