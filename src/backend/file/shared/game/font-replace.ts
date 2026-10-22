import { GAME_ENGINES, type GameSource } from "./engines";
import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../../native/native-fs";
import { write_game_backup } from "./backup";
import { prepare_game_directory } from "./prepare";
import type { GamePrepareExecution } from "./prepare-worker";

export type GameFont = Readonly<{
  bytes: Uint8Array;
  file_name: string;
  families: readonly string[]; // 同一字体的内部族名别名，英文在前；仅 WOLF 按名称加载。
}>;

/** 解包结果与字体修改合成一份清单，由目录事务一次提交。 */
export async function replace_game_font(
  source: GameSource,
  font: GameFont,
  fs: NativeFs,
  execute: GamePrepareExecution,
  signal?: AbortSignal,
): Promise<void> {
  const engine = GAME_ENGINES[source.file_type];
  const font_outputs = engine.font_outputs;
  assert(font_outputs, "Unsupported game for font replacement: " + source.file_type);
  const root = source.game.root;
  await prepare_game_directory(
    root,
    fs,
    async (staging) => {
      const prepared = engine.needs_stage(source, fs)
        ? await execute({ ...source, staging }, signal)
        : { writes: [] };
      signal?.throwIfAborted();
      const writes = new Set(prepared.writes);
      const files = await engine.collect(source, fs, signal, { staging, result: prepared });
      const outputs = font_outputs(source, files, font);
      // 修改暂存文件前已读定原字节，备份成功后才允许游戏事务提交。
      await write_game_backup(root, new Map([...files.data, ...files.fonts]), fs, signal);
      for (const [name, bytes] of outputs) {
        signal?.throwIfAborted();
        const target = path.join(staging, name);
        await fs.make_dir_async(path.dirname(target));
        await fs.write_file(target, bytes);
        writes.add(name);
      }
      return { ...prepared, writes: [...writes] };
    },
    signal,
  );
}
