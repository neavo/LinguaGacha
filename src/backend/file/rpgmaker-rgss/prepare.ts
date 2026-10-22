import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { type RGSSSource, RGSS_VERSIONS } from "./source";
import { extract_rgss_member, read_rgss_archive } from "./archive";
import type { GameDirectoryChanges } from "../shared/game/directory";
import { assert_regular_path, validate_game_path } from "../source-file-paths";

/** 解包循环只写暂存目录，正式目录事务由调用者持有。 */
export async function stage_rgss_source(
  { game, staging }: Readonly<{ game: RGSSSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GameDirectoryChanges> {
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
