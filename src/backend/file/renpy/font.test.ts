import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  archive_fixture,
  code_fixture,
  compiled_fixture,
  create_renpy_fixture,
} from "../../../test/renpy-fixture";
import { font_fixture } from "../../../test/font-fixture";
import { RuntimeOperationGate } from "../../runtime-operation-gate";
import { GameFontService } from "../game-font-service";
import { GamePrepareWorker } from "../shared/game/prepare-worker";
import { GameFormat } from "../shared/game/format";
import { create_renpy_adapter } from "./renpy-format";
import { build_renpy_metadata, collect_renpy_files, discover_renpy_source } from "./source";
import {
  RENPY_FONT_FILE,
  RENPY_LANGUAGE_FILE,
  RENPY_STRINGS_FILE,
  RENPY_GENERATED_MARKER,
} from "./generated";
import { renpy_font_outputs, RENPY_DEFAULT_FONT, RENPY_DEFAULT_BOLD_FONT } from "./font";

it("原路径整文件替换包含 Type 1 和 OTF，目标内容不参与筛选", () => {
  const font = {
    bytes: font_fixture([{ text: "Selected" }]),
    file_name: "selected.ttf",
    families: ["Selected"],
  };
  const outputs = renpy_font_outputs(
    new Map([
      ["game/munro.ttf", Buffer.from("%!PS-AdobeFont")],
      ["game/custom.OTF", Buffer.from("OTTO")],
      ["game/renamed.ttf", Buffer.from("ttcf")],
    ]),
    font,
  );
  for (const name of [
    "game/munro.ttf",
    "game/custom.OTF",
    "game/renamed.ttf",
    RENPY_DEFAULT_FONT,
    RENPY_DEFAULT_BOLD_FONT,
  ])
    expect(outputs.get(name)).toEqual(font.bytes);
});

it.each([false, true])("产品入口合并归档与字体事务，译文先写=%s", async (translation_first) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-font-life-"));
  const root = path.join(temp.path, "demo"),
    native = create_renpy_fixture(root);
  const originals = new Map([
    ["fonts/munro.ttf", Buffer.from("%!PS-AdobeFont")],
    ["fonts/body.otf", Buffer.from("OTTO original")],
    ["collection.ttc", Buffer.from("ttcf original")],
  ]);
  const archive = archive_fixture(originals);
  native.write_file_sync(path.join(root, "game/fonts/munro.ttf"), "loose Type 1");
  native.write_file_sync(path.join(root, "game/archive.rpa"), archive);
  native.write_file_sync(
    path.join(root, "game/script.rpyc"),
    code_fixture("config.force_archives = True"),
  );
  const service = new GameFontService(
    new RuntimeOperationGate(),
    new GamePrepareWorker(null, native).run,
    native,
  );
  const request = { game_path: root, font_path: path.join(temp.path, "selected.ttf") };
  const first = font_fixture([{ text: "First" }]),
    second = font_fixture([{ text: "Second" }]);
  native.write_file_sync(request.font_path, first);
  const format = new GameFormat(create_renpy_adapter(), native);
  // 导出使用真实原稿容器，覆盖目标就是已准备的游戏目录。
  async function translate(): Promise<void> {
    const game = (await discover_renpy_source(root, native))!;
    const data = collect_renpy_files(game, native);
    expect([...data.keys()]).not.toContain(RENPY_FONT_FILE + "c");
    expect([...data.keys()].some((name) => /\.(?:ttf|otf)$/u.test(name))).toBe(false);
    const asset = await format.create_container(
      data,
      "demo.renpy",
      root,
      undefined,
      await build_renpy_metadata(game, data, native),
    );
    await format.write_to_path([], {
      paths: { translated_path: temp.path, bilingual_path: temp.path },
      source_files: [{ path: "demo.renpy", file_type: "RENPY" }],
      asset_reader: () => Buffer.from(asset.content),
    });
  }
  if (translation_first) await translate();
  const language_before = translation_first
    ? native.read_file(path.join(root, RENPY_LANGUAGE_FILE))
    : null;
  await service.inspect(request);
  await service.apply(request);
  const generated = native.read_file(path.join(root, RENPY_FONT_FILE));
  expect(native.exists(path.join(root, "backup_lg", RENPY_DEFAULT_FONT))).toBe(false);
  if (language_before)
    expect(native.read_file(path.join(root, RENPY_LANGUAGE_FILE))).toEqual(language_before);
  else
    for (const name of [RENPY_LANGUAGE_FILE, RENPY_STRINGS_FILE])
      expect(native.exists(path.join(root, name))).toBe(false);
  native.write_file_sync(path.join(root, RENPY_FONT_FILE + "c"), compiled_fixture());
  if (!translation_first) await translate();
  expect(native.read_file(path.join(root, RENPY_FONT_FILE))).toEqual(generated);
  const language = native.read_file(path.join(root, RENPY_LANGUAGE_FILE));
  native.write_file_sync(
    path.join(root, RENPY_FONT_FILE),
    RENPY_GENERATED_MARKER + "\n# previous font settings\n",
  );
  native.write_file_sync(request.font_path, second);
  await service.apply(request);
  expect(native.read_file(path.join(root, RENPY_FONT_FILE))).toEqual(generated);
  expect(native.read_file(path.join(root, RENPY_LANGUAGE_FILE))).toEqual(language);
  for (const name of ["game/fonts/munro.ttf", "game/fonts/body.otf", RENPY_DEFAULT_FONT])
    expect(native.read_file(path.join(root, name))).toEqual(second);
  expect(native.exists(path.join(root, "game/archive.rpa"))).toBe(false);
  expect(native.read_file(path.join(root, "game/collection.ttc"))).toEqual(
    originals.get("collection.ttc"),
  );
  expect(native.exists(path.join(root, ".tmp"))).toBe(false);
});

it("字体提交失败恢复原归档和散装文件，并能重试", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-font-rollback-"));
  const root = path.join(temp.path, "demo"),
    native = create_renpy_fixture(root);
  const archive = archive_fixture(new Map([["font.otf", Buffer.from("original")]]));
  native.write_file_sync(path.join(root, "game/archive.rpa"), archive);
  const request = { game_path: root, font_path: path.join(temp.path, "font.ttf") };
  native.write_file_sync(request.font_path, font_fixture([{ text: "Selected" }]));
  const service = new GameFontService(
    new RuntimeOperationGate(),
    new GamePrepareWorker(null, native).run,
    native,
  );
  const rename = native.rename.bind(native);
  const failure = vi.spyOn(native, "rename").mockImplementation((from, to) => {
    if (from.includes(path.join("stage", "game", "zz_lg_font.rpy")))
      throw new Error("font commit failed");
    rename(from, to);
  });
  await expect(service.apply(request)).rejects.toThrow("font commit failed");
  failure.mockRestore();
  expect(native.read_file(path.join(root, "game/archive.rpa"))).toEqual(archive);
  for (const name of [
    RENPY_FONT_FILE,
    RENPY_DEFAULT_FONT,
    RENPY_DEFAULT_BOLD_FONT,
    "game/font.otf",
    ".tmp",
  ])
    expect(native.exists(path.join(root, name))).toBe(false);
  await service.apply(request);
  expect(native.exists(path.join(root, "game/archive.rpa"))).toBe(false);
});
