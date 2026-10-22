import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { copy_range, type BinaryFileHandle } from "../shared/binary";
import { assert_game_path_spellings, assert_regular_path } from "../source-file-paths";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import type { GameDirectoryChanges } from "../shared/game/directory";
import { GODOT_RESOURCE_MAX_BYTES } from "./binary";
import {
  read_pack_member,
  extract_pack_member,
  read_pack,
  type PackMember,
  type GodotPack,
} from "./pack";
import { enable_system_fallback } from "./font";
import { create_empty_pack, is_startup_pack, type GodotSource } from "./source";
import { repair_executable } from "./executable";
import { create_pack_key_finder, type PackKeyProbe } from "./key";

const EXTRACTION_CONCURRENCY = 4;

/** worker 只写同卷暂存，全部载体及最终资源交给共享事务一次提交。 */
export async function stage_godot_source(
  { game, staging }: Readonly<{ game: GodotSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GameDirectoryChanges> {
  signal?.throwIfAborted();
  const carriers = [...(game.embedded ? [game.embedded] : []), ...game.external];
  if (!carriers.length) return { writes: [] };
  const handles: BinaryFileHandle[] = []; // 打开后立即登记，目录解析失败时也须关闭。
  const inputs: {
    file: string;
    handle: BinaryFileHandle;
    original: Awaited<ReturnType<BinaryFileHandle["stat"]>>;
    pack: GodotPack;
    key: Buffer | undefined; // 只留在准备 worker，来源快照和回包不携带密钥。
  }[] = [];
  let executable: BinaryFileHandle | undefined;
  let find_key: ReturnType<typeof create_pack_key_finder> | undefined;
  /** 首次解密时打开 EXE，本次载体集合共用一个密钥查找器。 */
  const key_for = async (probe: PackKeyProbe) => {
    if (!find_key) {
      executable = game.embedded ? handles[0]! : await fs.open_file(game.executable, "r");
      find_key = create_pack_key_finder(
        executable,
        game.embedded?.header.start ?? (await executable.stat()).size,
        signal,
      );
    }
    return find_key(probe);
  };
  try {
    for (const carrier of carriers) {
      assert_regular_path(carrier.file, fs);
      const handle = await fs.open_file(carrier.file, "r");
      handles.push(handle);
      const original = await handle.stat();
      let key: Buffer | undefined;
      if (carrier.header.flags & 1) {
        key = await key_for({
          payload: handle,
          offset: carrier.header.directory + 4,
          end: carrier.header.end,
          kind: "directory",
        });
      }
      const pack = await read_pack(handle, signal, key);
      const { members: _members, ...header } = pack;
      assert.deepEqual(header, carrier.header, "Godot carrier changed before preparation");
      if (!key) {
        const encrypted_members = pack.members.filter(
          (member) => member.encrypted && member.size > 0,
        );
        const encrypted =
          encrypted_members.find((member) => member.name === "project.binary") ??
          encrypted_members.sort((a, b) => a.size - b.size)[0];
        if (encrypted) {
          key = await key_for({
            payload: handle,
            offset: encrypted.offset,
            end: pack.end,
            kind: encrypted.name === "project.binary" ? "project" : "unknown",
          });
        }
      }
      inputs.push({ file: carrier.file, handle, original, pack, key });
    }
    // project.binary 是启动时读取的设置，不随运行期 load_resource_pack 重新加载。
    const settings = inputs.find((input) => input.file === game.settings_file);
    assert(
      settings?.pack.members.some((member) => member.name === "project.binary"),
      "Missing startup Godot project.binary",
    );
    const final = new Map<string, { input: (typeof inputs)[number]; member: PackMember }>();
    const all_names: string[] = [];
    for (const input of inputs) {
      for (const member of input.pack.members) {
        all_names.push(member.name);
        if (member.name === "project.binary" && input !== settings) continue;
        final.set(member.name, { input, member });
      }
    }
    assert_game_path_spellings(all_names);
    const paths = new ProjectAssetPathIndex();
    const reserved = new Set(
      [
        ...carriers.map((carrier) => path.basename(carrier.file)),
        path.basename(game.executable),
      ].map((name) => name.toLowerCase()),
    );
    for (const name of final.keys()) {
      paths.add(name);
      assert(
        !reserved.has(name.split("/")[0]!.toLowerCase()),
        "Godot member conflicts with carrier: " + name,
      );
    }
    for (const input of inputs) {
      for (const member of input.pack.members) {
        if (final.get(member.name)?.input === input) continue;
        // 仅校验被覆盖的原始资源，最终资源仍各写一次。
        const reader = read_pack_member(input.handle, member, signal, input.key);
        while (!(await reader.next()).done) signal?.throwIfAborted();
      }
    }
    const controller = new AbortController();
    const extraction_signal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const members = final.entries(); // 共享迭代器让每个最终成员只分配给一个消费循环。
    /** 消费最终成员，首个失败通过组内取消通知其他循环收尾。 */
    const extract = async () => {
      try {
        for (const [name, { input, member }] of members) {
          extraction_signal.throwIfAborted();
          await extract_pack_member(
            input.handle,
            member,
            path.join(staging, name),
            fs,
            extraction_signal,
            input.key,
          );
        }
      } catch (error) {
        controller.abort(error);
      }
    };
    // 全部消费循环收尾后才能关闭共享句柄或让目录事务清理暂存文件。
    await Promise.allSettled(Array.from({ length: EXTRACTION_CONCURRENCY }, extract));
    extraction_signal.throwIfAborted();
    // 字体修正串行执行，避免多个大资源的解码缓冲同时驻留。
    for (const [name, { member }] of final) {
      signal?.throwIfAborted();
      const destination = path.join(staging, name);
      if (name.endsWith(".fontdata")) {
        assert(member.size <= GODOT_RESOURCE_MAX_BYTES, "Font resource exceeds processing limit");
        const bytes = fs.read_file(destination),
          modified = enable_system_fallback(bytes);
        if (modified !== bytes) await fs.write_file(destination, modified);
      }
    }
    const writes = [...final.keys()];
    if (game.embedded) {
      const name = path.basename(game.executable),
        output = await fs.open_file(path.join(staging, name), "wx");
      try {
        await copy_range(inputs[0]!.handle, output, 0, game.embedded.header.start, 0, signal);
        await repair_executable(inputs[0]!.handle, output, game.embedded.header.start);
      } finally {
        await output.close();
      }
      writes.push(name);
    }
    for (const carrier of game.external) {
      if (is_startup_pack(carrier.file, game.executable)) continue;
      const name = path.basename(carrier.file);
      await fs.write_file(path.join(staging, name), create_empty_pack());
      writes.push(name);
    }
    for (const input of inputs) {
      const current = await input.handle.stat(),
        entry = fs.stat(input.file);
      for (const stat of [current, entry])
        assert(
          stat.size === input.original.size &&
            stat.mtimeMs === input.original.mtimeMs &&
            stat.ctimeMs === input.original.ctimeMs &&
            stat.ino === input.original.ino,
          "Godot carrier changed during preparation",
        );
    }
    // 内嵌 EXE 和其余外置包已由 writes 覆盖，启动包留在目录会被引擎优先加载。
    return {
      writes,
      removes: game.external
        .filter((carrier) => is_startup_pack(carrier.file, game.executable))
        .map((carrier) => path.basename(carrier.file)),
    };
  } finally {
    // 内嵌 EXE 复用包句柄，外置 EXE 的句柄由本次准备单独持有。
    if (executable && !handles.includes(executable)) await executable.close();
    for (const handle of handles) await handle.close();
  }
}
