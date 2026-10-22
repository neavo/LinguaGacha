import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_renpy_fixture } from "../../../test/renpy-fixture";
import { read_profile, collect_common } from "./profile";

it("加载规则由源码形态决定，未知形态不能按版本号回退", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-profile-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "renpy/__init__.py"),
    "version_tuple = (99, 0, 0, 0)",
  );
  expect((await read_profile(temp.path, native)).archives).toBe("top-level");
  native.write_file_sync(path.join(temp.path, "renpy/main.py"), "custom_loader()");
  await expect(async () => await read_profile(temp.path, native)).rejects.toThrow(
    "Unknown Ren'Py archive discovery",
  );
});
it("公共字符串排除开发者资源，只在游戏使用旧布局时收集布局文本", async () => {
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
  expect(await collect_common(temp.path, native)).toEqual(["Common   question?"]);
  expect(await collect_common(temp.path, native, undefined, true)).toEqual([
    "Common   question?",
    "Layout text",
  ]);
});

it("静态档案识别实际 lock 路径，忽略注释中的伪规则", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-shape-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "renpy/script.py"),
    'with open(rpyfn, "rb") as f:\n    rpydigest = hashlib.md5(f.read()).digest()\nrpycdigest = None\nkey = open(base + "/lock.txt", "rb").read()\n',
  );
  expect((await read_profile(temp.path, native)).digest).toBe("raw");
  native.write_file_sync(
    path.join(temp.path, "renpy/main.py"),
    "# renpy.config.archives.reverse()\n# sorted(os.listdir(directory))\ncustom_loader()",
  );
  await expect(read_profile(temp.path, native)).rejects.toThrow("Unknown Ren'Py archive discovery");
});
