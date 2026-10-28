import { expect, it } from "vitest";
import { order_initialization, RENPY_COMPAT_PRIORITY, RENPY_COMPAT_SCRIPT } from "./initialization";

/** 同一脚本可有多个声明，排序须保留它们的相对顺序。 */
const at = (file: string, priority = 0, early = false) => ({ file, early, priority });
const files = (entries: readonly { file: string; priority: number; early: boolean }[]) =>
  entries.map((entry) => entry.file);

it("早期代码先于 Init，Init 按优先级稳定排序，同优先级按脚本加载顺序并保留声明顺序", () => {
  const first = at("game/b.rpyc"),
    second = at("game/b.rpyc");
  const ordered = order_initialization(
    [at("game/z.rpyc"), at("game/a.rpyc", 100), first, at("game/z.rpyc", 0, true), second],
    { script_order: "filename" },
    new Set(),
  );
  expect(ordered.map((entry) => [entry.file, entry.priority, entry.early])).toEqual([
    ["game/z.rpyc", 0, true],
    ["game/b.rpyc", 0, false],
    ["game/b.rpyc", 0, false],
    ["game/z.rpyc", 0, false],
    ["game/a.rpyc", 100, false],
  ]);
  expect(ordered.indexOf(first)).toBeLessThan(ordered.indexOf(second));
});

it("旧引擎把兼容脚本与游戏脚本一并按脚本名排序，新引擎先加载公共脚本再按库、游戏与模组分组", () => {
  const entries = [
    "game/mods/a/z.rpyc",
    "game/mods/z/a.rpyc",
    "game/z.rpyc",
    "game/libs/z.rpyc",
    "game/00start.rpyc",
    "game/000.rpyc",
  ].map((file) => at(file, RENPY_COMPAT_PRIORITY));
  entries.push(at(RENPY_COMPAT_SCRIPT, RENPY_COMPAT_PRIORITY));
  expect(files(order_initialization(entries, { script_order: "filename" }, new Set()))).toEqual([
    "game/000.rpyc",
    RENPY_COMPAT_SCRIPT,
    "game/00start.rpyc",
    "game/libs/z.rpyc",
    "game/mods/a/z.rpyc",
    "game/mods/z/a.rpyc",
    "game/z.rpyc",
  ]);
  const markers = new Set(["game/libs/libs.txt", "game/mods/mods.txt"]);
  expect(files(order_initialization(entries, { script_order: "grouped" }, markers))).toEqual([
    RENPY_COMPAT_SCRIPT,
    "game/libs/z.rpyc",
    "game/000.rpyc",
    "game/00start.rpyc",
    "game/z.rpyc",
    "game/mods/z/a.rpyc",
    "game/mods/a/z.rpyc",
  ]);
  expect(files(order_initialization(entries, { script_order: "grouped" }, new Set()))).toEqual([
    RENPY_COMPAT_SCRIPT,
    "game/000.rpyc",
    "game/00start.rpyc",
    "game/libs/z.rpyc",
    "game/mods/a/z.rpyc",
    "game/mods/z/a.rpyc",
    "game/z.rpyc",
  ]);
});
