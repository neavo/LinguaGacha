import path from "node:path";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import { prepare_game_directory, type GamePreparation } from "../shared/game/prepare";
import type { GamePrepareExecution } from "../shared/game/prepare-worker";
import {
  assert_game_path_spellings,
  assert_regular_path,
  collect_existing_files,
  validate_game_path,
} from "../source-file-paths";
import { read_wolf_archive, extract_wolf_member, type WolfArchive } from "./archive";
import type { BinaryFileHandle } from "../shared/binary";
import { create_wolf_context } from "./wolf-format";
import type { WolfSource } from "./source";
import { WolfProtocolError } from "./binary";
import { derive_archive_key, type WolfKeyType } from "./archive-crypt";
import { is_wolf_core, restore_wolf_core, restore_wolf_project } from "./protection";
import { create_wolfx_candidates, collect_wolfx_keys } from "./key-collector";
import { match_wolfx, write_wolfx_plaintext } from "./wolfx";
import { read_wolf_map } from "./map";
import { read_wolf_common } from "./common-events";

/** 所有来源统一在准备 worker 中构建明文视图，再由目录事务提交。 */
export async function prepare_wolf_source(
  game: WolfSource,
  fs: NativeFs,
  execute?: GamePrepareExecution,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await prepare_game_directory(
    game.root,
    fs,
    (staging) => {
      const task = { kind: "wolfrpg" as const, game, staging };
      return execute ? execute(task, signal) : stage_wolf_source(task, fs, signal);
    },
    signal,
  );
}

