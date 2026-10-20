import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../native/native-fs";
import { font_fixture } from "../../test/font-fixture";
import { wolf_files } from "../../test/wolf-fixture";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { GameFontService } from "./game-font-service";
import { GamePrepareWorker } from "./shared/game/prepare-worker";
import { create_godot_fixture, godot_pack_fixture } from "../../test/godot-fixture";
import { read_resource } from "./godot/resource";

const native = new NativeFs();

it.each(["pck", "embedded"])("Godot %s 字体接入、载体备份与重复换字体", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-godot-"));
  const root = path.join(temp.path, "game");
  const files = create_godot_fixture();
  const mapping = Buffer.from(
    '[remap]\nimporter="font_data_dynamic"\ntype="FontFile"\nuid="uid://test"\npath="res://old.fontdata"\n',
  );
  files.set("font.ttf.import", mapping);
  const prefix = Buffer.from("engine prefix");
  const carrier = kind === "pck" ? "game.pck" : "game.exe";
  const pack = godot_pack_fixture(files, kind === "pck" ? {} : { prefix });
  native.write_file_sync(path.join(root, carrier), pack);
  const request = { game_path: root, font_path: path.join(temp.path, "custom.ttf") };
  const execute = vi.fn(new GamePrepareWorker(null, native).run);
  const service = new GameFontService(new RuntimeOperationGate(), execute, native);
  for (const family of ["First", "Second"]) {
    const font = font_fixture([{ text: family }]);
    fs.writeFileSync(request.font_path, font);
    await service.inspect(request);
    await service.apply(request);
    expect(
      read_resource(fs.readFileSync(path.join(root, "lg_font.fontdata"))).properties[0]!.value
        .value,
    ).toEqual(font);
    expect(fs.readFileSync(path.join(root, "backup_lg/font.ttf.import"))).toEqual(mapping);
    expect(fs.readFileSync(path.join(root, "backup_lg", carrier))).toEqual(pack);
    expect(fs.readFileSync(path.join(root, "project.binary"))).toEqual(files.get("project.binary"));
    expect(fs.readFileSync(path.join(root, "font.ttf.import"), "utf8")).toBe(
      mapping.toString().replace("res://old.fontdata", "res://lg_font.fontdata"),
    );
    expect(fs.existsSync(path.join(root, ".tmp"))).toBe(false);
  }
  if (kind === "embedded") expect(fs.readFileSync(path.join(root, carrier))).toEqual(prefix);
  else expect(fs.existsSync(path.join(root, carrier))).toBe(false);
  expect(execute).toHaveBeenCalledTimes(1); // 已展开后的换字体不再启动准备任务。
});

it.each(["inspect", "apply"] as const)("%s 拒绝未登记字体能力的 RGSS", async (method) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-rgss-"));
  const root = path.join(temp.path, "game");
  native.write_file_sync(path.join(root, "Game.ini"), "[Game]\nScripts=Data/Scripts.rvdata2");
  native.write_file_sync(path.join(root, "Data/System.rvdata2"), Buffer.from([4, 8, 48]));
  const font_path = path.join(temp.path, "font.ttf");
  fs.writeFileSync(font_path, font_fixture([{ text: "Test" }]));
  const execute = vi.fn(new GamePrepareWorker(null, native).run);
  const service = new GameFontService(new RuntimeOperationGate(), execute, native);
  await expect(service[method]({ game_path: root, font_path })).rejects.toMatchObject({
    code: "file.invalid_structure",
  });
  expect(execute).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(root, "backup_lg"))).toBe(false);
});

it("Godot 没有字体导入时保留封包，不提交解包文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-godot-empty-"));
  const root = path.join(temp.path, "game");
  const pack = godot_pack_fixture(create_godot_fixture());
  native.write_file_sync(path.join(root, "game.pck"), pack);
  const font_path = path.join(temp.path, "font.ttf");
  fs.writeFileSync(font_path, font_fixture([{ text: "Test" }]));
  const service = new GameFontService(
    new RuntimeOperationGate(),
    new GamePrepareWorker(null, native).run,
    native,
  );
  await expect(service.apply({ game_path: root, font_path })).rejects.toThrow(
    "No font files found",
  );
  expect(fs.readdirSync(root)).toEqual(["game.pck"]);
  expect(fs.readFileSync(path.join(root, "game.pck"))).toEqual(pack);
});

