import { expect, it } from "vitest";
import { read_config_title, read_tyrano_config, write_config_title } from "./config";

it.each([
  [';System.title = "ゲームの題名";\n', ';System.title = "Game Title";\n'],
  [";System.title = ゲームの題名\n", ";System.title = Game Title\n"],
  [';System.title = "ゲームの題名"; // 注释\n', ';System.title = "Game Title"; // 注释\n'],
])("标题保留外围引号、分号与注释往返：%j", (source, output) => {
  const config = ";projectID = game\n" + source + ";chSpeed = 30\n";
  expect(read_config_title(config)?.value).toBe("ゲームの題名");
  const written = write_config_title(config, "Game Title");
  expect(written).toBe(";projectID = game\n" + output + ";chSpeed = 30\n");
  expect([...read_tyrano_config(written)]).toEqual([
    ["projectID", "game"],
    ["System.title", "Game Title"],
    ["chSpeed", "30"],
  ]);
});

it("同名配置以最后一行为准，引擎会删除或截断的译文被拒绝", () => {
  const config = ";System.title = 旧\n;System.title = 新\n";
  expect(write_config_title(config, "New")).toBe(";System.title = 旧\n;System.title = New\n");
  for (const value of ['a"b', "a;b", "a=b", "a//b", "a\nb", " a"])
    expect(() => write_config_title(config, value)).toThrow(/cannot represent/u);
});
