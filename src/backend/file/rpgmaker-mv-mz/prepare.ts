import { restore_evb_launcher } from "../shared/evb/pe";
import path from "node:path";
import type { NativeFs } from "../../../native/native-fs";
import { is_json_record } from "../../../domain/json";
import { prepare_game_directory, type GamePreparation } from "../shared/rpgmaker-prepare";
import {
  assert_regular_path,
  collect_existing_files,
  validate_game_path,
} from "../source-file-paths";
import { read_evb, extract_evb_member } from "../shared/evb/archive";
import type { RPGMakerMvMzPrepareExecution, RPGMakerMvMzPrepareTask } from "./prepare-worker";
import { read_evb_game, type RPGMakerSource } from "./source";
import { RPGMakerJsonCodec } from "./json-codec";
import { decrypt_media, MEDIA_EXTENSIONS } from "./media";

/** 正式导入复核身份，转换全部完成后才允许修改游戏目录。 */
export async function prepare_rpgmaker_source(
  game: RPGMakerSource,
  fs: NativeFs,
  execute?: RPGMakerMvMzPrepareExecution,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!game.executable) {
    const system: unknown = JSON.parse(
      new TextDecoder().decode(fs.read_file(path.join(game.data_root, "data/System.json"))),
    );
    if (!is_json_record(system)) throw new Error("Invalid MV/MZ System.json");
    if (!system["hasEncryptedImages"] && !system["hasEncryptedAudio"]) return game.root;
  }
  await prepare_game_directory(
    game.root,
    fs,
    (staging) => {
      const task: RPGMakerMvMzPrepareTask = { game, staging };
      return execute ? execute(task, signal) : stage_rpgmaker_source(task, fs, signal);
    },
    signal,
  );
  return game.root;
}

/** worker 只拥有暂存目录，来源目录中的文件始终只读。 */
export async function stage_rpgmaker_source(
  { game, staging }: RPGMakerMvMzPrepareTask,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<GamePreparation> {
  signal?.throwIfAborted();
  const { root, data_root, executable } = game;
  const writes = new Set<string>();
  assert_regular_path(root, fs);
  if (executable) {
    assert_regular_path(executable, fs);
    const handle = await fs.open_file(executable, "r");
    try {
      const archive = await read_evb(handle, signal);
      if (!archive) throw new Error("EVB source changed before preparation");
      const current = read_evb_game(root, executable, archive.members);
      if (!current || current.engine !== game.engine || current.data_root !== data_root)
        throw new Error("EVB game identity changed before preparation");
      for (const member of archive.members) {
        signal?.throwIfAborted();
        await extract_evb_member(handle, member, path.join(staging, member.name), fs, signal);
        writes.add(member.name);
      }
      const launcher = path.basename(executable);
      validate_game_path(launcher);
      const collision = [...writes].find((name) => name.toLowerCase() === launcher.toLowerCase());
      // 所选入口固定恢复为外部加载器，包内同目标成员在暂存中明确被替代。
      if (collision) {
        fs.unlink(path.join(staging, collision));
        writes.delete(collision);
      }
      await restore_evb_launcher(handle, archive, path.join(staging, launcher), fs, signal);
      writes.add(launcher);
    } finally {
      await handle.close();
    }
  }
  await stage_media(game, staging, writes, fs, signal);
  const prefix = path.relative(root, data_root).replaceAll("\\", "/");
  const resolve = (name: string) => path.join(writes.has(name) ? staging : root, name);
  const internal = (name: string) => [prefix, name].filter(Boolean).join("/");
  if (
    !fs.exists(resolve(internal("data/System.json"))) ||
    !(
      fs.exists(resolve(internal("js/rpg_core.js"))) ||
      fs.exists(resolve(internal("js/rmmz_core.js")))
    )
  )
    throw new Error("Prepared game is missing MV/MZ engine files");
  return { writes: [...writes] };
}

/** 包内资源覆盖散装资源，原生媒体按整类成功结果关闭配置。 */
async function stage_media(
  game: RPGMakerSource,
  staging: string,
  writes: Set<string>,
  fs: NativeFs,
  signal?: AbortSignal,
): Promise<void> {
  const { root, data_root } = game;
  const prefix = path.relative(root, data_root).replaceAll("\\", "/");
  const system_name = [prefix, "data/System.json"].filter(Boolean).join("/");
  const system_path = path.join(writes.has(system_name) ? staging : root, system_name);
  assert_regular_path(system_path, fs);
  const codec = new RPGMakerJsonCodec();
  const system = codec.parse(new TextDecoder().decode(fs.read_file(system_path)));
  if (!is_json_record(system)) throw new Error("Invalid MV/MZ System.json");
  const images = system["hasEncryptedImages"] === true,
    audio = system["hasEncryptedAudio"] === true;
  if (!images && !audio) return;
  const key = system["encryptionKey"];
  if (typeof key !== "string" || !/^[a-f0-9]{32}$/iu.test(key))
    throw new Error("Invalid RPG Maker encryption key");
  const files = new Set<string>(writes);
  for (const directory of [images ? "img" : null, audio ? "audio" : null]) {
    if (directory)
      collect_existing_files(root, [prefix, directory].filter(Boolean).join("/"), files, fs);
  }
  const outputs = new Set<string>();
  for (const name of files) {
    signal?.throwIfAborted();
    const extension = path.extname(name).toLowerCase(),
      target_extension = MEDIA_EXTENSIONS[extension];
    if (!target_extension || !(target_extension === ".png" ? images : audio)) continue;
    const directory = [prefix, target_extension === ".png" ? "img/" : "audio/"]
      .filter(Boolean)
      .join("/");
    if (!name.startsWith(directory)) continue;
    const output = name.slice(0, -extension.length) + target_extension;
    validate_game_path(output);
    if (outputs.has(output.toLowerCase()))
      throw new Error("Multiple encrypted media sources: " + output);
    outputs.add(output.toLowerCase());
    if (writes.has(output)) fs.unlink(path.join(staging, output));
    await decrypt_media(
      path.join(writes.has(name) ? staging : root, name),
      path.join(staging, output),
      key,
      fs,
      signal,
    );
    writes.add(output);
  }
  if (images) system["hasEncryptedImages"] = false;
  if (audio) system["hasEncryptedAudio"] = false;
  await fs.write_file(path.join(staging, system_name), codec.stringify(system));
  writes.add(system_name);
}
