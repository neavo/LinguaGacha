import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_renpy_fixture, archive_fixture, code_fixture } from "../../../test/renpy-fixture";
import { extract_script } from "./extract";
import { script_codes } from "./script";
import { discover_renpy_source } from "./source";
import { stage_renpy_source } from "./prepare";
import { prepare_game_directory } from "../shared/game/prepare";
import { source_digest } from "./compiled";

it("散装资源优先，归档源码保持非活动，重复准备保持结果", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-"));
  const native = create_renpy_fixture(temp.path, true);
  native.write_file_sync(path.join(temp.path, "game/cache/ignored.rpa"), "not an archive");
  native.write_file_sync(
    path.join(temp.path, "game/nested/archive.rpa"),
    archive_fixture(
      new Map([
        ["asset.bin", Buffer.from("fragmented resource")],
        ["loose.txt", Buffer.from("archived")],
        ["inactive.rpy", Buffer.from("invalid source should remain inactive")],
      ]),
    ),
  );
  native.write_file_sync(path.join(temp.path, "game/loose.txt"), "loose");
  const game = (await discover_renpy_source(temp.path, native))!;
  await prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  expect(native.read_text_file(path.join(temp.path, "game/asset.bin"))).toBe("fragmented resource");
  expect(native.read_text_file(path.join(temp.path, "game/loose.txt"))).toBe("loose");
  expect(native.exists(path.join(temp.path, "game/inactive.rpy"))).toBe(false);
  expect(native.read_text_file(path.join(temp.path, "game/cache/ignored.rpa"))).toBe(
    "not an archive",
  );
  expect(native.exists(path.join(temp.path, "backup_lg/game/nested/archive.rpa"))).toBe(true);
  await prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
});
it.each(["missing", "stale", "valid"])("活动源码 %s 的摘要验证在目录提交之前完成", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-source-"));
  const native = create_renpy_fixture(temp.path),
    source = Buffer.from('label start:\n    "Hello"\n');
  const compiled_path = path.join(temp.path, "game/script.rpyc");
  native.write_file_sync(path.join(temp.path, "game/script.rpy"), source);
  if (kind === "missing") fs.unlinkSync(compiled_path);
  if (kind === "valid") {
    const bytes = Buffer.from(native.read_file(compiled_path));
    source_digest(source, "raw", "").copy(bytes, bytes.length - 16);
    native.write_file_sync(compiled_path, bytes);
  }
  const game = (await discover_renpy_source(temp.path, native))!;
  const prepare = prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  if (kind === "valid") {
    await prepare;
    expect(native.exists(path.join(temp.path, "game/script.rpy"))).toBe(false);
    expect(native.read_file(path.join(temp.path, "backup_lg/game/script.rpy"))).toEqual(source);
  } else {
    await expect(prepare).rejects.toThrow(/compiled script/u);
    expect(native.read_file(path.join(temp.path, "game/script.rpy"))).toEqual(source);
    expect(native.exists(path.join(temp.path, "backup_lg"))).toBe(false);
  }
});
it("嵌套归档保持非活动，准备拒绝将它激活", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-nested-"));
  const native = create_renpy_fixture(temp.path, true);
  native.write_file_sync(
    path.join(temp.path, "game/archive.rpa"),
    archive_fixture(new Map([["nested.rpa", Buffer.from("nested")]])),
  );
  const game = (await discover_renpy_source(temp.path, native))!;
  await expect(
    prepare_game_directory(temp.path, native, (staging) =>
      stage_renpy_source({ game, staging }, native),
    ),
  ).rejects.toThrow("would become active");
  expect(native.exists(path.join(temp.path, "game/nested.rpa"))).toBe(false);
  expect(native.exists(path.join(temp.path, "game/archive.rpa"))).toBe(true);
});
it.each(["init", "early"] as const)(
  "%s 强制归档在原执行位置适配，并把被遮蔽的散装资源备份",
  async (context) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-force-"));
    const native = create_renpy_fixture(temp.path);
    native.write_file_sync(
      path.join(temp.path, "game/script.rpyc"),
      code_fixture("config.force_archives = True\n", context),
    );
    native.write_file_sync(path.join(temp.path, "game/resource.txt"), "loose");
    native.write_file_sync(
      path.join(temp.path, "game/archive.rpa"),
      archive_fixture(new Map([["resource.txt", Buffer.from("archive")]])),
    );
    const game = (await discover_renpy_source(temp.path, native))!;
    await prepare_game_directory(temp.path, native, (staging) =>
      stage_renpy_source({ game, staging }, native),
    );
    expect(native.read_text_file(path.join(temp.path, "game/resource.txt"))).toBe("archive");
    expect(native.read_text_file(path.join(temp.path, "backup_lg/game/resource.txt"))).toBe(
      "loose",
    );
    expect(
      script_codes(
        await extract_script(native.read_file(path.join(temp.path, "game/script.rpyc"))),
      ).map((code) => code.source),
    ).toContain("config.force_archives = False\n");
    const backup = path.join(temp.path, "backup_lg/game/script.rpyc");
    expect(native.read_file(backup)).toEqual(
      code_fixture("config.force_archives = True\n", context),
    );
    await prepare_game_directory(temp.path, native, (staging) =>
      stage_renpy_source({ game, staging }, native),
    );
    expect(native.read_file(backup)).toEqual(
      code_fixture("config.force_archives = True\n", context),
    );
  },
);
it("按声明选择归档资源，允许默认来源内容不同", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-order-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/script.rpyc"),
    code_fixture("config.archives = ['a', 'z']\n"),
  );
  native.write_file_sync(
    path.join(temp.path, "game/a.rpa"),
    archive_fixture(new Map([["resource.txt", Buffer.from("different")]])),
  );
  native.write_file_sync(
    path.join(temp.path, "game/z.rpa"),
    archive_fixture(new Map([["resource.txt", Buffer.from("same")]])),
  );
  const game = (await discover_renpy_source(temp.path, native))!;
  const prepare = prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  await prepare;
  expect(native.read_text_file(path.join(temp.path, "game/resource.txt"))).toBe("different");
});

