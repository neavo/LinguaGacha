import assert from "node:assert/strict";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { copy_range, type BinaryFileHandle } from "../shared/binary";
import { assert_game_path_spellings, assert_regular_path } from "../source-file-paths";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import {
  complete_game_preparation,
  source_diagnostic,
  type SourceDiagnostic,
  type GamePreparation,
} from "../shared/game/preparation";
import { GODOT_RESOURCE_MAX_BYTES } from "./binary";
import { extract_pack_member, read_pack, type PackMember, type GodotPack } from "./pack";
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
): Promise<GamePreparation> {
  signal?.throwIfAborted();
  const carriers = [...(game.embedded ? [game.embedded] : []), ...game.external];
  if (!carriers.length) return complete_game_preparation(staging, { writes: [] });
  const handles: BinaryFileHandle[] = []; // 打开后立即登记，目录解析失败时也须关闭。
  const inputs: {
    file: string;
    handle: BinaryFileHandle;
    original: Awaited<ReturnType<BinaryFileHandle["stat"]>>;
    pack: GodotPack;
    key: Buffer | undefined; // 只留在准备 worker，来源快照和回包不携带密钥。
  }[] = [];
  let executable: BinaryFileHandle | undefined;
  let find_key: Promise<ReturnType<typeof create_pack_key_finder>> | undefined;
  /** 首次解密时打开 EXE，本次载体集合共用一个密钥查找器。 */
  const key_for = async (probe: PackKeyProbe) => {
    find_key ??= (async () => {
      executable = game.embedded ? handles[0]! : await fs.open_file(game.executable, "r");
      return create_pack_key_finder(
        executable,
        game.embedded?.header.start ?? (await executable.stat()).size,
        signal,
      );
    })();
    return (await find_key)(probe);
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
    const diagnostics: SourceDiagnostic[] = [];
    const sources = new Map<string, string | null>([...final.keys()].map((name) => [name, null]));
    const keys = new Map<(typeof inputs)[number], Promise<Buffer>>();
    const members = final.entries();
    const extract = async () => {
      for (const [name, { input, member }] of members) {
        signal?.throwIfAborted();
        try {
          if (member.encrypted && member.size > 0 && !input.key) {
            let pending = keys.get(input);
            if (!pending) {
              const candidates = [...final.values()]
                .filter(
                  (entry) =>
                    entry.input === input && entry.member.encrypted && entry.member.size > 0,
                )
                .map((entry) => entry.member);
              const probe =
                candidates.find((entry) => entry.name === "project.binary") ??
                candidates.sort((a, b) => a.size - b.size)[0]!;
              pending = key_for({
                payload: input.handle,
                offset: probe.offset,
                end: input.pack.end,
                kind: probe.name === "project.binary" ? "project" : "unknown",
              });
              keys.set(input, pending);
            }
            input.key = await pending;
          }
          const target = path.join(staging, name);
          await extract_pack_member(input.handle, member, target, fs, signal, input.key);
          sources.set(name, target);
        } catch (error) {
          signal?.throwIfAborted();
          diagnostics.push(source_diagnostic("read", error, name));
        }
      }
    };
    const results = await Promise.allSettled(
      Array.from({ length: EXTRACTION_CONCURRENCY }, extract),
    );
    signal?.throwIfAborted();
    for (const result of results) if (result.status === "rejected") throw result.reason;
    // 字体修正串行执行，避免多个大资源的解码缓冲同时驻留。
    for (const [name, { member }] of final) {
      signal?.throwIfAborted();
      const destination = path.join(staging, name);
      if (sources.get(name) && name.endsWith(".fontdata")) {
        try {
          assert(member.size <= GODOT_RESOURCE_MAX_BYTES, "Font resource exceeds processing limit");
          const bytes = fs.read_file(destination),
            modified = enable_system_fallback(bytes);
          if (modified !== bytes) fs.write_file_atomic(destination, modified);
        } catch (error) {
          signal?.throwIfAborted();
          diagnostics.push(source_diagnostic("prepare", error, name));
        }
      }
    }
    let conversion_complete = ![...sources.values()].includes(null);
    const writes = [...final.keys()];
    try {
      if (conversion_complete) {
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
      }
    } catch (error) {
      signal?.throwIfAborted();
      conversion_complete = false;
      diagnostics.push(source_diagnostic("prepare", error));
    }
    // 来源变化会使读取结果失效，不能降级为单纯转换失败。
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
    if (!conversion_complete)
      return { sources: { files: sources, excluded: [] }, changes: null, diagnostics };
    // 内嵌 EXE 和其余外置包已由 writes 覆盖，启动包留在目录会被引擎优先加载。
    const prepared = complete_game_preparation(staging, {
      writes,
      removes: game.external
        .filter((carrier) => is_startup_pack(carrier.file, game.executable))
        .map((carrier) => path.basename(carrier.file)),
    });
    return { ...prepared, diagnostics };
  } finally {
    // 内嵌 EXE 复用包句柄，外置 EXE 的句柄由本次准备单独持有。
    if (executable && !handles.includes(executable)) await executable.close();
    for (const handle of handles) await handle.close();
  }
}
