import { read_pack } from "./pack";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import {
  create_godot_fixture,
  godot_pack_fixture,
  build_resource,
  godot_executable_fixture,
  godot_project_fixture,
} from "../../../test/godot-fixture";
import { apply_godot_pack_order, discover_godot_source } from "./source";
import { prepare_game_source } from "../shared/game/engines";
import { read_resource } from "./resource";
import { u32 } from "./binary";
import { stage_godot_source } from "./prepare";
import { GODOT_CRYPT_HEADER_BYTES } from "./crypt";
import { setImmediate } from "node:timers/promises";

it.each(["external", "embedded"])("%s 载体准备、字体回退、重复导入与原载体备份", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-prepare-"));
  const native = new NativeFs(),
    files = create_godot_fixture();
  files.set(
    ".godot/imported/font.fontdata",
    build_resource(
      "FontFile",
      new Map([["allow_system_fallback", Buffer.concat([u32(2), u32(0)])]]),
    ),
  );
  const prefix = Buffer.alloc(256, 42),
    bytes = godot_pack_fixture(files, { prefix: kind === "embedded" ? prefix : undefined });
  const carrier = path.join(temp.path, kind === "embedded" ? "game.exe" : "game.pck");
  fs.writeFileSync(carrier, bytes);
  if (kind === "external") fs.writeFileSync(path.join(temp.path, "game.exe"), prefix);
  const game = (await discover_godot_source(path.join(temp.path, "game.exe"), native))!;
  expect(Boolean(game.embedded)).toBe(kind === "embedded");
  await prepare_game_source({ kind: "game", file_type: "GODOT", game }, native);
  expect(
    fs.readFileSync(path.join(temp.path, "backup_lg", path.basename(carrier))).equals(bytes),
  ).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "game.exe")).equals(prefix)).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "game.pck"))).toBe(false);
  expect(
    read_resource(fs.readFileSync(path.join(temp.path, ".godot/imported/font.fontdata")))
      .properties[0]!.value.value,
  ).toBe(true);
  const loose = (await discover_godot_source(temp.path, native))!;
  expect(loose.embedded).toBeNull();
  expect(loose.external).toEqual([]);
  const create = vi.spyOn(native, "make_dir_exclusive");
  await prepare_game_source({ kind: "game", file_type: "GODOT", game: loose }, native);
  expect(create).not.toHaveBeenCalled();
});

it.each(["io", "cancel"])("并发提取 %s 后等待全部写入与句柄收尾", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-extraction-settle-"));
  const native = new NativeFs(),
    controller = new AbortController(),
    staging = path.join(temp.path, "staging");
  const bytes = godot_pack_fixture(
    new Map([
      ["project.binary", godot_project_fixture()],
      ["slow.bin", Buffer.alloc(1024, 1)],
      ["bad.bin", Buffer.alloc(1024, 2)],
    ]),
  );
  native.write_file_sync(path.join(temp.path, "game.pck"), bytes);
  const game = (await discover_godot_source(temp.path, native))!;
  await native.make_dir_async(staging);
  const slow_started = Promise.withResolvers<void>(),
    failure_started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const handles: Awaited<ReturnType<NativeFs["open_file"]>>[] = [],
    open = native.open_file.bind(native);
  vi.spyOn(native, "open_file").mockImplementation(async (file, flags) => {
    const handle = await open(file, flags);
    handles.push(handle);
    if (flags === "wx" && file.endsWith("slow.bin")) {
      const write = handle.write.bind(handle);
      vi.spyOn(handle, "write").mockImplementation(async (...args: Parameters<typeof write>) => {
        slow_started.resolve();
        await release.promise;
        return write(...args);
      });
    }
    if (flags === "wx" && file.endsWith("bad.bin")) {
      const write = handle.write.bind(handle);
      vi.spyOn(handle, "write").mockImplementation(async (...args: Parameters<typeof write>) => {
        await slow_started.promise;
        failure_started.resolve();
        if (kind === "cancel") {
          controller.abort(new Error("extraction cancelled"));
          return write(...args);
        }
        throw new Error("extraction IO failure");
      });
    }
    return handle;
  });
  let settled = false;
  const task = stage_godot_source({ game, staging }, native, controller.signal).finally(() => {
    settled = true;
  });
  const rejected = expect(task).rejects.toThrow(
    kind === "cancel" ? "extraction cancelled" : "extraction IO failure",
  );
  try {
    await failure_started.promise;
    await setImmediate();
    expect(settled).toBe(false);
  } finally {
    release.resolve();
  }
  await rejected;
  expect(handles.every((handle) => handle.fd === -1)).toBe(true);
  for (const name of ["slow.bin", "bad.bin"])
    expect(native.exists(path.join(staging, name))).toBe(false);
  expect(native.read_file(path.join(temp.path, "game.pck"))).toEqual(bytes);
});