it("普通 Python 资源与业务对象引用保持原字节", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-resource-"));
  const native = create_renpy_fixture(temp.path);
  const note = Buffer.from([0xff, 0, 0x81, 0x23]);
  const script = code_fixture(
    "attributes = actor.__dict__\nsettings = config\nif flag:\n    update(settings)\ndef configure():\n    return config.archives\n",
  );
  native.write_file_sync(path.join(temp.path, "game/notes.py"), note);
  native.write_file_sync(path.join(temp.path, "game/script.rpyc"), script);
  native.write_file_sync(
    path.join(temp.path, "game/archive.rpa"),
    archive_fixture(new Map([["packed.py", note]])),
  );
  const game = (await discover_renpy_source(temp.path, native))!;
  await prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  expect(native.read_file(path.join(temp.path, "game/notes.py"))).toEqual(note);
  expect(native.read_file(path.join(temp.path, "game/packed.py"))).toEqual(note);
  expect(native.read_file(path.join(temp.path, "game/script.rpyc"))).toEqual(script);
});

it("缩进初始化中的多行加载声明正确写回，注释和字符串不参与加载声明", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-indented-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/script.rpyc"),
    code_fixture(
      "    # config.searchpath = []\n    note = 'config.file_open_callback'\n    config.force_archives = (\n        True\n    )\n",
    ),
  );
  const game = (await discover_renpy_source(temp.path, native))!;
  const staging = path.join(temp.path, "stage");
  await stage_renpy_source({ game, staging }, native);
  const output = script_codes(
    await extract_script(native.read_file(path.join(staging, "game/script.rpyc"))),
  );
  expect(output[0]?.source).toBe(
    "    # config.searchpath = []\n    note = 'config.file_open_callback'\n    config.force_archives = False\n",
  );
});

