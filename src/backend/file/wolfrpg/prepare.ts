import path from "node:path";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { NativeFs } from "../../../native/native-fs";
import { AppError, read_error_message } from "../../../shared/error";
import { ProjectAssetPathIndex } from "../../../shared/project/project-asset-paths";
import type { GameDirectoryChanges } from "../shared/game/directory";
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
import { normalize_wolf_descriptions, WolfProtocolError, type WolfDocument } from "./binary";
import { derive_archive_key, type WolfKeyType } from "./archive-crypt";
import { is_wolf_core, restore_wolf_core, restore_wolf_project } from "./protection";
import { create_wolfx_candidates, collect_wolfx_keys } from "./key-collector";
import { match_wolfx, write_wolfx_plaintext } from "./wolfx";
import { read_wolf_map } from "./map";
import { read_wolf_common } from "./common-events";
import { read_wolf_database } from "./database";

/** 引擎优先读取归档和 `.wolfx`，只有明文通过最终复核后才从发布目录移除密文。 */
export async function stage_wolf_source(
  { game, staging }: Readonly<{ game: WolfSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GameDirectoryChanges> {
  const files = new Map<string, string>(),
    original = new Set<string>(),
    directories = new Set<string>(),
    archive_targets = new ProjectAssetPathIndex(), // 跨归档的同名成员在展开前报冲突。
    staged = new Set<string>(),
    strict = new Set<string>(); // 只有本次转换过的成员必须通过严格复核。
  if (fs.exists(game.data_root)) collect_existing_files(game.root, "Data", original, fs, signal);
  for (const entry of fs.read_dirents(game.root)) {
    if (!/\.(?:ttf|ttc|otf)(?:\.wolfx)?$/iu.test(entry.name)) continue;
    const source = path.join(game.root, entry.name);
    assert_regular_path(source, fs);
    assert(entry.isFile(), "Invalid WOLF font: " + entry.name);
    original.add(entry.name);
  }
  for (const name of original) files.set(name, path.join(game.root, name));
  /** 写入转换结果并登记严格复核，归档原样展开不经过此入口。 */
  const write = async (name: string, bytes: Buffer) => {
    const target = path.join(staging, name);
    await fs.make_dir_async(path.dirname(target));
    await fs.write_file(target, bytes);
    files.set(name, target);
    staged.add(name);
    strict.add(name);
  };
  const keys = new Map<WolfKeyType, Buffer>();
  /** 同类型的配套密钥按原字节去重，多个归档共用一次派生结果。 */
  const companion = async (mode: WolfKeyType): Promise<Buffer> => {
    const cached = keys.get(mode);
    if (cached) return cached;
    const candidates: Buffer[] = [];
    for (const entry of game.key_files.filter((entry) => entry.type === mode)) {
      await checkpoint(signal);
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
      await checkpoint(signal);
      assert_regular_path(source.source_path, fs);
      const handle = await fs.open_file(source.source_path, "r");
      let archive: WolfArchive;
      try {
        archive = await read_wolf_archive(handle, signal, companion);
      } catch (cause) {
        await handle.close();
        throw failure(
          path.relative(game.root, source.source_path).replaceAll("\\", "/"),
          "archive",
          cause,
        );
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
        await checkpoint(signal);
        const name = prefix + "/" + member.name,
          target = path.join(staging, name);
        await fs.make_dir_async(path.dirname(target));
        await extract_wolf_member(archive, member, target, fs, signal);
        files.set(name, target);
        staged.add(name);
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
  for (const name of encrypted.keys())
    assert(!/\.(?:dat|project)\.wolfx$/iu.test(name), name + ": WolfX: unsupported core layout");
  await restore_core_files(files, fs, write, signal);
  await normalize_descriptions(files, fs, write, strict, signal);
  const pending = new Set(encrypted.keys()),
    parsed = new Set<string>(),
    candidates = create_wolfx_candidates();
  /** 密文覆盖的旧明文只有在解密成功后才能提供候选。 */
  const available = (name: string) => {
    const cipher = encrypted_targets.get(name);
    return cipher === undefined || !pending.has(cipher);
  };
  if (encrypted.size) {
    const common = [...files].find(([name]) => /^Data\/BasicData\/CommonEvent\.dat$/iu.test(name));
    if (common) {
      try {
        for (const event of read_wolf_common(fs.read_file(common[1])).details.events)
          collect_wolfx_keys(event.commands, candidates);
      } catch (cause) {
        throw failure(common[0], "key collection", cause);
      }
    }
  }
  const default_candidates = create_wolfx_candidates();
  /** 引擎仅用默认键加载字体。 */
  const keys_for = (name: string) =>
    /\.(?:ttf|ttc|otf)\.wolfx$/iu.test(name) ? default_candidates : candidates;
  // 只有新解出的地图能继续增加候选，核心与配对不参与重试。
  for (;;) {
    let progress = false;
    // 密钥来源独立解析，不要求完整数据库集合。被 WolfX 遮蔽的旧明文不能提供候选。
    if (encrypted.size)
      for (const [name, source] of files) {
        if (!available(name) || parsed.has(name) || !/\.mps$/iu.test(name)) continue;
        await checkpoint(signal);
        const content = fs.read_file(source);
        try {
          for (const event of read_wolf_map(content).details.events)
            for (const page of event.pages) collect_wolfx_keys(page.commands, candidates);
        } catch (cause) {
          if (strict.has(name) || cause instanceof WolfProtocolError)
            throw failure(name, "key collection", cause);
          // 未改的坏地图不提供任何候选，保留原稿供导入报告警告。
        }
        parsed.add(name);
      }
    const missing: string[] = [];
    for (const name of pending) {
      await checkpoint(signal);
      const handle = await fs.open_file(encrypted.get(name)!, "r");
      try {
        const result = await match_wolfx(handle, keys_for(name), signal);
        if (!result.match) {
          missing.push(
            name +
              ": WolfX: insufficient local key material: " +
              (result.missing.join(", ") || "no matching static candidate"),
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
        staged.add(target_name);
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
      break;
    }
  }
  // 新解出的事件可能增加候选，全部已解密文必须参与最终歧义判断。
  for (const [name, source] of encrypted) {
    await checkpoint(signal);
    const handle = await fs.open_file(source, "r");
    try {
      assert((await match_wolfx(handle, keys_for(name), signal)).match, "WOLFX candidate lost");
    } catch (cause) {
      throw failure(name, "final candidate validation", cause);
    } finally {
      await handle.close();
    }
  }
  await validate_wolf_source(fs, files, strict, signal);
  return {
    writes: [...staged],
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
  let context: Awaited<ReturnType<typeof create_wolf_context>>;
  try {
    context = await create_wolf_context(members);
  } catch (cause) {
    throw new Error("final structure validation: " + read_error_message(cause), { cause });
  }
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
      throw failure(name, "final structure validation", cause);
    }
  }
}

/** 让出事件循环，使取消信号能在成员处理之间生效。 */
async function checkpoint(signal?: AbortSignal): Promise<void> {
  await setImmediate();
  signal?.throwIfAborted();
}

/** 保留原始异常，同时标明相对路径与失败阶段。 */
function failure(name: string, stage: string, cause: unknown): Error {
  return new Error(name + ": " + stage + ": " + read_error_message(cause), { cause });
}

/** 核心与配对描述在同一阶段还原，显式种子不会泄漏到其它数据库。 */
async function restore_core_files(
  files: ReadonlyMap<string, string>,
  fs: NativeFs,
  write: (name: string, bytes: Buffer) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const names = new Map([...files.keys()].map((name) => [name.toLowerCase(), name]));
  for (const [name, source] of files) {
    if (!is_wolf_core(name)) continue;
    await checkpoint(signal);
    let result: Awaited<ReturnType<typeof restore_wolf_core>>;
    try {
      result = await restore_wolf_core(name, fs.read_file(source), signal);
    } catch (cause) {
      throw failure(name, "core protection", cause);
    }
    if (!result) continue;
    await write(name, result.bytes);
    if (result.project_seed === null) continue;
    const requested = name.slice(0, -4) + ".project",
      project = names.get(requested.toLowerCase());
    try {
      assert(project, "Missing WOLF protected project: " + requested);
      await write(
        project,
        await restore_wolf_project(fs.read_file(files.get(project)!), result.project_seed, signal),
      );
    } catch (cause) {
      throw failure(requested, "project protection", cause);
    }
  }
}

/** 完整解析成功后才清理允许处理的说明区间，写入失败直接终止准备。 */
async function normalize_descriptions(
  files: ReadonlyMap<string, string>,
  fs: NativeFs,
  write: (name: string, bytes: Buffer) => Promise<void>,
  strict: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<void> {
  const names = new Map([...files.keys()].map((name) => [name.toLowerCase(), name]));
  /** 无实际字节变化时保留当前文件及其压缩封装。 */
  const normalize = async (name: string, document: WolfDocument) => {
    const bytes = normalize_wolf_descriptions(document);
    if (bytes === document.original) return;
    await write(name, Buffer.from(bytes));
  };
  // 未改的独立数据库由最终校验决定失败或警告。
  for (const [name, source] of files) {
    if (/^Data\/BasicData\/CommonEvent\.dat$/iu.test(name)) {
      await checkpoint(signal);
      try {
        await normalize(name, read_wolf_common(fs.read_file(source)));
      } catch (cause) {
        throw failure(name, "description normalization", cause);
      }
    } else if (/^Data\/BasicData\/(?:c?database|sysdatabase)\.dat$/iu.test(name)) {
      await checkpoint(signal);
      const project = names.get(name.slice(0, -4).toLowerCase() + ".project");
      if (!project) continue; // 最终配对校验报告缺失。受保护配对已在还原阶段拒绝。
      const data = fs.read_file(source),
        content = fs.read_file(files.get(project)!);
      let document: WolfDocument;
      try {
        document = read_wolf_database(content, data).project;
      } catch (cause) {
        if (
          strict.has(name) ||
          strict.has(project) ||
          /sysdatabase/iu.test(name) ||
          cause instanceof WolfProtocolError
        )
          throw failure(project, "description normalization", cause);
        continue; // 独立未改成员保留原字节，后续导入报告解析警告。
      }
      await normalize(project, document);
    }
  }
}
