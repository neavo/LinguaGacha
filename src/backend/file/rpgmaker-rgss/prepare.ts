import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { type RGSSSource, RGSS_VERSIONS, script_path } from "./source";
import { extract_rgss_member, read_rgss_archive } from "./archive";
import {
  assert_regular_path,
  prepare_game_directory,
  validate_game_path,
} from "../shared/rpgmaker-prepare";

/** RGSS 提供展开清单与额外备份范围，目录提交由共享入口持有。 */
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
          backup: [
            "Game.ini",
            "Data",
            script_path(fs.read_file(path.join(root, "Game.ini")), version),
          ],
        };
      } finally {
        await handle.close();
      }
    },
    signal,
  );
}