it("无法静态读取的普通编译代码不阻止资源准备", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-unknown-"));
  const native = create_renpy_fixture(temp.path);
  const bytes = code_fixture("    config.archives = [");
  native.write_file_sync(path.join(temp.path, "game/script.rpyc"), bytes);
  const game = (await discover_renpy_source(temp.path, native))!;
  await prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  expect(native.read_file(path.join(temp.path, "game/script.rpyc"))).toEqual(bytes);
});
it("引擎支持的 _ren.py 仍要求源码与编译摘要配对", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-ren-source-"));
  const native = create_renpy_fixture(temp.path);
  const engine = path.join(temp.path, "renpy/script.py");
  native.write_file_sync(
    engine,
    native.read_text_file(engine) + '\nif fn.endswith("_ren.py"):\n    pass\n',
  );
  const source = Buffer.from("print('source')\n");
  native.write_file_sync(path.join(temp.path, "game/script_ren.py"), source);
  const game = (await discover_renpy_source(temp.path, native))!;
  const prepare = () =>
    prepare_game_directory(temp.path, native, (staging) =>
      stage_renpy_source({ game, staging }, native),
    );
  await expect(prepare()).rejects.toThrow("Stale compiled script");
  const compiled = Buffer.from(native.read_file(path.join(temp.path, "game/script.rpyc")));
  source_digest(source, "raw", "").copy(compiled, compiled.length - 16);
  native.write_file_sync(path.join(temp.path, "game/script.rpyc"), compiled);
  await prepare();
  expect(native.exists(path.join(temp.path, "game/script_ren.py"))).toBe(false);
  expect(native.read_file(path.join(temp.path, "backup_lg/game/script_ren.py"))).toEqual(source);
});

it("默认脚本发现与声明后的资源来源分别选择", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-phases-"));
  const native = create_renpy_fixture(temp.path);
  fs.unlinkSync(path.join(temp.path, "game/script.rpyc"));
  const initial = code_fixture("config.archives = ['a']\n");
  native.write_file_sync(
    path.join(temp.path, "game/z.rpa"),
    archive_fixture(
      new Map([
        ["script.rpyc", initial],
        ["resource.txt", Buffer.from("z")],
        ["excluded.txt", Buffer.from("excluded")],
      ]),
    ),
  );
  native.write_file_sync(
    path.join(temp.path, "game/a.rpa"),
    archive_fixture(
      new Map([
        ["script.rpyc", code_fixture("config.archives = ['z']\n")],
        ["resource.txt", Buffer.from("a")],
      ]),
    ),
  );
  const game = (await discover_renpy_source(temp.path, native))!;
  await prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  expect(native.read_file(path.join(temp.path, "game/script.rpyc"))).toEqual(initial);
  expect(native.read_text_file(path.join(temp.path, "game/resource.txt"))).toBe("a");
  expect(native.exists(path.join(temp.path, "game/excluded.txt"))).toBe(false);
});
it.each([false, true])("默认归档覆盖使用对应引擎的排序键，递归=%s", async (recursive) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-priority-"));
  const native = create_renpy_fixture(temp.path, recursive);
  for (const stem of ["a", "a-more"])
    native.write_file_sync(
      path.join(temp.path, "game", stem + ".rpa"),
      archive_fixture(new Map([["resource.txt", Buffer.from(stem)]])),
    );
  const game = (await discover_renpy_source(temp.path, native))!;
  await prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  expect(native.read_text_file(path.join(temp.path, "game/resource.txt"))).toBe(
    recursive ? "a-more" : "a",
  );
});

it("归档中的生成资源在正式提交前拒绝", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-reserved-"));
  const native = create_renpy_fixture(temp.path);
  const archive = archive_fixture(new Map([["zz_lg_font.rpy", Buffer.from("foreign")]]));
  const file = path.join(temp.path, "game/archive.rpa");
  native.write_file_sync(file, archive);
  const game = (await discover_renpy_source(temp.path, native))!;
  await expect(
    prepare_game_directory(temp.path, native, (staging) =>
      stage_renpy_source({ game, staging }, native),
    ),
  ).rejects.toThrow("Reserved Ren'Py resource");
  expect(native.read_file(file)).toEqual(archive);
  expect(native.exists(path.join(temp.path, "backup_lg"))).toBe(false);
});
