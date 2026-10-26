import { PythonSession } from "./python-syntax";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_renpy_fixture } from "../../../test/renpy-fixture";
import { read_profile, collect_common, read_renpy_format_metadata } from "./profile";

it.each([
  ["True", true],
  ["False", false],
  ["choose_semantics()", null],
] as const)("替换语义 %s 保留确定值或未知", async (expression, expected) => {
  using session = await PythonSession.create();
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-semantics-"));
  const native = create_renpy_fixture(temp.path);
  const config = path.join(temp.path, "renpy/config.py");
  native.write_file_sync(
    config,
    native
      .read_text_file(config)
      .replace("old_substitutions = True", "old_substitutions = " + expression),
  );
  expect((await read_profile(temp.path, native, undefined, session)).old_substitutions).toBe(
    expected,
  );
});

it("加载规则由源码形态决定，未知形态不能按版本号回退", async () => {
  using session = await PythonSession.create();
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-profile-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "renpy/__init__.py"),
    "version_tuple = (99, 0, 0, 0)",
  );
  expect((await read_profile(temp.path, native, undefined, session)).archives).toBe("top-level");
  const script = path.join(temp.path, "renpy/script.py");
  expect((await read_profile(temp.path, native, undefined, session)).script_order).toBe("filename");
  native.write_file_sync(
    script,
    native.read_text_file(script) + "\nself.script_files.sort(key=game_key)\n",
  );
  expect((await read_profile(temp.path, native, undefined, session)).script_order).toBe("grouped");
  native.write_file_sync(path.join(temp.path, "renpy/main.py"), "custom_loader()");
  await expect(
    async () => await read_profile(temp.path, native, undefined, session),
  ).rejects.toThrow("Unknown Ren'Py archive discovery");
});
it("公共字符串排除开发者资源，只在游戏使用旧布局时收集布局文本", async () => {
  using session = await PythonSession.create();
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-common-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "renpy/translation/scanstrings.py"),
    `STRING_RE = r'''(?x) (?:_|__|___|_p) \\( ((?:[uU]?"[^"]*"|[uU]?'[^']*')+) \\)'''\nCOMMON_PRIORITIES = [\n('_developer/', 310, 'dev.rpy'),\n('_layout/', 410, 'old.rpy'),\n('', 50, 'common.rpy')\n]\n`,
  );
  native.write_file_sync(
    path.join(temp.path, "renpy/common/00test.rpy"),
    `_p("Common   question?")`,
  );
  native.write_file_sync(
    path.join(temp.path, "renpy/common/_developer/test.rpy"),
    `_("Developer text")`,
  );
  native.write_file_sync(path.join(temp.path, "renpy/common/_layout/test.rpy"), `_("Layout text")`);
  expect(await collect_common(temp.path, native, undefined, false, session)).toEqual([
    "Common   question?",
  ]);
  expect(await collect_common(temp.path, native, undefined, true, session)).toEqual([
    "Common   question?",
    "Layout text",
  ]);
});

it("静态档案识别实际 lock 路径，忽略注释中的伪规则", async () => {
  using session = await PythonSession.create();
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-shape-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "renpy/script.py"),
    'with open(rpyfn, "rb") as f:\n    rpydigest = hashlib.md5(f.read()).digest()\nrpycdigest = None\nkey = open(base + "/lock.txt", "rb").read()\n',
  );
  expect((await read_profile(temp.path, native, undefined, session)).digest).toBe("raw");
  native.write_file_sync(
    path.join(temp.path, "renpy/main.py"),
    "# renpy.config.archives.reverse()\n# sorted(os.listdir(directory))\ncustom_loader()",
  );
  await expect(read_profile(temp.path, native, undefined, session)).rejects.toThrow(
    "Unknown Ren'Py archive discovery",
  );
});

it.each([
  ['open(rpyfn, "rU")', "hashlib.md5(f.read())", "universal"],
  ['open(rpyfn, "rU", encoding="utf-8")', 'hashlib.md5(f.read().encode("utf-8"))', "universal"],
  ['open(rpyfn, "rU", encoding="utf-8")', "hashlib.md5(f.read())", null],
])("源码摘要按读取与计算写法成对识别：%s / %s", async (open, digest, expected) => {
  using session = await PythonSession.create();
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-digest-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "renpy/script.py"),
    `with ${open} as f:\n    rpydigest = ${digest}.digest()\nrpycdigest = None\nlock = "lock.txt"\n`,
  );
  if (expected)
    expect((await read_profile(temp.path, native, undefined, session)).digest).toBe(expected);
  else
    await expect(read_profile(temp.path, native, undefined, session)).rejects.toThrow(
      "Unknown Ren'Py source digest rule",
    );
});

it("离线元数据独立校验必需字段，不从引擎版本补 Python 代际", () => {
  const metadata = {
    schema: "linguagacha-renpy-1",
    engine_version: "unknown",
    python_major: 2,
    old_substitutions: null,
    common: ["Common"],
  };
  expect(read_renpy_format_metadata(Buffer.from(JSON.stringify(metadata)))).toEqual(metadata);
  for (const field of ["engine_version", "python_major", "old_substitutions", "common"])
    expect(() =>
      read_renpy_format_metadata(Buffer.from(JSON.stringify({ ...metadata, [field]: undefined }))),
    ).toThrow();
  expect(() =>
    read_renpy_format_metadata(Buffer.from(JSON.stringify({ ...metadata, python_major: 4 }))),
  ).toThrow("Python generation");
  expect(() =>
    read_renpy_format_metadata(
      Buffer.from(JSON.stringify({ ...metadata, scripts_incomplete: "true" })),
    ),
  ).toThrow("script completeness");
});
