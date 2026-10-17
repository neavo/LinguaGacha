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
  for (const [name, bytes] of [...wolf_files(), ["Game.exe", "launcher"] as const])
    native.write_file_sync(path.join(root, name), bytes);
  const font_path = path.join(root, "..", path.basename(root) + "-custom.ttf");
  fs.writeFileSync(font_path, font_fixture([{ text: "Custom Gothic" }]));
  return { font_path, game_path: path.join(root, "Game.exe") };
}

it("拒绝无效请求、非字体文件和不支持的游戏", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-reject-"));
  const { font_path } = write_game(temp.path);
  const service = new GameFontService(
    new RuntimeOperationGate(),
    new GamePrepareWorker(null, native).run,
    native,
  );
  const bad_font = path.join(temp.path, "Data/BasicData/Game.dat");
  await expect(service.inspect({ font_path, game_path: "" })).rejects.toThrow(
    "The request parameters are invalid.",
  );
  await expect(service.inspect({ font_path: bad_font, game_path: temp.path })).rejects.toThrow(
    "Unsupported font file",
  );
  await expect(
    service.inspect({ font_path, game_path: path.join(temp.path, "Data/MapData") }),
  ).rejects.toThrow("Unsupported game for font replacement");
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
  await expect(service.inspect(request)).resolves.toEqual({});
  const first = service.apply(request);
  await entered;
  await expect(service.apply(request)).rejects.toThrow(
    "The runtime is occupied by another operation.",
  );
  release();
  await first;
  expect(fs.existsSync(path.join(temp.path, path.basename(request.font_path)))).toBe(true);
});
