import assert from "node:assert/strict";
import path from "node:path";
import type { GameFiles, GameFormatAdapter } from "../shared/game/format";
import type { WolfDocument } from "./binary";
import { read_wolf_common } from "./common-events";
import { read_wolf_database, read_wolf_map_registry, type WolfDatabase } from "./database";
import { read_wolf_game } from "./game-data";
import { read_wolf_map } from "./map";
import { read_wolf_tileset } from "./tileset";
import { read_wolf_metadata, extract_wolf_items } from "./item";
import { write_wolf_items } from "./writer";

export const WOLF_CORE_FILES = [
  "Data/BasicData/Game.dat",
  "Data/BasicData/SysDatabase.dat",
  "Data/BasicData/SysDatabase.project",
] as const;
export type WolfContext = Readonly<{
  read: (file: string, content: Uint8Array) => Promise<WolfDocument | null>;
}>;

/** 核心身份先于成员遍历建立，成员错误仍可保留原稿并报告警告。 */
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
  const core = new Map<string, WolfDocument>();
  let game: WolfDocument;
  try {
    game = read_wolf_game(await bytes(WOLF_CORE_FILES[0]));
  } catch (cause) {
    throw new Error(
      WOLF_CORE_FILES[0] + ": " + (cause instanceof Error ? cause.message : String(cause)),
      { cause },
    );
  }
  core.set(WOLF_CORE_FILES[0].toLowerCase(), game);
  const [project, data] = await Promise.all([bytes(WOLF_CORE_FILES[2]), bytes(WOLF_CORE_FILES[1])]);
  let system: WolfDatabase;
  try {
    system = read_wolf_database(project, data);
  } catch (cause) {
    throw new Error(
      WOLF_CORE_FILES[1] +
        " / " +
        WOLF_CORE_FILES[2] +
        ": " +
        (cause instanceof Error ? cause.message : String(cause)),
      { cause },
    );
  }
  core.set(WOLF_CORE_FILES[1].toLowerCase(), system.data);
  core.set(WOLF_CORE_FILES[2].toLowerCase(), system.project);
  const registered_maps = read_wolf_map_registry(system);
  return {
    /** 每次读取在结构用途上叠加游戏登记资格。 */
    read: async (file, content) => {
      const key = file.toLowerCase(),
        cached = core.get(key);
      if (cached) return cached;
      if (key.endsWith(".mps")) {
        const document = read_wolf_map(content);
        // 登记资格属于游戏上下文，条目与可读投影共同消费最终用途。
        if (!registered_maps.has(key))
          document.slots = document.slots.map((slot) => ({ ...slot, usage: "metadata" }));
        return document;
      }
      if (key === "data/basicdata/commonevent.dat") return read_wolf_common(content);
      if (key === "data/basicdata/tilesetdata.dat") return read_wolf_tileset(content);
      if (/^data\/basicdata\/(?:c?database)\.(?:dat|project)$/u.test(key)) {
        const stem = key.slice(0, key.lastIndexOf("."));
        const database = read_wolf_database(
          path.extname(key) === ".project" ? content : await bytes(stem + ".project"),
          path.extname(key) === ".dat" ? content : await bytes(stem + ".dat"),
        );
        return key.endsWith(".dat") ? database.data : database.project;
      }
      return null; // 未解释的辅助数据仍属于容器清单，按原字节导出。
    },
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
