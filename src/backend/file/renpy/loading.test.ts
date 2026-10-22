import { expect, it } from "vitest";
import { code_fixture } from "../../../test/renpy-fixture";
import { read_compiled } from "./compiled";
import { read_loading, resolve_loading } from "./loading";
import { PythonSession } from "./python-syntax";
const profile = { archives: "top-level", script_order: "filename" } as const;

it("加载声明按早期执行、初始化优先级、文件名和代码顺序归并", async () => {
  using session = await PythonSession.create();
  const declarations: Awaited<ReturnType<typeof read_loading>>["declarations"] = [];
  for (const [file, source, context, priority] of [
    ["game/z.rpyc", "config.archives = ['z']", "init", 0],
    ["game/a.rpyc", "config.archives = ['a']\nconfig.archives = ['last']", "init", 100],
    ["game/early.rpyc", "config.archives = ['early']", "early", 0],
  ] as const) {
    const result = await read_loading(
      { slots: read_compiled(code_fixture(source, context, priority)), python2: false },
      file,
      profile,
      session,
    );
    declarations.push(...result.declarations);
  }
  expect(resolve_loading(declarations, profile, new Set())).toEqual({
    archives: ["last"],
    force: false,
  });
  expect(
    resolve_loading(
      declarations.map((entry) => ({ ...entry, priority: 0 })),
      profile,
      new Set(),
    ),
  ).toEqual({
    archives: ["z"],
    force: false,
  });
});

it("读取配置和动态业务代码不产生声明或改写", async () => {
  using session = await PythonSession.create();
  const bytes = code_fixture(
    "original = config.force_archives\nsettings = config\nvalues = actor.__dict__\nconfig.archives = choose()\ndef configure():\n    config.force_archives = True",
  );
  expect(
    await read_loading(
      { slots: read_compiled(bytes), python2: false },
      "game/test.rpyc",
      profile,
      session,
    ),
  ).toEqual({ declarations: [], changes: [] });
  expect(
    await read_loading(
      { slots: read_compiled(code_fixture("config.archives = ['../unused']")), python2: false },
      "game/test.rpyc",
      { archives: "recursive" },
      session,
    ),
  ).toEqual({ declarations: [], changes: [] });
});

it("新引擎按库、游戏与模组排序，同组使用去掉包目录的脚本名", async () => {
  using session = await PythonSession.create();
  const declarations: Awaited<ReturnType<typeof read_loading>>["declarations"] = [];
  for (const file of [
    "game/mods/a/z.rpyc",
    "game/mods/z/a.rpyc",
    "game/z.rpyc",
    "game/libs/z.rpyc",
  ]) {
    const result = await read_loading(
      {
        slots: read_compiled(
          code_fixture(
            `config.force_archives = ${file === "game/mods/a/z.rpyc" ? "True" : "False"}`,
          ),
        ),
        python2: false,
      },
      file,
      profile,
      session,
    );
    declarations.push(...result.declarations);
  }
  expect(
    resolve_loading(
      declarations,
      { ...profile, script_order: "grouped" },
      new Set(["game/libs/libs.txt", "game/mods/mods.txt"]),
    ).force,
  ).toBe(true);
  expect(resolve_loading(declarations, profile, new Set()).force).toBe(false);
});