/** 原目录和暂存区构成单份文件视图，密文直到最终复核后才退出发布清单。 */
export async function stage_wolf_source(
  { game, staging }: Readonly<{ game: WolfSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  const files = new Map<string, string>(),
    original = new Set<string>(),
    directories = new Set<string>(),
    archive_targets = new ProjectAssetPathIndex(), // 跨归档的同名成员在展开前报冲突。
    staged = new Map<string, string>(),
    strict = new Set<string>();
  if (fs.exists(game.data_root)) collect_existing_files(game.root, "Data", original, fs);
  for (const name of original) files.set(name, path.join(game.root, name));
  const checkpoint = async () => {
    await setImmediate();
    signal?.throwIfAborted();
  };
  const write = async (name: string, bytes: Buffer) => {
    const target = path.join(staging, name);
    await fs.make_dir_async(path.dirname(target));
    await fs.write_file(target, bytes);
    files.set(name, target);
    staged.set(name, target);
  };
  const keys = new Map<WolfKeyType, Buffer>();
  /** 同类型的配套密钥按原字节去重，多个归档共用一次派生结果。 */
  const companion = async (mode: WolfKeyType): Promise<Buffer> => {
    const cached = keys.get(mode);
    if (cached) return cached;
    const candidates: Buffer[] = [];
    for (const entry of game.key_files.filter((entry) => entry.type === mode)) {
      await checkpoint();
      assert_regular_path(entry.source_path, fs);
      const content = fs.read_file(entry.source_path);
      if (!candidates.some((candidate) => candidate.equals(content))) candidates.push(content);
    }
    assert(
      candidates.length === 1,
      (candidates.length ? "Conflicting" : "Missing") + " WOLF companion key: " + mode,
    );
    const key = await derive_archive_key(candidates[0]!, mode, signal);
    keys.set(mode, key);
    return key;
  };
  const opened: Array<{
    handle: BinaryFileHandle;
    archive: WolfArchive;
    prefix: string;
  }> = [];
  try {
    for (const source of game.archives) {
      await checkpoint();
      assert_regular_path(source.source_path, fs);
      const handle = await fs.open_file(source.source_path, "r");
      let archive: WolfArchive;
      try {
        archive = await read_wolf_archive(handle, signal, companion);
      } catch (cause) {
        await handle.close();
        throw new Error(source.source_path + ": archive: " + read_error_message(cause), { cause });
      }
      opened.push({ handle, archive, prefix: source.output_prefix });
      directories.add(source.output_prefix);
      for (const directory of archive.directories)
        directories.add(source.output_prefix + "/" + directory);
      for (const member of archive.members) {
        const name = source.output_prefix + "/" + member.name;
        validate_game_path(name);
        archive_targets.add(name);
        assert_regular_path(path.join(game.root, name), fs);
      }
    }
    for (const { archive, prefix } of opened)
      for (const member of archive.members) {
        await checkpoint();
        const name = prefix + "/" + member.name,
          target = path.join(staging, name);
        await fs.make_dir_async(path.dirname(target));
        await extract_wolf_member(archive, member, target, fs, signal);
        files.set(name, target);
        staged.set(name, target);
      }
  } finally {
    await Promise.all(opened.map(({ handle }) => handle.close()));
  }

  const encrypted = new Map([...files].filter(([name]) => /\.wolfx$/iu.test(name)));
  const encrypted_targets = new Map([...encrypted.keys()].map((name) => [name.slice(0, -6), name]));
  // 配套密钥是保留成员，归档或 WolfX 的输出不能把它当作旧明文覆盖。
  for (const key of game.key_files) {
    const name = path.relative(game.root, key.source_path).replaceAll("\\", "/");
    assert(
      !staged.has(name) && !encrypted_targets.has(name),
      "WOLF output conflicts with companion key: " + name,
    );
  }
  assert_game_path_spellings([...files.keys(), ...directories, ...encrypted_targets.keys()]);
  // 原稿、归档输出与 WolfX 输出合并后，大小写重名或文件与目录重叠在解密前失败。
  const paths = new ProjectAssetPathIndex();
  for (const name of new Set([...files.keys(), ...encrypted_targets.keys()])) {
    validate_game_path(name);
    paths.add(name);
  }
  for (const name of encrypted_targets.keys())
    assert(!encrypted.has(name), "Conflicting WOLFX ciphertext target: " + name);
  const pending = new Set(encrypted.keys()),
    restored = new Set<string>(),
    parsed = new Set<string>(),
    projects = new Set<string>(),
    candidates = create_wolfx_candidates();
  const available = (name: string) => {
    const cipher = encrypted_targets.get(name);
    return cipher === undefined || !pending.has(cipher);
  };
  const failure = (name: string, stage: string, cause: unknown): Error =>
    new Error(name + ": " + stage + ": " + read_error_message(cause), {
      cause,
    });
  for (;;) {
    let progress = false;
    for (const [name, source] of files) {
      if (!available(name) || restored.has(name) || !is_wolf_core(name)) continue;
      await checkpoint();
      try {
        const result = await restore_wolf_core(name, fs.read_file(source), signal);
        if (result) {
          await write(name, result.bytes);
          strict.add(name);
          progress = true;
          if (result.protected && /\/(?:c?database|sysdatabase)\.dat$/iu.test(name))
            projects.add(name.slice(0, -4) + ".project");
        }
        restored.add(name);
      } catch (cause) {
        throw failure(name, "core protection", cause);
      }
    }
    for (const requested of projects) {
      const name = [...files.keys()].find((name) => name.toLowerCase() === requested.toLowerCase());
      if (!name || !available(name)) continue;
      await checkpoint();
      try {
        await write(name, await restore_wolf_project(fs.read_file(files.get(name)!), signal));
      } catch (cause) {
        throw failure(name, "project protection", cause);
      }
      strict.add(name);
      projects.delete(requested);
      progress = true;
    }
    // 密钥来源独立解析，不要求完整数据库集合；被 WolfX 遮蔽的旧明文不能提供候选。
    if (encrypted.size)
      for (const [name, source] of files) {
        if (
          !available(name) ||
          parsed.has(name) ||
          !(/\.mps$/iu.test(name) || /^Data\/BasicData\/CommonEvent\.dat$/iu.test(name))
        )
          continue;
        await checkpoint();
        try {
          const content = fs.read_file(source);
          if (/\.mps$/iu.test(name)) {
            for (const event of read_wolf_map(content).details.events)
              for (const page of event.pages) collect_wolfx_keys(page.commands, candidates);
          } else
            for (const event of read_wolf_common(content).details.events)
              collect_wolfx_keys(event.commands, candidates);
          parsed.add(name);
          strict.add(name);
        } catch (cause) {
          throw failure(name, "key collection", cause);
        }
      }
    const missing: string[] = [];
    for (const name of pending) {
      await checkpoint();
      const handle = await fs.open_file(encrypted.get(name)!, "r");
      try {
        const result = await match_wolfx(handle, candidates, signal);
        if (!result.match) {
          missing.push(
            name + ": WolfX: " + (result.missing.join(", ") || "no matching static candidate"),
          );
          continue;
        }
        const target_name = name.slice(0, -6),
          target = path.join(staging, target_name);
        assert_regular_path(path.join(game.root, target_name), fs);
        await fs.make_dir_async(path.dirname(target));
        const output = await fs.open_file(target, "w");
        try {
          await write_wolfx_plaintext(handle, output, result.match, signal);
        } finally {
          await output.close();
        }
        files.set(target_name, target);
        staged.set(target_name, target);
        strict.add(target_name);
        files.delete(name);
        staged.delete(name);
        pending.delete(name);
        progress = true;
      } catch (cause) {
        throw failure(name, "WolfX", cause);
      } finally {
        await handle.close();
      }
    }
    if (!progress) {
      assert(!pending.size, "Unresolved WOLF dependencies: " + missing.join("; "));
      assert(!projects.size, "Missing WOLF protected project: " + [...projects].join(", "));
      break;
    }
  }
  // 新解出的事件可能增加候选，全部已解密文必须参与最终歧义判断。
  for (const [name, source] of encrypted) {
    await checkpoint();
    const handle = await fs.open_file(source, "r");
    try {
      assert((await match_wolfx(handle, candidates, signal)).match, "WOLFX candidate lost");
    } catch (cause) {
      throw failure(name, "final candidate validation", cause);
    } finally {
      await handle.close();
    }
  }
  await validate_wolf_source(fs, files, strict, signal);
  return {
    writes: [...staged.keys()],
    directories: [...directories],
    removes: [
      ...game.archives.map((archive) =>
        path.relative(game.root, archive.source_path).replaceAll("\\", "/"),
      ),
      ...[...encrypted.keys()].filter((name) => original.has(name)),
    ],
  };
}

/** 核心和已识别协议在提交前完整解析，辅助文件按原稿保留。 */
async function validate_wolf_source(
  fs: NativeFs,
  files: ReadonlyMap<string, string>,
  strict: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<void> {
  const members = new Map(
    [...files.keys()]
      .filter((name) => /\.(?:dat|project|mps)$/iu.test(name))
      .map((name) => [
        name,
        {
          async: async (): Promise<Uint8Array> => {
            signal?.throwIfAborted();
            try {
              return fs.read_file(files.get(name)!);
            } catch (cause) {
              // 读取失败尚未取得原稿，不能按成员解析警告继续提交。
              throw new AppError("file.io_failed", {
                cause,
                message: name + ": " + read_error_message(cause),
              });
            }
          },
        },
      ]),
  );
  const context = await create_wolf_context(members);
  for (const [name, member] of members) {
    signal?.throwIfAborted();
    try {
      await context.read(name, await member.async());
    } catch (cause) {
      signal?.throwIfAborted();
      if (
        !strict.has(name) &&
        !(cause instanceof AppError) &&
        !(cause instanceof WolfProtocolError) &&
        (/\.mps$/iu.test(name) || /^Data\/BasicData\/c?database\.(?:dat|project)$/iu.test(name))
      )
        continue; // 独立成员的结构错误由容器解析报告，原字节仍保存和导出。
      throw new Error(name + ": " + (cause instanceof Error ? cause.message : String(cause)), {
        cause,
      });
    }
  }
}
