import assert from "node:assert/strict";
import type { GameFiles, GameFormatAdapter } from "../shared/game/format";
import type { WolfDocument } from "./binary";
import { read_wolf_common, read_wolf_path_fields } from "./common-events";
import { read_wolf_database, read_wolf_map_registry } from "./database";
import { read_wolf_game } from "./game-data";
import { read_wolf_map } from "./map";
import { read_wolf_tileset } from "./tileset";
import { read_wolf_metadata, extract_wolf_items } from "./item";
import { write_wolf_items } from "./writer";

// 核心文件只约束依赖它的用途判定。
const GAME_FILE = "Data/BasicData/Game.dat";
const COMMON_FILE = "Data/BasicData/CommonEvent.dat";
const SYSTEM_DATABASE = "Data/BasicData/SysDatabase";
export type WolfContext = Readonly<{
  read_structure: (file: string, content: Uint8Array) => Promise<WolfDocument | null>;
  read: (file: string, content: Uint8Array) => Promise<WolfDocument | null>;
}>;

/** 按成员的真实依赖读取上下文，结构参考独立于游戏用途。 */
export async function create_wolf_context(
  files: ReadonlyMap<string, { async(type: "uint8array"): Promise<Uint8Array> }>,
): Promise<WolfContext> {
  const names = new Map([...files.keys()].map((file) => [file.toLowerCase(), file]));
  /** 配套文件按容器中的实际拼写读取，缺失时报告请求路径。 */
  const bytes = async (name: string): Promise<Uint8Array> => {
    const actual = names.get(name.toLowerCase());
    assert(actual, "Missing WOLF companion: " + name);
    return files.get(actual)!.async("uint8array");
  };
  let common: Promise<ReturnType<typeof read_wolf_common>> | undefined;
  const read_common = () => (common ??= bytes(COMMON_FILE).then(read_wolf_common));
  const read_database = async (
    stem: string,
    project?: Uint8Array,
    data?: Uint8Array,
    structure = false,
  ) =>
    read_wolf_database(
      project ?? (await bytes(stem + ".project")),
      data ?? (await bytes(stem + ".dat")),
      structure
        ? []
        : read_wolf_path_fields((await read_common()).details.events).filter(
            (field) => field.database === stem.toLowerCase(),
          ),
    );
  let registry: Promise<ReturnType<typeof read_wolf_map_registry>> | undefined;
  const read_registry = () =>
    (registry ??= read_database(SYSTEM_DATABASE).then(read_wolf_map_registry));
  const read = async (
    file: string,
    content: Uint8Array,
    structure: boolean,
  ): Promise<WolfDocument | null> => {
    const key = file.toLowerCase();
    if (key === GAME_FILE.toLowerCase()) return read_wolf_game(content);
    if (key === COMMON_FILE.toLowerCase()) return read_wolf_common(content);
    if (key.endsWith(".mps")) {
      const document = read_wolf_map(content);
      // 结构参考不授予翻译资格。缺失登记表时，条目提取由成员失败边界保留原稿。
      if (structure || !(await read_registry()).has(key))
        document.slots = document.slots.map((slot) => ({ ...slot, usage: "metadata" }));
      return document;
    }
    if (key === "data/basicdata/tilesetdata.dat") return read_wolf_tileset(content);
    if (/^data\/basicdata\/(?:c?database|sysdatabase)\.(?:dat|project)$/u.test(key)) {
      const project = key.endsWith(".project");
      const database = await read_database(
        key.slice(0, key.lastIndexOf(".")),
        project ? content : undefined,
        project ? undefined : content,
        structure,
      );
      return project ? database.project : database.data;
    }
    return null;
  };
  return {
    read: (file, content) => read(file, content, false),
    read_structure: (file, content) => read(file, content, true),
  };
}

/** 原生游戏适配器共用原稿容器、状态和导出生命周期。 */
export function create_wolf_adapter(): GameFormatAdapter {
  return {
    file_type: "WOLFRPG",
    internal_path: (item) => read_wolf_metadata(item.extra_field).internal_file_path,
    create_members: async (files: GameFiles) => {
      const context = await create_wolf_context(files);
      return {
        /** 成员条目直接使用上下文给出的最终用途。 */
        read_file: async (content, file) => {
          const document = await context.read(file, content);
          return {
            items: document ? extract_wolf_items(document, file) : [],
            warnings: [],
          };
        },
        /** 完成译文按固化原稿定位，解析失败交给生成服务报告。 */
        render: async (content, file, items) => {
          if (!items.some((item) => item.status === "PROCESSED")) return content;
          const document = await context.read(file, content);
          assert(document, "No WOLF editable structure: " + file);
          return write_wolf_items(document, file, items);
        },
      };
    },
  };
}
