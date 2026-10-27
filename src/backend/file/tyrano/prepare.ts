import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { extract_asar_member, read_asar, read_asar_member } from "../shared/asar";
import { BINARY_IO_CHUNK_BYTES, read_bytes } from "../shared/binary";
import { complete_game_preparation, type GamePreparation } from "../shared/game/preparation";
import { assert_regular_path } from "../source-file-paths";
import { read_tyrano_settings, tyrano_path, TYRANO_ARCHIVE, type TyranoSource } from "./source";

const FUSE_SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"); // Electron 12 起在启动程序中写入的 fuse 标记。
const FUSE_VERSION = 1; // 已知的 fuse 布局版本。
const FUSE_ENABLED = "1".charCodeAt(0); // 开关字节为 `0` 关闭、`1` 开启、`r` 移除。
const FUSE_ASAR_INTEGRITY = 4; // EnableEmbeddedAsarIntegrityValidation
const FUSE_ONLY_ASAR = 5; // OnlyLoadAppFromAsar

/** 展开活动归档到 `resources/app`，归档退役与展开文件由同一目录事务提交。 */
export async function stage_tyrano_source(
  { game, staging }: Readonly<{ game: TyranoSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  assert(game.archive === TYRANO_ARCHIVE, "TyranoScript game has no archive to prepare");
  await assert_loose_app_loadable(game.root, fs, signal);
  const archive = path.join(game.root, game.archive);
  assert_regular_path(archive, fs);
  const handle = await fs.open_file(archive, "r");
  try {
    const before = await handle.stat();
    const members = read_asar(archive, fs);
    const { syntax } = await read_tyrano_settings(async (name) => {
      const member = members.get(name);
      return member
        ? new TextDecoder().decode(await read_asar_member(handle, archive, member, fs))
        : null;
    });
    assert.deepEqual(
      syntax,
      game.syntax,
      "TyranoScript engine settings changed after discovery; import again",
    );
    const writes: string[] = [];
    for (const [name, member] of members) {
      signal?.throwIfAborted();
      const target = tyrano_path(game, name);
      await extract_asar_member(handle, archive, member, path.join(staging, target), fs, signal);
      writes.push(target);
    }
    const after = await handle.stat();
    const disk = fs.stat(archive);
    for (const key of ["size", "mtimeMs", "ino"] as const)
      assert(
        after[key] === before[key] && disk[key] === before[key],
        "TyranoScript archive changed during preparation",
      );
    return complete_game_preparation(staging, { writes, removes: [game.archive] });
  } finally {
    await handle.close();
  }
}

/** 展开后由 Electron 从目录加载，启动程序强制只读归档或校验归档时拒绝准备。 */
async function assert_loose_app_loadable(
  root: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  const launchers = fs
    .read_dirents(root)
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".exe");
  assert(
    launchers.length > 0,
    "TyranoScript launcher not found next to resources; select the game EXE directory",
  );
  for (const launcher of launchers) {
    const fuses = await read_fuses(path.join(root, launcher.name), fs, signal);
    if (fuses === null) continue; // 早于 fuse 的 Electron 没有加载限制。
    assert(fuses.version === FUSE_VERSION, "Unsupported Electron fuse layout: " + launcher.name);
    assert(
      fuses.wire[FUSE_ASAR_INTEGRITY] !== FUSE_ENABLED &&
        fuses.wire[FUSE_ONLY_ASAR] !== FUSE_ENABLED,
      "TyranoScript launcher only loads a verified app.asar; this game cannot be translated in place: " +
        launcher.name,
    );
  }
}

/** 分块查找标记，块之间保留标记长度的重叠。 */
async function read_fuses(
  file: string,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<{ version: number; wire: Buffer } | null> {
  const handle = await fs.open_file(file, "r");
  try {
    const size = (await handle.stat()).size;
    for (let at = 0; at < size; at += BINARY_IO_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const chunk = await read_bytes(
        handle,
        at,
        Math.min(BINARY_IO_CHUNK_BYTES + FUSE_SENTINEL.length, size - at),
      );
      const index = chunk.indexOf(FUSE_SENTINEL);
      if (index < 0) continue;
      const header = at + index + FUSE_SENTINEL.length;
      const [version, length] = await read_bytes(handle, header, 2);
      return { version: version!, wire: await read_bytes(handle, header + 2, length!) };
    }
    return null;
  } finally {
    await handle.close();
  }
}
