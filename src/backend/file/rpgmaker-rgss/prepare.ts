import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { type RGSSSource, RGSS_VERSIONS } from "./source";
import { extract_rgss_member, read_rgss_archive } from "./archive";
import { prepare_game_directory } from "../shared/rpgmaker-prepare";
import { assert_regular_path, validate_game_path } from "../source-file-paths";

/** RGSS 提供解包写入与原封装删除清单，共享入口负责提交和回滚。 */
export async function prepare_rgss_source(
  game: RGSSSource,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!game.archive) return;
  const { root, version, archive } = game;
  await prepare_game_directory(
    root,
    fs,
    async (staging) => {
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
    },
    signal,
  );
}
