import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { copy_range } from "../shared/binary";
import { assert_regular_path } from "../source-file-paths";
import type { GamePreparation } from "../shared/game/prepare";
import { GODOT_RESOURCE_MAX_BYTES } from "./binary";
import { read_pack, extract_pack_member } from "./pack";
import { enable_system_fallback } from "./font";
import type { GodotSource } from "./source";

/** worker 只写同卷暂存，原载体由正式目录事务移动并负责失败回滚。 */
export async function stage_godot_source(
  { game, staging }: Readonly<{ game: GodotSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  signal?.throwIfAborted();
  if (!game.carrier) return { writes: [] };
  const file = game.carrier.kind === "pck" ? game.carrier.file : game.executable;
  assert_regular_path(file, fs);
  const input = await fs.open_file(file, "r");
  try {
    const original = await input.stat();
    const pack = await read_pack(input, signal);
    assert.equal(pack.engine.join("."), game.engine, "Godot engine changed before preparation");
    assert.equal(
      pack.start,
      game.carrier.kind === "embedded" ? game.carrier.start : 0,
      "Godot carrier changed before preparation",
    );
    assert(
      pack.members.some((member) => member.name === "project.binary"),
      "Missing Godot project.binary",
    );
    const carrier = path.basename(file);
    for (const member of pack.members) {
      signal?.throwIfAborted();
      assert(
        member.name.toLowerCase() !== carrier.toLowerCase(),
        "Godot member conflicts with carrier",
      );
      const destination = path.join(staging, member.name);
      await extract_pack_member(input, member, destination, fs, signal);
      if (member.name.endsWith(".fontdata")) {
        assert(member.size <= GODOT_RESOURCE_MAX_BYTES, "Font resource exceeds processing limit");
        const original = fs.read_file(destination),
          modified = enable_system_fallback(original);
        if (modified !== original) await fs.write_file(destination, modified);
      }
    }
    const writes = pack.members.map((member) => member.name);
    if (game.carrier.kind === "embedded") {
      const destination = path.join(staging, carrier);
      const output = await fs.open_file(destination, "wx");
      try {
        await copy_range(input, output, 0, pack.start, 0, signal);
      } finally {
        await output.close();
      }
      writes.push(carrier);
    }
    const current = await input.stat(),
      entry = fs.stat(file);
    for (const stat of [current, entry])
      assert(
        stat.size === original.size &&
          stat.mtimeMs === original.mtimeMs &&
          stat.ctimeMs === original.ctimeMs &&
          stat.ino === original.ino,
        "Godot carrier changed during preparation",
      );
    return { writes, backups: [carrier] };
  } finally {
    await input.close();
  }
}