it("并发解密拒绝实际损坏密文并保留载体", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-encrypted-corruption-"));
  const native = new NativeFs(),
    key = Buffer.alloc(32, 73);
  const bytes = godot_pack_fixture(
    new Map([
      ["project.binary", godot_project_fixture()],
      ["bad.bin", Buffer.alloc(2048, 5)],
    ]),
    {
      encryption_key: key,
      encrypted_members: ["project.binary", "bad.bin"],
    },
  );
  const file = path.join(temp.path, "game.pck");
  native.write_file_sync(file, bytes);
  native.write_file_sync(path.join(temp.path, "game.exe"), godot_executable_fixture(key));
  const handle = await native.open_file(file, "r");
  let offset: number;
  try {
    offset = (await read_pack(handle)).members.find((member) => member.name === "bad.bin")!.offset;
  } finally {
    await handle.close();
  }
  const damaged = offset + GODOT_CRYPT_HEADER_BYTES + 128;
  bytes[damaged] = bytes[damaged]! ^ 1;
  native.write_file_sync(file, bytes);
  const game = (await discover_godot_source(temp.path, native))!;
  await expect(
    prepare_game_source({ kind: "game", file_type: "GODOT", game }, native),
  ).rejects.toThrow("Encrypted PCK MD5 mismatch");
  expect(native.read_file(file)).toEqual(bytes);
  expect(native.exists(path.join(temp.path, ".tmp"))).toBe(false);
  expect(native.exists(path.join(temp.path, "backup_lg"))).toBe(false);
});

it("选择同目录启动器时仍将 EXE 前缀写回内嵌载体，保留启动器原件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-launcher-"));
  const native = new NativeFs(),
    launcher = path.join(temp.path, "launcher.exe"),
    executable = path.join(temp.path, "game.exe");
  const prefix = Buffer.from("engine prefix"),
    bytes = godot_pack_fixture(create_godot_fixture(), { prefix });
  fs.writeFileSync(launcher, "launcher");
  fs.writeFileSync(executable, bytes);
  const game = (await discover_godot_source(launcher, native))!;
  expect(game.executable).toBe(executable);
  await prepare_game_source({ kind: "game", file_type: "GODOT", game }, native);
  expect(fs.readFileSync(launcher, "utf8")).toBe("launcher");
  expect(fs.readFileSync(executable)).toEqual(prefix);
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/game.exe"))).toEqual(bytes);
});

it.each([false, true])(
  "多包按确认顺序覆盖=%s，保留启动配置、附加空包和重复导入",
  async (reverse) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-overlay-"));
    const native = new NativeFs(),
      main = create_godot_fixture(),
      config = main.get("project.binary")!;
    native.write_file_sync(
      path.join(temp.path, "game.exe"),
      godot_pack_fixture(main, { prefix: godot_executable_fixture() }),
    );
    for (const [name, text] of [
      ["patch2.pck", "second"],
      ["patch10.pck", "tenth"],
    ])
      native.write_file_sync(
        path.join(temp.path, name!),
        godot_pack_fixture(
          new Map([
            ["main.gd", Buffer.from(text!)],
            ["project.binary", godot_project_fixture()],
          ]),
        ),
      );
    let game = (await discover_godot_source(temp.path, native))!;
    if (reverse)
      game = apply_godot_pack_order(game, {
        game_root: temp.path,
        ordered_pcks: ["patch10.pck", "patch2.pck"],
      });
    await prepare_game_source({ kind: "game", file_type: "GODOT", game }, native);
    expect(native.read_file(path.join(temp.path, "main.gd")).toString()).toBe(
      reverse ? "second" : "tenth",
    );
    expect(native.read_file(path.join(temp.path, "project.binary"))).toEqual(config);
    for (const name of ["patch2.pck", "patch10.pck"]) {
      const handle = await native.open_file(path.join(temp.path, name), "r");
      try {
        expect((await read_pack(handle)).members).toEqual([]);
      } finally {
        await handle.close();
      }
    }
    expect((await discover_godot_source(temp.path, native))!.external).toEqual([]);
  },
);

it.each([false, true])(
  "自动定位密钥，加密目录=%s 和加密成员完整准备",
  async (encrypt_directory) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-key-"));
    const native = new NativeFs(),
      key = Buffer.alloc(32, 73),
      files = create_godot_fixture();
    files.set("empty", Buffer.alloc(0));
    native.write_file_sync(
      path.join(temp.path, "game.exe"),
      godot_pack_fixture(files, {
        prefix: godot_executable_fixture(key),
        version: 4,
        encryption_key: key,
        encrypt_directory,
        resource_prefix: false,
        encrypted_members: ["empty", "project.binary"],
      }),
    );
    const game = (await discover_godot_source(temp.path, native))!;
    await prepare_game_source({ kind: "game", file_type: "GODOT", game }, native);
    expect(native.read_file(path.join(temp.path, "project.binary"))).toEqual(
      files.get("project.binary"),
    );
  },
);

it("被覆盖成员的损坏仍阻止提交，全部原载体保留", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-hidden-corruption-"));
  const native = new NativeFs(),
    main = godot_pack_fixture(
      new Map([
        ["project.binary", Buffer.from("base")],
        ["main.gd", Buffer.from("old")],
      ]),
    );
  main[main.length - 16] = 77;
  const patch = godot_pack_fixture(new Map([["main.gd", Buffer.from("new")]]));
  native.write_file_sync(path.join(temp.path, "game.pck"), main);
  native.write_file_sync(path.join(temp.path, "patch.pck"), patch);
  const game = (await discover_godot_source(temp.path, native))!;
  await expect(
    prepare_game_source({ kind: "game", file_type: "GODOT", game }, native),
  ).rejects.toThrow("MD5");
  expect(native.read_file(path.join(temp.path, "game.pck"))).toEqual(main);
  expect(native.read_file(path.join(temp.path, "patch.pck"))).toEqual(patch);
  expect(fs.existsSync(path.join(temp.path, "backup_lg"))).toBe(false);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});
