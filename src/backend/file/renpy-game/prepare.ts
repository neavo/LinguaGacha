import assert from "node:assert/strict";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { createHash } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import {
  assert_regular_path,
  collect_existing_files,
  assert_game_path_spellings,
} from "../source-file-paths";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import type { GamePreparation } from "../shared/game/prepare";
import { read_bytes, BINARY_IO_CHUNK_BYTES, type BinaryFileHandle } from "../shared/binary";
import {
  read_archive,
  read_archive_member,
  copy_archive_member,
  type ArchiveMember,
} from "./archive";
import { source_digest, read_compiled_async } from "./compiled";
import { patch_script } from "./extract";
import { script_codes, audit_code, code_diagnostic, type RenpyCode } from "./script";
import { generated_members, type RenpySource } from "./source";
import { PythonSession } from "./python-syntax";
import { read_profile } from "./profile";

type ArchiveInput = {
  name: string;
  handle: BinaryFileHandle;
  stat: Awaited<ReturnType<BinaryFileHandle["stat"]>>;
  members: Map<string, ArchiveMember>;
};
type PackedMember = { input: ArchiveInput; member: ArchiveMember };

/** 暂存器只写 staging，原归档与活动源码由共享目录事务移动并备份。 */
export async function stage_renpy_source(
  { game, staging }: Readonly<{ game: RenpySource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  using session = await PythonSession.create();
  assert.deepEqual(
    await read_profile(game.root, fs, signal, session),
    game.profile,
    "Ren'Py engine rules changed after discovery; import again",
  );
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
    .sort()
    .reverse();
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
    const final = new Map(packed);
    for (const name of loose) final.delete(name);
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
    const backups = [...archives];
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
      backups.push(name);
    }
    const changed = new Map<string, Buffer>();
    let force = false;
    const archive_orders: { file: string; names: string[] }[] = [];
    const force_values = new Set<string>();
    for (const name of new Set([...loose, ...packed.keys()])) {
      await setImmediate();
      signal?.throwIfAborted();
      if (generated.has(name) || /^game\/(?:cache|saves)\//u.test(name)) continue;
      if (!is_script(name) && !name.endsWith(".py")) continue;
      const bytes = await read(name);
      const script = is_script(name)
        ? {
            bytes,
            slots: await read_compiled_async(bytes, signal),
            python2: !game.profile.version.startsWith("8."),
          }
        : null;
      const codes = script
        ? script_codes(script)
        : [
            {
              source: bytes.toString("utf8"),
              mode: "exec",
              slot: null,
              edge: undefined,
              legacy: undefined,
              owner: "<module>",
              field: "source",
              phase: "runtime",
              target: "",
              display: false,
              translated: false,
              filename: name,
              line: 1,
            } satisfies RenpyCode,
          ];
      for (const code of codes) {
        const facts = await audit_code(
          code,
          name,
          session,
          !game.profile.version.startsWith("8."),
          signal,
        );
        const location =
          name +
          ": " +
          code_diagnostic(code, {
            start: 0,
            end: code.source?.length ?? 0,
            reason: "loading configuration",
          }).message;
        assert(
          !facts.bare_references.some((name) => name === "config" || name === "renpy.config") &&
            !facts.references.some(
              (name) =>
                [
                  "config.file_open_callback",
                  "config.searchpath",
                  "archive_handlers",

                  "__dict__",
                ].includes(name.replace(/^renpy\./u, "")) ||
                name.endsWith(".__dict__") ||
                name.endsWith(".archive_handlers"),
            ),
          "Unsupported loading configuration in " + location + "; restore standard engine loading",
        );
        for (const target of ["config.archives", "config.force_archives"]) {
          if (target === "config.archives" && game.profile.archives !== "top-level") continue;
          const references = facts.references.filter(
            (entry) => entry === target || entry === "renpy." + target,
          );
          if (!references.length) continue;
          const assignments = facts.assignments.filter((entry) => entry.target === target);
          assert(
            code.phase === "init",
            target + " requires unconditional initialization: " + location,
          );
          assert(
            assignments.length === references.length &&
              assignments.every((entry) => entry.root && entry.operation === "="),
            "Dynamic " + target + " in " + location + "; use one unconditional literal assignment",
          );
          for (const assignment of assignments) {
            if (target === "config.archives") {
              const names = assignment.value;
              assert(
                Array.isArray(names) &&
                  names.every((entry): entry is string => typeof entry === "string"),
                "Dynamic archive order in " + location,
              );
              assert(
                names.every(
                  (entry) => /^[^/\\:]+$/u.test(entry) && entry !== "." && entry !== "..",
                ),
                "External archive path in " + location,
              );
              archive_orders.push({ file: name, names });
            } else {
              assert(
                script && typeof assignment.value === "boolean",
                "Dynamic force_archives in " + location,
              );
              force_values.add(String(assignment.value));
              if (assignment.value) {
                force = true;
                changed.set(name, await patch_script(script, [], true, session, signal));
              }
            }
          }
        }
      }
    }
    assert(
      force_values.size <= 1,
      "Ren'Py switches force_archives during execution; keep a single static loading mode",
    );
    /** 顺序变化只有在资源字节相同时才允许合并，摘要计算保持有界内存。 */
    const hash_member = async (entry: PackedMember): Promise<string> => {
      const hash = createHash("sha256");
      for (const part of entry.member.parts) {
        hash.update(part.prefix);
        for (let at = 0; at < part.size; at += BINARY_IO_CHUNK_BYTES) {
          signal?.throwIfAborted();
          hash.update(
            await read_bytes(
              entry.input.handle,
              part.offset + at,
              Math.min(BINARY_IO_CHUNK_BYTES, part.size - at),
            ),
          );
        }
      }
      return hash.digest("hex");
    };
    for (const order of archive_orders) {
      const after = new Map<string, PackedMember>();
      for (const stem of order.names) {
        const input = inputs.find((entry) => entry.name === "game/" + stem + ".rpa");
        assert(input, "Unknown archive " + stem + " in " + order.file);
        for (const member of input.members.values())
          if (!after.has("game/" + member.name))
            after.set("game/" + member.name, { input, member });
      }
      for (const [name, before] of packed) {
        if (is_script(name) || is_source(name) || (!force && loose.has(name))) continue;
        const selected = after.get(name);
        assert(
          selected &&
            (selected.input === before.input ||
              (await hash_member(selected)) === (await hash_member(before))),
          "Archive source changes between initialization phases: " +
            name +
            " in " +
            order.file +
            "; keep one resource source before preparation",
        );
      }
    }
    if (force)
      for (const [name, member] of packed)
        if (!is_script(name) && !is_source(name) && loose.has(name)) {
          final.set(name, member);
          backups.push(name);
        }
    const writes: string[] = [];
    for (const [name, { input, member }] of final) {
      signal?.throwIfAborted();
      if (is_source(name) || /^game\/(?:cache|saves)\//u.test(name)) continue;
      assert(
        !/\/zz_lg_(?:language|strings)\.rpym?c?$/iu.test(name),
        "Reserved Ren'Py resource in archive: " + name,
      );
      const target = path.join(staging, name);
      fs.ensure_parent_dir(target);
      const output = await fs.open_file(target, "wx");
      try {
        await copy_archive_member(input.handle, output, member, signal);
      } finally {
        await output.close();
      }
      writes.push(name);
    }
    for (const [name, bytes] of changed) {
      if (loose.has(name)) backups.push(name);
      await fs.write_file(path.join(staging, name), bytes);
      if (!writes.includes(name)) writes.push(name);
    }
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
    return { writes, backups: [...new Set(backups)] };
  } finally {
    await Promise.all(opened.map((handle) => handle.close()));
  }
}
