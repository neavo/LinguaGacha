import { complete_game_preparation } from "../shared/game/preparation";
import { read_compiled, write_compiled } from "./compiled";
import { read_renpy_format_metadata } from "./profile";
import { RENPY_LANGUAGE_FILE, RENPY_GENERATED_MARKER } from "./generated";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_renpy_fixture, compiled_fixture, code_fixture } from "../../../test/renpy-fixture";
import {
  prepare_renpy_import,
  discover_renpy_source,
  collect_renpy_files,
  collect_renpy_fonts,
} from "./source";

it("游戏入口共用身份，收集时排除缓存和已生成资源", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-discover-"));
  const native = create_renpy_fixture(temp.path),
    game = (await discover_renpy_source(temp.path, native))!;
  expect(await discover_renpy_source(path.join(temp.path, "Game.exe"), native)).toEqual(game);
  expect(await discover_renpy_source(path.join(temp.path, "game"), native)).toEqual(game);
  const before = collect_renpy_files(game, native);
  const generated = path.join(temp.path, RENPY_LANGUAGE_FILE);
  native.write_file_sync(generated, RENPY_GENERATED_MARKER + "\n");
  native.write_file_sync(generated + "c", compiled_fixture());
  native.write_file_sync(path.join(temp.path, "game/cache/unused.rpyc"), "not a compiled script");
  expect(collect_renpy_files(game, native)).toEqual(before);
  native.write_file_sync(generated, "unrelated source");
  expect(() => collect_renpy_files(game, native)).toThrow("Reserved Ren'Py file conflict");
});
type Script = readonly [
  file: string,
  source: string,
  context?: "init" | "early" | "runtime" | "conditional",
  priority?: number,
];
/** 用测试自有快照执行新建导入的联合分析，只观察最终百分号设置。 */
async function substitutions(
  scripts: readonly Script[],
  {
    version,
    markers = [],
    complete = true,
    grouped = false,
    extra = new Map<string, Uint8Array>(),
  }: {
    version?: string;
    markers?: readonly string[];
    complete?: boolean;
    grouped?: boolean;
    extra?: ReadonlyMap<string, Uint8Array>;
  } = {},
): Promise<boolean> {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-semantics-"));
  const native = create_renpy_fixture(temp.path);
  if (grouped) {
    const script = path.join(temp.path, "renpy/script.py");
    native.write_file_sync(
      script,
      native.read_text_file(script) + "\nself.script_files.sort(key=game_key)\n",
    );
  }
  const game = (await discover_renpy_source(temp.path, native))!;
  const data = new Map<string, Uint8Array>(
    scripts.map(([file, source, context, priority]) => [
      file,
      code_fixture(source, context ?? "init", priority ?? 0),
    ]),
  );
  for (const [name, bytes] of extra) data.set(name, bytes);
  if (version !== undefined) data.set("game/script_version.txt", Buffer.from(version));
  const imported = await prepare_renpy_import(
    game,
    { data, files: [...data.keys(), ...markers], complete },
    native,
  );
  return read_renpy_format_metadata(imported.metadata).old_substitutions;
}

it.each([
  ["配置路径", [["game/a.rpyc", "config.old_substitutions = False"]], false],
  ["引擎模块路径", [["game/a.rpyc", "renpy.config.old_substitutions = False"]], false],
  ["无法静态求值", [["game/a.rpyc", "config.old_substitutions = choose()"]], true],
  ["条件体", [["game/a.rpyc", "config.old_substitutions = False", "conditional"]], true],
  ["运行时语句", [["game/a.rpyc", "config.old_substitutions = False", "runtime"]], true],
  [
    "导入、只读访问与局部同名变量",
    [
      [
        "game/a.rpyc",
        "from renpy.store import renpy, config\nvalue = config.old_substitutions\ndef f(self):\n    config = self.get_displayable_config()\n    config.old_substitutions = False",
      ],
    ],
    true,
  ],
  [
    "同一脚本后者覆盖前者",
    [["game/a.rpyc", "config.old_substitutions = False\nconfig.old_substitutions = True"]],
    true,
  ],
  [
    "跨脚本按初始化优先级覆盖",
    [
      ["game/a.rpyc", "config.old_substitutions = False", "init", 10],
      ["game/z.rpyc", "config.old_substitutions = True", "init", 0],
    ],
    false,
  ],
  [
    "早期代码先于全部初始化",
    [
      ["game/a.rpyc", "config.old_substitutions = True", "init", -999],
      ["game/z.rpyc", "config.old_substitutions = False", "early"],
    ],
    true,
  ],
] as const)("游戏设置：%s", async (_case, scripts, expected) => {
  expect(await substitutions(scripts)).toBe(expected);
});

