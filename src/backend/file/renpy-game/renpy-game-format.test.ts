import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { GameFormat, GAME_METADATA_MEMBER } from "../shared/game/format";
import { create_renpy_adapter } from "./renpy-game-format";
import { collect_renpy_files, discover_renpy_source, RENPY_GENERATED_FILES } from "./source";
import {
  create_renpy_fixture,
  compiled_fixture,
  strings_fixture,
  code_fixture,
} from "../../../test/renpy-fixture";
import { extract_script } from "./extract";
import { encode_python } from "./python";

it("离线重载、人工放行与重复导出共用固化资产", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-format-"));
  const root = path.join(temp.path, "original"),
    native = create_renpy_fixture(root);
  const files = await collect_renpy_files((await discover_renpy_source(root, native))!, native);
  const format = new GameFormat(create_renpy_adapter(), native);
  const container = await format.create_container(
    files.data,
    "demo.renpy",
    root,
    undefined,
    files.metadata,
  );
  fs.renameSync(root, path.join(temp.path, "unavailable"));
  const parsed = await new GameFormat(create_renpy_adapter(), native).read_from_stream(
    container.content,
    "demo.renpy",
  );
  expect(parsed.warnings).toEqual([]);
  const display = parsed.items.find((item) => item.src === "First line [lg_name].")!;
  const code = parsed.items.find((item) => item.status === "RULE_SKIPPED")!;
  const common = parsed.items.find((item) => item.src === "Common question?")!;
  const items = [
    { ...display, status: "PROCESSED" as const, dst: "首句 [lg_name]。" },
    { ...code, status: "PROCESSED" as const, dst: "人工放行" },
    { ...common, status: "PROCESSED" as const, dst: "公共问题？" },
  ];
  const out = path.join(temp.path, "out");
  const context = {
    paths: { translated_path: out, bilingual_path: out },
    source_files: [{ path: "demo.renpy", file_type: "RENPY_NATIVE" }],
    asset_reader: () => Buffer.from(container.content),
  };
  await format.write_to_path(items, context);
  const first = native.read_file(path.join(out, "demo/game/script.rpyc"));
  const generated = native.read_text_file(path.join(out, "demo", RENPY_GENERATED_FILES[0]));
  expect((await extract_script(first)).candidates.map((candidate) => candidate.text)).toEqual(
    expect.arrayContaining(["首句 [lg_name]。", "人工放行"]),
  );
  expect(native.read_text_file(path.join(out, "demo", RENPY_GENERATED_FILES[1]))).toContain(
    encode_python("公共问题？"),
  );
  await format.write_to_path(items, context);
  expect(native.read_file(path.join(out, "demo/game/script.rpyc"))).toEqual(first);
  expect(native.read_text_file(path.join(out, "demo", RENPY_GENERATED_FILES[0]))).not.toBe(
    generated,
  );
  await format.write_to_path([], context);
  expect(native.read_file(path.join(out, "demo/game/script.rpyc"))).toEqual(compiled_fixture());
  expect(native.read_text_file(path.join(out, "demo", RENPY_GENERATED_FILES[1]))).not.toContain(
    "translate",
  );
  expect(native.exists(path.join(out, "demo", GAME_METADATA_MEMBER))).toBe(false);
});

it("失效坐标在落盘前失败", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-stale-"));
  const native = create_renpy_fixture(temp.path),
    format = new GameFormat(create_renpy_adapter(), native);
  const files = await collect_renpy_files(
    (await discover_renpy_source(temp.path, native))!,
    native,
  );
  const asset = await format.create_container(
    files.data,
    "demo.renpy",
    temp.path,
    undefined,
    files.metadata,
  );
  const parsed = await format.read_from_stream(asset.content, "demo.renpy");
  const item = parsed.items.find((entry) => entry.src.startsWith("First line"))!;
  const out = path.join(temp.path, "out");
  await expect(
    format.write_to_path([{ ...item, src: "stale", dst: "译文", status: "PROCESSED" }], {
      paths: { translated_path: out, bilingual_path: out },
      source_files: [{ path: "demo.renpy", file_type: "RENPY_NATIVE" }],
      asset_reader: () => Buffer.from(asset.content),
    }),
  ).rejects.toThrow("candidate changed");
  expect(native.exists(out)).toBe(false);
});
it("跨成员 None 字符串写 new，保留语言按新键重映射并拒绝冲突", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-strings-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/paragraph.rpyc"),
    code_fixture("message = _p('A  B')"),
  );
  native.write_file_sync(
    path.join(temp.path, "game/strings.rpymc"),
    strings_fixture([
      { language: null, old: "Common question?", text: "Existing base text" },
      { language: "french", old: "First line [lg_name].", text: "French text" },
      { language: "french", old: "Occupied", text: "Different text" },
      { language: "french", old: "A  B", text: "French paragraph" },
    ]),
  );
  const files = await collect_renpy_files(
    (await discover_renpy_source(temp.path, native))!,
    native,
  );
  const format = new GameFormat(create_renpy_adapter(), native);
  const asset = await format.create_container(
    files.data,
    "demo.renpy",
    temp.path,
    undefined,
    files.metadata,
  );
  const { items } = await format.read_from_stream(asset.content, "demo.renpy");
  expect(items.some((item) => item.src === "Common question?")).toBe(false);
  const base = items.find((item) => item.src === "Existing base text")!;
  const display = items.find((item) => item.src === "First line [lg_name].")!;
  const paragraph = items.find((item) => item.src === "A  B")!;
  const out = path.join(temp.path, "out");
  const context = {
    paths: { translated_path: out, bilingual_path: out },
    source_files: [{ path: "demo.renpy", file_type: "RENPY_NATIVE" }],
    asset_reader: () => Buffer.from(asset.content),
  };
  await format.write_to_path(
    [
      { ...base, status: "PROCESSED", dst: "基础译文" },
      { ...display, status: "PROCESSED", dst: "Translated [lg_name]." },
      { ...paragraph, status: "PROCESSED", dst: "C  D" },
    ],
    context,
  );
  const table = (await extract_script(native.read_file(path.join(out, "demo/game/strings.rpymc"))))
    .strings;
  expect(table).toContainEqual(
    expect.objectContaining({ language: null, old: "Common question?", text: "基础译文" }),
  );
  const generated = native.read_text_file(path.join(out, "demo", RENPY_GENERATED_FILES[1]));
  expect(generated).toContain("translate french strings:");
  expect(generated).toContain("old " + encode_python("Translated [lg_name]."));
  expect(generated).toContain("new " + encode_python("French text"));
  expect(generated).toContain("old " + encode_python("C  D"));
  expect(generated).toContain("new " + encode_python("French paragraph"));
  await expect(
    format.write_to_path([{ ...display, status: "PROCESSED", dst: "Occupied" }], context),
  ).rejects.toThrow("Conflicting generated");
});
