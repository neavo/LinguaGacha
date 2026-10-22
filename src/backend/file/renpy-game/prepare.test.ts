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
it.each(["missing", "stale", "valid"])("活动源码 %s 的审计在目录提交之前完成", async (kind) => {
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
  },
);
it.each([false, true])("归档顺序改变的不同来源内容相同=%s", async (same) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-order-"));
  const native = create_renpy_fixture(temp.path);
  native.write_file_sync(
    path.join(temp.path, "game/script.rpyc"),
    code_fixture("config.archives = ['a', 'z']\n"),
  );
  native.write_file_sync(
    path.join(temp.path, "game/a.rpa"),
    archive_fixture(new Map([["resource.txt", Buffer.from(same ? "same" : "different")]])),
  );
  native.write_file_sync(
    path.join(temp.path, "game/z.rpa"),
    archive_fixture(new Map([["resource.txt", Buffer.from("same")]])),
  );
  const game = (await discover_renpy_source(temp.path, native))!;
  const prepare = prepare_game_directory(temp.path, native, (staging) =>
    stage_renpy_source({ game, staging }, native),
  );
  if (same) {
    await prepare;
    expect(native.read_text_file(path.join(temp.path, "game/resource.txt"))).toBe("same");
  } else {
    await expect(prepare).rejects.toThrow("source changes");
    expect(native.exists(path.join(temp.path, "game/a.rpa"))).toBe(true);
  }
});

it.each(["conditional", "runtime"] as const)(
  "%s 加载赋值在准备前拒绝，保留全部输入",
  async (context) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-loading-"));
    const native = create_renpy_fixture(temp.path);
    const script = code_fixture("config.force_archives = True", context);
    const archive = archive_fixture(new Map([["resource.txt", Buffer.from("archive")]]));
    native.write_file_sync(path.join(temp.path, "game/script.rpyc"), script);
    native.write_file_sync(path.join(temp.path, "game/archive.rpa"), archive);
    native.write_file_sync(path.join(temp.path, "game/resource.txt"), "loose");
    const game = (await discover_renpy_source(temp.path, native))!;
    await expect(
      prepare_game_directory(temp.path, native, (staging) =>
        stage_renpy_source({ game, staging }, native),
      ),
    ).rejects.toThrow(/unconditional initialization/u);
    expect(native.read_file(path.join(temp.path, "game/script.rpyc"))).toEqual(script);
    expect(native.read_file(path.join(temp.path, "game/archive.rpa"))).toEqual(archive);
    expect(native.read_text_file(path.join(temp.path, "game/resource.txt"))).toBe("loose");
    expect(native.exists(path.join(temp.path, "backup_lg"))).toBe(false);
  },
);

it.each([
  "if flag:\n    config.force_archives = True",
  "for value in values:\n    config.force_archives = True",
  "def configure():\n    config.force_archives = True",
  "config.force_archives = choose()",
  "setattr(config, 'force_archives', True)",
  "alias = config\nalias.force_archives = True",
])("拒绝 Python 控制流与间接加载修改：%s", async (source) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-control-"));
  const native = create_renpy_fixture(temp.path);
  const bytes = code_fixture(source);
  native.write_file_sync(path.join(temp.path, "game/script.rpyc"), bytes);
  const game = (await discover_renpy_source(temp.path, native))!;
  await expect(
    stage_renpy_source({ game, staging: path.join(temp.path, "stage") }, native),
  ).rejects.toThrow(/Dynamic|Unsupported loading/u);
  expect(native.read_file(path.join(temp.path, "game/script.rpyc"))).toEqual(bytes);
});
it("缩进初始化中的多行加载声明正确写回，注释和字符串不参与审计", async () => {
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

it("必要加载源码解析失败报告成员与原始偏移，准备不提交变更", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-location-"));
  const native = create_renpy_fixture(temp.path);
  const bytes = code_fixture("    config.archives = [");
  native.write_file_sync(path.join(temp.path, "game/script.rpyc"), bytes);
  const game = (await discover_renpy_source(temp.path, native))!;
  await expect(
    stage_renpy_source({ game, staging: path.join(temp.path, "stage") }, native),
  ).rejects.toThrow(/game\/script.rpyc:.*\[.*Invalid Python syntax/u);
  expect(native.read_file(path.join(temp.path, "game/script.rpyc"))).toEqual(bytes);
});
