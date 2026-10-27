import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { write_tyrano_app } from "../../../test/tyrano-fixture";
import { stage_tyrano_source } from "./prepare";
import { discover_tyrano_source } from "./source";

/** 启动程序只需带 fuse 区段：标记、版本 1、长度与各开关字节。 */
function launcher(wire: string | null): Buffer {
  if (wire === null) return Buffer.from("MZ old electron");
  return Buffer.concat([
    Buffer.from("MZ"),
    Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"),
    Buffer.from([1, wire.length]),
    Buffer.from(wire),
  ]);
}

/** 构造归档与启动器，再按真实来源发现取得准备输入。 */
async function packed_game(root: string, native: NativeFs, wire: string | null) {
  write_tyrano_app(native, path.join(root, "source"));
  await createPackage(path.join(root, "source"), path.join(root, "game/resources/app.asar"));
  native.write_file_sync(path.join(root, "game/Game.exe"), launcher(wire));
  return (await discover_tyrano_source(path.join(root, "game"), native))!;
}

it.each([null, "1011000"])("活动归档展开到应用目录并随事务退役：fuse %j", async (wire) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-stage-"));
  const native = new NativeFs();
  const game = await packed_game(temp.path, native, wire);
  const staging = path.join(temp.path, "stage");
  const prepared = await stage_tyrano_source({ game, staging }, native);
  expect(prepared.changes?.removes).toEqual(["resources/app.asar"]);
  expect(prepared.changes?.writes).toContain("resources/app/data/scenario/first.ks");
  expect(native.read_text_file(path.join(staging, "resources/app/data/scenario/first.ks"))).toBe(
    "こんにちは[p]\n",
  );
});

it.each(["0000100", "0000010"])("启动程序只加载或校验归档时拒绝准备：%s", async (wire) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-fuse-"));
  const native = new NativeFs();
  const game = await packed_game(temp.path, native, wire);
  await expect(
    stage_tyrano_source({ game, staging: path.join(temp.path, "stage") }, native),
  ).rejects.toThrow(/only loads a verified app\.asar/u);
  expect(fs.existsSync(path.join(temp.path, "stage"))).toBe(false);
});

it("取消在展开前生效", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-abort-"));
  const native = new NativeFs();
  const game = await packed_game(temp.path, native, null);
  await expect(
    stage_tyrano_source(
      { game, staging: path.join(temp.path, "stage") },
      native,
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
  expect(fs.existsSync(path.join(temp.path, "stage"))).toBe(false);
});