/** 游戏以启动程序定位，字体放在游戏目录旁。 */
function write_game(root: string): { font_path: string; game_path: string } {
  const game_root = path.join(root, "game");
  for (const [name, bytes] of [...wolf_files(), ["Game.exe", "launcher"] as const])
    native.write_file_sync(path.join(game_root, name), bytes);
  const font_path = path.join(root, "custom.ttf");
  fs.writeFileSync(font_path, font_fixture([{ text: "Custom Gothic" }]));
  return { font_path, game_path: path.join(game_root, "Game.exe") };
}

it("拒绝无效请求、非字体文件和不支持的游戏", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-reject-"));
  const { font_path, game_path } = write_game(temp.path);
  const service = new GameFontService(
    new RuntimeOperationGate(),
    new GamePrepareWorker(null, native).run,
    native,
  );
  const bad_font = path.join(temp.path, "broken.ttf");
  fs.writeFileSync(bad_font, "not a font");
  await expect(service.inspect({ font_path, game_path: "" })).rejects.toMatchObject({
    code: "request.validation_failed",
  });
  await expect(service.inspect({ font_path: bad_font, game_path })).rejects.toMatchObject({
    code: "file.parse_failed",
  });
  await expect(
    service.inspect({ font_path, game_path: path.join(path.dirname(game_path), "Data/MapData") }),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});

it("写入占用持续到解包与替换结束，期间拒绝重复提交", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-busy-"));
  const request = write_game(temp.path);
  const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  const service = new GameFontService(
    new RuntimeOperationGate(),
    async (task, signal) => {
      enter();
      await released;
      return new GamePrepareWorker(null, native).run(task, signal);
    },
    native,
  );
  await service.inspect(request);
  const first = service.apply(request);
  await entered;
  await expect(service.apply(request)).rejects.toMatchObject({ code: "runtime.busy" });
  release();
  await first;
  expect(
    fs.existsSync(path.join(path.dirname(request.game_path), path.basename(request.font_path))),
  ).toBe(true);
});

it("游戏目录与启动程序走同一检查与修改流程", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-directory-"));
  const { font_path, game_path } = write_game(temp.path);
  const request = { font_path, game_path: path.dirname(game_path) };
  const service = new GameFontService(
    new RuntimeOperationGate(),
    new GamePrepareWorker(null, native).run,
    native,
  );
  await service.inspect(request);
  await service.apply(request);
  expect(fs.existsSync(path.join(request.game_path, path.basename(font_path)))).toBe(true);
});

it.each(["inspect", "apply"] as const)(
  "%s 拒绝内容有效但扩展名不支持的字体，保留游戏和备份",
  async (method) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-extension-"));
    const request = write_game(temp.path);
    const local = new NativeFs();
    const root = path.dirname(request.game_path);
    const font_path = path.join(temp.path, "custom.bin");
    fs.renameSync(request.font_path, font_path);
    local.write_file_sync(path.join(root, "custom.bin"), "original file");
    local.write_file_sync(path.join(root, "backup_lg/keep"), "original backup");
    const service = new GameFontService(
      new RuntimeOperationGate(),
      new GamePrepareWorker(null, local).run,
      local,
    );
    await expect(service[method]({ ...request, font_path })).rejects.toMatchObject({
      code: "file.parse_failed",
    });
    for (const [name, bytes] of wolf_files())
      expect(fs.readFileSync(path.join(root, name))).toEqual(bytes);
    expect(fs.readFileSync(path.join(root, "custom.bin"), "utf8")).toBe("original file");
    expect(fs.readdirSync(path.join(root, "backup_lg"))).toEqual(["keep"]);
    expect(fs.readFileSync(path.join(root, "backup_lg/keep"), "utf8")).toBe("original backup");
    expect(fs.existsSync(path.join(root, ".tmp"))).toBe(false);
  },
);

it("支持混合大小写扩展名并备份已有同名字体", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-supported-"));
  const request = write_game(temp.path);
  const root = path.dirname(request.game_path);
  const font_path = path.join(temp.path, "custom.OtF");
  fs.renameSync(request.font_path, font_path);
  const existing = "CUSTOM.OTF";
  native.write_file_sync(path.join(root, existing), "original font");
  const service = new GameFontService(
    new RuntimeOperationGate(),
    new GamePrepareWorker(null, native).run,
    native,
  );
  await service.inspect({ ...request, font_path });
  await service.apply({ ...request, font_path });
  expect(fs.readFileSync(path.join(root, existing))).toEqual(fs.readFileSync(font_path));
  expect(fs.readFileSync(path.join(root, "backup_lg", existing), "utf8")).toBe("original font");
  expect(
    fs.readdirSync(root).filter((name) => name.toLowerCase() === existing.toLowerCase()),
  ).toEqual([existing]);
});
