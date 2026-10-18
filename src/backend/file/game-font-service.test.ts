import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../native/native-fs";
import { font_fixture } from "../../test/font-fixture";
import { wolf_files } from "../../test/wolf-fixture";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { GameFontService } from "./game-font-service";
import { GamePrepareWorker } from "./shared/game/prepare-worker";

const native = new NativeFs();

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
