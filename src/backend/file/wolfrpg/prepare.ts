import path from "node:path";
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

const WOLF_DATA_MARKER = Buffer.from(
  "Extracting data from encrypted files violates the guidelines.\0",
);

/** 无归档时仍检查核心身份，散装数据无需解包事务。 */
export async function prepare_wolf_source(
  game: WolfSource,
  fs: NativeFs,
  execute?: GamePrepareExecution,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!game.archives.length) {
    await validate_wolf_source(game, fs, new Map(), signal);
    return;
  }
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

/** 先验证全部归档目录与跨归档目标，再暂存和复核核心数据。 */
export async function stage_wolf_source(
  { game, staging }: Readonly<{ game: WolfSource; staging: string }>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  const opened: Array<{ handle: BinaryFileHandle; archive: WolfArchive; prefix: string }> = [];
  const writes: string[] = [],
    directories = new Set<string>(),
    targets = new ProjectAssetPathIndex(),
    staged = new Map<string, string>();
  try {
    for (const source of game.archives) {
      signal?.throwIfAborted();
      assert_regular_path(source.source_path, fs);
      const handle = await fs.open_file(source.source_path, "r");
      let archive: WolfArchive;
      try {
        archive = await read_wolf_archive(handle, signal);
      } catch (cause) {
        await handle.close();
        throw new Error(
          source.source_path + ": " + (cause instanceof Error ? cause.message : String(cause)),
          { cause },
        );
      }
      opened.push({ handle, archive, prefix: source.output_prefix });
      directories.add(source.output_prefix);
      for (const directory of archive.directories)
        directories.add(source.output_prefix + "/" + directory);
      for (const member of archive.members) {
        const name = source.output_prefix + "/" + member.name;
        validate_game_path(name);
        targets.add(name);
        writes.push(name);
        assert_regular_path(path.join(game.root, name), fs);
      }
    }
    assert_game_path_spellings([...writes, ...directories]);
    for (const { archive, prefix } of opened)
      for (const member of archive.members) {
        signal?.throwIfAborted();
        const name = prefix + "/" + member.name,
          target = path.join(staging, name);
        await fs.make_dir_async(path.dirname(target));
        await extract_wolf_member(archive, member, target, fs, signal);
        if (
          /^Data\/BasicData\/(?:Game|CommonEvent|c?DataBase|SysDatabase|TileSetData)\.dat$/iu.test(
            name,
          )
        ) {
          const content = fs.read_file(target);
          // 归档附带的提示不是散装数据头，准备结果应与正常外部数据一致。
          if (content.subarray(0, WOLF_DATA_MARKER.length).equals(WOLF_DATA_MARKER))
            await fs.write_file(target, content.subarray(WOLF_DATA_MARKER.length));
        }
        staged.set(name, target);
      }
    await validate_wolf_source(game, fs, staged, signal);
    return {
      writes,
      directories: [...directories],
      removes: game.archives.map((archive) =>
        path.relative(game.root, archive.source_path).replaceAll("\\", "/"),
      ),
    };
  } finally {
    await Promise.all(opened.map(({ handle }) => handle.close()));
  }
}

/** 核心和已识别协议在提交前完整解析，辅助文件按原稿保留。 */
async function validate_wolf_source(
  game: WolfSource,
  fs: NativeFs,
  staged: ReadonlyMap<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  const files = new Set<string>();
  if (fs.exists(game.data_root)) collect_existing_files(game.root, "Data", files, fs);
  for (const name of staged.keys()) files.add(name);
  const members = new Map(
    [...files]
      .filter((name) => /\.(?:dat|project|mps)$/iu.test(name))
      .map((name) => [
        name,
        {
          async: async (): Promise<Uint8Array> => {
            signal?.throwIfAborted();
            try {
              return fs.read_file(staged.get(name) ?? path.join(game.root, name));
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
