import { GAME_ENGINES, type GameSource } from "./engines";
import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../../native/native-fs";
import { write_game_directory } from "./directory";
import type { GamePrepareExecution } from "./prepare-worker";

export type GameFont = Readonly<{
  bytes: Uint8Array;
  file_name: string;
  families: readonly string[]; // WOLF 按族名加载，英文别名在前。。
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
  const capability = engine.font;
  assert(capability, "Unsupported game for font replacement: " + source.file_type);
  await write_game_directory(
    source.game.root,
    fs,
    async (staging) => {
      const prepared = engine.needs_stage(source, fs)
        ? await execute({ ...source, staging }, signal)
        : { writes: [] };
      signal?.throwIfAborted();
      const writes = new Set(prepared.writes);
      const files = await capability.collect(source, fs, signal, { staging, result: prepared });
      const outputs = capability.outputs(source, files, font);
      for (const [name, bytes] of outputs) {
        signal?.throwIfAborted();
        await fs.write_file(path.join(staging, name), bytes);
        writes.add(name);
      }
      return { ...prepared, writes: [...writes] };
    },
    signal,
  );
}
