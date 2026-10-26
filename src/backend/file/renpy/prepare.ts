import assert from "node:assert/strict";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import type { NativeFs } from "../../../native/native-fs";
import {
  assert_regular_path,
  collect_existing_files,
  assert_game_path_spellings,
} from "../source-file-paths";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import {
  complete_game_preparation,
  source_diagnostic,
  type SourceDiagnostic,
  type GamePreparation,
} from "../shared/game/preparation";
import type { BinaryFileHandle } from "../shared/binary";
import {
  read_archive,
  read_archive_member,
  copy_archive_member,
  type ArchiveMember,
} from "./archive";
import { source_digest, read_compiled_async } from "./compiled";
import { patch_script } from "./extract";
import { read_loading, resolve_loading } from "./loading";
import type { RenpySource } from "./source";
import { generated_members, is_generated_member } from "./generated";
import { PythonSession } from "./python-syntax";
import { read_profile } from "./profile";

type ArchiveInput = {
  name: string;
  handle: BinaryFileHandle;
  stat: Awaited<ReturnType<BinaryFileHandle["stat"]>>;
  members: Map<string, ArchiveMember>;
};
type PackedMember = { input: ArchiveInput; member: ArchiveMember };

/** 暂存器只写 staging，原归档与活动源码由共享目录事务移除。 */
export async function stage_renpy_source(
  { game, staging }: Readonly<{ game: RenpySource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  {
    using session = await PythonSession.create();
    assert.deepEqual(
      await read_profile(game.root, fs, signal, session),
      game.profile,
      "Ren'Py engine rules changed after discovery; import again",
    );
  }
  const loose = new Set<string>();
  collect_existing_files(game.root, "game", loose, fs, signal);
  for (const name of loose) if (/^game\/(?:cache|saves)\//u.test(name)) loose.delete(name);
  const files = new Map([...loose].map((name) => [name, path.join(game.root, name)]));
  const generated = generated_members(files, (name) => fs.read_file(files.get(name)!));
  const archives = [...loose]
    .filter(
      (name) =>
        name.endsWith(".rpa") &&
        (game.profile.archives === "recursive" || name.split("/").length === 2),
    )
    .sort((a, b) => {
      // 递归索引按归档 stem 排序。旧引擎先排列目录文件名，再去掉扩展名。
      const left = game.profile.archives === "recursive" ? a.slice(0, -4) : a;
      const right = game.profile.archives === "recursive" ? b.slice(0, -4) : b;
      return left < right ? 1 : left > right ? -1 : 0;
    });
  assert(
    ![...loose].some((name) => /\.(?:rpe|rpi)$/iu.test(name)),
    "Unsupported Ren'Py extension or protected archive; use a standard game layout",
  );
  const inputs: ArchiveInput[] = [];
  const opened: BinaryFileHandle[] = []; // 索引解析失败也必须关闭已经打开的句柄。
  try {
    const packed = new Map<string, PackedMember>(); // 归档按优先级遍历，同名成员只登记首个来源。
    const spellings = [...loose];
    for (const name of archives) {
      signal?.throwIfAborted();
      const handle = await fs.open_file(path.join(game.root, name), "r");
      opened.push(handle);
      const input = {
        name,
        handle,
        stat: await handle.stat(),
        members: await read_archive(handle, signal),
      };
      inputs.push(input);
      for (const member of input.members.values()) {
        assert(
          !/\.(?:rpa|rpe|rpi)$/iu.test(member.name),
          "Nested Ren'Py archive or extension would become active after extraction: " +
            input.name +
            " / " +
            member.name,
        );
        const relative = "game/" + member.name;
        assert(!is_generated_member(relative), "Reserved Ren'Py resource in archive: " + relative);
        spellings.push(relative);
        if (!packed.has(relative)) packed.set(relative, { input, member });
      }
    }
    assert_game_path_spellings(spellings);
    const normalized = new Map<string, string>();
    for (const name of spellings) {
      const key = name.normalize("NFC").toLowerCase(),
        prior = normalized.get(key);
      assert(
        prior === undefined || prior === name,
        "Ren'Py normalized path conflict: " + name + " / " + prior,
      );
      normalized.set(key, name);
    }
    const paths = new ProjectAssetPathIndex();
    for (const name of new Set(spellings)) paths.add(name);
    const is_source = (name: string) =>
      /\.rpym?$/u.test(name) || (game.profile.ren_python && name.endsWith("_ren.py"));
    const is_script = (name: string) => /\.rpym?c$/u.test(name);
    const snapshots = new Map<string, ReturnType<NativeFs["stat"]>>(); // 提交前复核本次实际读取的散装文件。
    /** 散装文件优先，准备期间只读取本轮选定的来源。 */
    const read = async (name: string): Promise<Buffer> => {
      const member = packed.get(name);
      if (loose.has(name)) {
        const file = path.join(game.root, name);
        assert_regular_path(file, fs);
        if (!snapshots.has(name)) snapshots.set(name, fs.stat(file));
        return Buffer.from(fs.read_file(file));
      }
      assert(member, "Missing Ren'Py member: " + name);
      return read_archive_member(member.input.handle, member.member);
    };
    const captured = new Map<string, Buffer>();
    const diagnostics: SourceDiagnostic[] = [];
    let loading_complete = true;
    const selected_files = new Map<string, string | null>();
    /** 部分准备只交付原字节，失败的加载补丁不能替代可靠原稿。 */
    const partial = async (): Promise<GamePreparation> => {
      for (const name of packed.keys())
        if (!selected_files.has(name)) selected_files.set(name, null);
      for (const [name, bytes] of captured) {
        const target = path.join(staging, "originals", name);
        await fs.write_file(target, bytes);
        selected_files.set(name, target);
      }
      return { sources: { files: selected_files, excluded: archives }, changes: null, diagnostics };
    };
    const sources: string[] = [];
    const source_pairs = new Set<string>();
    for (const name of loose) {
      if (!is_source(name) || generated.has(name)) continue;
      const compiled = name.endsWith("_ren.py") ? name.slice(0, -7) + ".rpyc" : name + "c";
      assert(!source_pairs.has(compiled), "Conflicting Ren'Py source forms: " + name);
      source_pairs.add(compiled);
      assert(
        !packed.has(compiled),
        "Cross-carrier Ren'Py source/compiled conflict: " + name + " / " + compiled,
      );
      assert(
        loose.has(compiled),
        "Missing compiled script for " + name + "; start the original game once, then import again",
      );
      const original = await read(name),
        compiled_bytes = await read(compiled);
      assert(
        compiled_bytes.subarray(0, 10).toString() === "RENPY RPC2" &&
          compiled_bytes
            .subarray(-16)
            .equals(source_digest(original, game.profile.digest, game.profile.salt)),
        "Stale compiled script for " + name + "; start the original game once before importing",
      );
      sources.push(name); // 源码留在目录里，引擎会用它重新编译，盖掉已修改的 .rpyc。
    }
    const changed = new Map<string, Buffer>();
    const declarations: Awaited<ReturnType<typeof read_loading>>["declarations"] = [];
    // 脚本发现使用初始化前的归档索引。普通 .py 与显式加载的 rpym 模块不提供主脚本初始化声明。
    for (const name of new Set([...loose, ...packed.keys()])) {
      await setImmediate();
      signal?.throwIfAborted();
      if (!name.endsWith(".rpyc") || generated.has(name) || /^game\/(?:cache|saves)\//u.test(name))
        continue;
      using session = await PythonSession.create();
      try {
        const bytes = await read(name);
        captured.set(name, bytes);
        const script = {
          bytes,
          slots: await read_compiled_async(bytes, signal),
          python2: game.profile.python_major === 2,
        };
        const loading = await read_loading(script, name, game.profile, session, signal);
        declarations.push(...loading.declarations);
        if (loading.changes.length)
          changed.set(name, await patch_script(script, [], loading.changes, session, signal));
      } catch (error) {
        signal?.throwIfAborted();
        loading_complete = false;
        selected_files.set(name, null);
        diagnostics.push(source_diagnostic("prepare", error, name));
      }
    }
    if (!loading_complete) return await partial();
    const loading = resolve_loading(
      declarations,
      game.profile,
      new Set([...loose, ...packed.keys()]),
    );
    const runtime_inputs =
      game.profile.archives === "top-level" && loading.archives
        ? loading.archives.flatMap((stem) =>
            inputs.filter((entry) => entry.name === "game/" + stem + ".rpa"),
          )
        : inputs;
    const runtime = new Map<string, PackedMember>();
    for (const input of runtime_inputs)
      for (const member of input.members.values()) {
        const name = "game/" + member.name;
        if (!runtime.has(name)) runtime.set(name, { input, member });
      }
    // 每个输出路径在此选定一次来源。后续写入和字体收集直接消费展开结果。
    const writes: string[] = [];
    for (const name of packed.keys()) {
      if (is_source(name) || /^game\/(?:cache|saves)\//u.test(name)) continue;
      const selected = is_script(name) ? packed.get(name) : runtime.get(name);
      if (!selected || (loose.has(name) && (is_script(name) || !loading.force))) continue;
      const { input, member } = selected;
      signal?.throwIfAborted();
      const target = path.join(staging, name);
      fs.ensure_parent_dir(target);
      try {
        const output = await fs.open_file(target, "wx");
        try {
          await copy_archive_member(input.handle, output, member, signal);
        } finally {
          await output.close();
        }
        writes.push(name);
        selected_files.set(name, target);
      } catch (error) {
        signal?.throwIfAborted();
        selected_files.set(name, null);
        diagnostics.push(source_diagnostic("read", error, name));
      }
    }
    if ([...selected_files.values()].includes(null)) return await partial();
    for (const [name, bytes] of changed) {
      try {
        await fs.write_file(path.join(staging, name), bytes);
        if (!writes.includes(name)) writes.push(name);
      } catch (error) {
        signal?.throwIfAborted();
        loading_complete = false;
        diagnostics.push(source_diagnostic("prepare", error, name));
      }
    }
    if (!loading_complete) return await partial();
    for (const input of inputs) {
      assert_regular_path(path.join(game.root, input.name), fs);
      const current = await input.handle.stat(),
        disk = fs.stat(path.join(game.root, input.name));
      for (const key of ["size", "mtimeMs", "ctimeMs", "ino"] as const)
        assert(
          current[key] === input.stat[key] && disk[key] === input.stat[key],
          "Ren'Py archive changed during preparation: " + input.name,
        );
    }
    for (const [name, original] of snapshots) {
      const file = path.join(game.root, name);
      assert_regular_path(file, fs);
      const current = fs.stat(file);
      for (const key of ["size", "mtimeMs", "ctimeMs", "ino"] as const)
        assert(current[key] === original[key], "Ren'Py input changed during preparation: " + name);
    }
    return complete_game_preparation(staging, { writes, removes: [...archives, ...sources] });
  } finally {
    await Promise.all(opened.map((handle) => handle.close()));
  }
}
