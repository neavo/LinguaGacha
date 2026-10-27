import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { write_tyrano_app } from "../../../test/tyrano-fixture";
import {
  build_tyrano_metadata,
  collect_tyrano_files,
  discover_tyrano_source,
  is_tyrano_root,
} from "./source";

it.each(["resources/app", ""])("散装应用目录 %j 按游戏根目录识别并收集翻译原稿", async (app) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-source-"));
  const native = new NativeFs();
  write_tyrano_app(
    native,
    path.join(temp.path, app),
    {
      "data/system/Config.tjs": ";System.title = テスト\n;KeepSpaceInParameterValue = 1\n",
      "data/others/plugin/p/main.js": "",
      "data/others/plugin/p/readme.txt": "",
      "data/image/a.png": "",
    },
    "legacy",
  );
  native.write_file_sync(path.join(temp.path, "Game.exe"), "");
  const game = await discover_tyrano_source(path.join(temp.path, "Game.exe"), native);
  expect(game).toEqual({
    root: temp.path,
    app,
    archive: null,
    syntax: { parser: "legacy", keep_space: "1" },
  });
  expect(is_tyrano_root(temp.path, native)).toBe(true);
  const data = collect_tyrano_files(game!, native);
  const local = (name: string) => [app, name].filter(Boolean).join("/");
  expect([...data.keys()]).toEqual(
    ["data/others/plugin/p/main.js", "data/scenario/first.ks", "data/system/Config.tjs"].map(local),
  );
});

it("入口页面的静态配置覆盖 Config.tjs，并原样固化到格式元数据", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-settings-"));
  const native = new NativeFs();
  write_tyrano_app(native, temp.path, {
    "data/system/Config.tjs": ";KeepSpaceInParameterValue = 1\n",
    "index.html":
      '<input type="hidden" tyrano="config" key="KeepSpaceInParameterValue" value="2" />' +
      '<div tyrano="config" key="KeepSpaceInParameterValue" value="1"></div>' + // 只解释 `input`。
      '<input type="hidden" tyrano="config" key="KeepSpaceInParameterValue" value="3" />',
  });
  const game = await discover_tyrano_source(temp.path, native);
  expect(game?.syntax).toEqual({ parser: "modern", keep_space: "3" });
  expect(JSON.parse(Buffer.from(await build_tyrano_metadata(game!)).toString())).toEqual(
    game!.syntax,
  );
});

it.each([
  ["归档与散装目录并存", { app: true }, /both resources\/app\.asar and resources\/app/u],
  [
    "待应用补丁按基础配置检查，入口页面覆盖晚于补丁应用",
    {
      patch: true,
      files: {
        "index.html": '<input tyrano="config" key="patch_apply_auto" value="false">',
      },
    },
    /update patch is pending/u,
  ],
  ["内置语言表", { files: { "data/others/lang/en.json": "{}" } }, /language tables/u],
  [
    "未知解析器",
    { files: { "tyrano/plugins/kag/kag.parser.js": "custom" } },
    /Unsupported TyranoScript parser/u,
  ],
])(
  "准备前报告支持边界：%s",
  async (
    _name,
    setup: { app?: boolean; patch?: boolean; files?: Record<string, string> },
    error,
  ) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-boundary-"));
    const native = new NativeFs();
    const app = path.join(temp.path, "app-source");
    write_tyrano_app(native, app, setup.files);
    await createPackage(app, path.join(temp.path, "game/resources/app.asar"));
    if (setup.app) native.make_dir(path.join(temp.path, "game/resources/app"));
    if (setup.patch) native.write_file_sync(path.join(temp.path, "game/test.tpatch"), "");
    expect(is_tyrano_root(path.join(temp.path, "game"), native)).toBe(true);
    await expect(discover_tyrano_source(path.join(temp.path, "game"), native)).rejects.toThrow(
      error,
    );
  },
);

it("没有引擎标志的 Electron 归档不是 TyranoScript 游戏", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-other-"));
  const native = new NativeFs();
  native.write_file_sync(path.join(temp.path, "app/index.html"), "");
  await createPackage(path.join(temp.path, "app"), path.join(temp.path, "game/resources/app.asar"));
  expect(await discover_tyrano_source(path.join(temp.path, "game"), native)).toBeNull();
});
