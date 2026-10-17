import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { type RGSSSource, RGSS_VERSIONS } from "./source";
import { extract_rgss_member, read_rgss_archive } from "./archive";
import type { GamePrepareExecution } from "../game/prepare-worker";
import { prepare_game_directory, type GamePreparation } from "../game/prepare";
import { assert_regular_path, validate_game_path } from "../source-file-paths";

/** RGSS 提供解包写入与原封装删除清单，共享入口负责提交和回滚。 */
export async function prepare_rgss_source(
  game: RGSSSource,
  fs: NativeFs,
  execute?: GamePrepareExecution,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!game.archive) return;
  await prepare_game_directory(
    game.root,
    fs,
    (staging) => {
      const task = { kind: "rgss" as const, game, staging };
      return execute ? execute(task, signal) : stage_rgss_source(task, fs, signal);
    },
    signal,
  );
}

/** 解包循环只写暂存目录，正式目录事务由调用者持有。 */
export async function stage_rgss_source(
  { game, staging }: Readonly<{ game: RGSSSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  signal?.throwIfAborted();
  const { root, version, archive } = game;
  if (!archive) return { writes: [] };
  assert_regular_path(path.join(root, archive), fs);
  const handle = await fs.open_file(path.join(root, archive), "r");
  try {
    const members = await read_rgss_archive(handle, signal);
    for (const member of members) {
      signal?.throwIfAborted();
      validate_game_path(member.name);
      if (member.name.toLowerCase() === archive.toLowerCase())
        throw new Error("RGSS member conflicts with archive");
      if (
        /^data\/.*\.(?:rxdata|rvdata2?)$/iu.test(member.name) &&
        path.extname(member.name).toLowerCase() !== RGSS_VERSIONS[version]
      )
        throw new Error("Mixed RGSS data versions: " + member.name);
      assert_regular_path(path.join(root, member.name), fs);
      await extract_rgss_member(handle, member, path.join(staging, member.name), fs, signal);
    }
    return {
      writes: members.map((member) => member.name),
      removes: [archive],
    };
  } finally {
    await handle.close();
  }
}