it.each([
  ["区间下界之外", "(6, 12, 2)", true],
  ["区间内", "(6, 13, 0)", false],
  ["区间上界", "(6, 13, 8)", false],
  ["区间上界之外", "(6, 13, 9)", true],
  ["无法确定的内容", "6.13.0", true],
])("兼容版本文件%s", async (_case, version, expected) => {
  expect(await substitutions([], { version })).toBe(expected);
});

it.each([
  [
    "游戏在兼容设置后恢复",
    [["game/a.rpyc", "config.old_substitutions = True"]],
    "(6, 13, 0)",
    true,
  ],
  [
    "游戏在兼容设置前恢复",
    [["game/a.rpyc", "config.old_substitutions = True", "init", -1100]],
    "(6, 13, 0)",
    false,
  ],
  [
    "无法求值的位置采用兼容默认",
    [["game/a.rpyc", "config.old_substitutions = choose()"]],
    "(6, 13, 0)",
    false,
  ],
  [
    "游戏静态设置脚本版本",
    [["game/a.rpyc", "config.script_version = (6, 13, 0)"]],
    undefined,
    false,
  ],
  [
    "区间外版本不重置既有设置",
    [["game/a.rpyc", "renpy.config.script_version = (7, 0, 0)"]],
    "(6, 13, 0)",
    false,
  ],
] as const)("兼容设置与游戏声明：%s", async (_case, scripts, version, expected) => {
  expect(await substitutions(scripts, version === undefined ? {} : { version })).toBe(expected);
});

it("新引擎分组标记来自快照清单，附加原稿不作为编译脚本", async () => {
  const scripts: Script[] = [
    ["game/mods/x.rpyc", "config.old_substitutions = False"],
    ["game/z.rpyc", "config.old_substitutions = True"],
  ];
  const extra = new Map([["game/notes.txt", Buffer.from("not a compiled script")]]);
  expect(await substitutions(scripts, { grouped: true, extra })).toBe(true);
  expect(
    await substitutions(scripts, { grouped: true, extra, markers: ["game/mods/mods.txt"] }),
  ).toBe(false);
});

it("脚本遗漏、读取失败或槽位声明矛盾时回退到引擎默认值与兼容设置", async () => {
  const declared: Script[] = [["game/a.rpyc", "config.old_substitutions = False"]];
  expect(await substitutions(declared, { complete: false })).toBe(true);
  expect(await substitutions(declared, { complete: false, version: "(6, 13, 0)" })).toBe(false);
  const broken = new Map([["game/broken.rpyc", Buffer.from("not a compiled script")]]);
  expect(await substitutions(declared, { extra: broken })).toBe(true);
  const slot = async (source: string) => (await read_compiled(code_fixture(source)))[0]!.data;
  const conflicting = write_compiled(compiled_fixture(), [
    { slot: 1, data: await slot("config.old_substitutions = False") },
    { slot: 2, data: await slot("config.old_substitutions = True") },
  ]);
  expect(await substitutions([], { extra: new Map([["game/a.rpyc", conflicting]]) })).toBe(true);
  const consistent = write_compiled(compiled_fixture(), [
    { slot: 1, data: await slot("config.old_substitutions = False") },
    { slot: 2, data: await slot("config.old_substitutions = False") },
  ]);
  expect(await substitutions([], { extra: new Map([["game/a.rpyc", consistent]]) })).toBe(false);
});

it("字体来自有效暂存集合，缓存、存档和备份不进入字体或原稿", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-font-source-"));
  const native = create_renpy_fixture(temp.path);
  for (const name of [
    "game/main.ttf",
    "game/cache/cache.ttf",
    "game/saves/save.otf",
    "backup_lg/game/old.ttf",
  ])
    native.write_file_sync(path.join(temp.path, name), "loose");
  const staging = path.join(temp.path, ".tmp/stage");
  native.write_file_sync(path.join(staging, "game/main.ttf"), "prepared Type 1");
  native.write_file_sync(path.join(staging, "game/extra.OTF"), "prepared OTF");
  native.write_file_sync(path.join(temp.path, "game/script.rpyc"), "invalid compiled script");
  const files = collect_renpy_fonts(
    (await discover_renpy_source(temp.path, native))!,
    native,
    undefined,
    complete_game_preparation(staging, { writes: ["game/main.ttf", "game/extra.OTF"] }).sources,
  );
  expect([...files.fonts.keys()]).toEqual(["game/extra.OTF", "game/main.ttf"]);
  expect(Buffer.from(files.fonts.get("game/main.ttf")!).toString()).toBe("prepared Type 1");
  expect(files.data.size).toBe(0);
});
