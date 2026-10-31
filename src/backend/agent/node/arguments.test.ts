import { expect, it } from "vitest";
import { split_workspace_command } from "./arguments";

it("保留 npm 参数、空参数、路径和字面 shell 符号", () => {
  expect(
    split_workspace_command(
      String.raw`npm exec -- 'a b' "" pre"fix" C:\task\input -- --x=1 --x=2 && $HOME | >`,
    ),
  ).toEqual([
    "npm",
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
  ]);
  expect(split_workspace_command(String.raw`npm pkg set a\ b "a\"b" 'C:\path\'`)).toEqual([
    "npm",
    "pkg",
    "set",
    "a b",
    'a"b',
    "C:\\path\\",
  ]);
});

it.each(["", "npmx install", "npm.cmd", "node a.js", "C:/node/npm", "npm 'oops", "npm \0"])(
  "拒绝无效入口 %s",
  (command) => {
    expect(() => split_workspace_command(command)).toThrow();
  },
);
