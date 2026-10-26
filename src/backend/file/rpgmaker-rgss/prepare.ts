import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { type RGSSSource } from "./source";
import { extract_rgss_member, read_rgss_archive } from "./archive";
import {
  complete_game_preparation,
  source_diagnostic,
  type SourceDiagnostic,
  type GamePreparation,
} from "../shared/game/preparation";
import { assert_regular_path, validate_game_path } from "../source-file-paths";

/** 解包循环只写暂存目录，正式目录事务由调用者持有。 */
export async function stage_rgss_source(
  { game, staging }: Readonly<{ game: RGSSSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  signal?.throwIfAborted();
  const { root, archive } = game;
  if (!archive) return complete_game_preparation(staging, { writes: [] });
  assert_regular_path(path.join(root, archive), fs);
  const handle = await fs.open_file(path.join(root, archive), "r");
  try {
    const members = await read_rgss_archive(handle, signal);
    const sources = new Map<string, string | null>();
    const diagnostics: SourceDiagnostic[] = [];
    for (const member of members) {
      signal?.throwIfAborted();
      validate_game_path(member.name);
      if (member.name.toLowerCase() === archive.toLowerCase())
        throw new Error("RGSS member conflicts with archive");
      assert_regular_path(path.join(root, member.name), fs);
      const target = path.join(staging, member.name);
      try {
        await extract_rgss_member(handle, member, target, fs, signal);
        sources.set(member.name, target);
      } catch (error) {
        signal?.throwIfAborted();
        sources.set(member.name, null);
        diagnostics.push(source_diagnostic("read", error, member.name));
      }
    }
    if ([...sources.values()].includes(null))
      return { sources: { files: sources, excluded: [archive] }, changes: null, diagnostics };
    return complete_game_preparation(staging, {
      writes: members.map((member) => member.name),
      removes: [archive],
    });
  } finally {
    await handle.close();
  }
}
