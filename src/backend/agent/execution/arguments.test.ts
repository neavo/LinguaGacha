import { expect, it } from "vitest";
import { parse_workspace_command } from "./arguments";

it("登记命令映射到随附 CLI，并保留空参数、路径和字面 shell 符号", () => {
  expect(
    parse_workspace_command(
      String.raw`npm exec -- 'a b' "" pre"fix" C:\task\input -- --x=1 --x=2 && $HOME | >`,
    ),
  ).toEqual({
    entry: "npm/bin/npm-cli.js",
    args: [
      "exec",
      "--",
      "a b",
      "",
      "prefix",
      String.raw`C:\task\input`,
      "--",
      "--x=1",
      "--x=2",
      "&&",
      "$HOME",
      "|",
      ">",
    ],
  });
  expect(parse_workspace_command(String.raw`npm pkg set a\ b "a\"b" 'C:\path\'`).args).toEqual([
    "pkg",
    "set",
    "a b",
    'a"b',
    "C:\\path\\",
  ]);
});

it.each([
  "",
  "npmx install",
  "npm.cmd",
  "node a.js",
  "C:/node/npm",
  "toString",
  "npm 'oops",
  "npm \0",
])("拒绝无效入口 %s", (command) => {
  expect(() => parse_workspace_command(command)).toThrow();
});
