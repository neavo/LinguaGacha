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

// 核心文件决定其他成员的用途，缺失或解析失败时整项拒绝。
const GAME_FILE = "Data/BasicData/Game.dat";
const COMMON_FILE = "Data/BasicData/CommonEvent.dat";
const SYSTEM_DATABASE = "Data/BasicData/SysDatabase";
export type WolfContext = Readonly<{
  read: (file: string, content: Uint8Array) => Promise<WolfDocument | null>;
}>;

/** 核心文件先于成员遍历解析，其余成员错误仍可保留原稿并报告警告。 */
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
  /** 核心文件的错误标明来源文件。 */
  const read_core = async <T>(label: string, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (cause) {
      throw new Error(label + ": " + (cause instanceof Error ? cause.message : String(cause)), {
        cause,
      });
    }
  };
  const game = await read_core(GAME_FILE, async () => read_wolf_game(await bytes(GAME_FILE)));
  const common = await read_core(COMMON_FILE, async () =>
    read_wolf_common(await bytes(COMMON_FILE)),
  );
  // `\cself` 只存在于公共事件，数据库字段用途依赖其中的路径模板，必须先于数据库解析。
  const path_fields = read_wolf_path_fields(common.details.events);
  /** 数据库配对缺少的一侧按同名主干读取，路径字段只作用于对应文件。 */
  const read_database = async (stem: string, project?: Uint8Array, data?: Uint8Array) =>
    read_wolf_database(
      project ?? (await bytes(stem + ".project")),
      data ?? (await bytes(stem + ".dat")),
      path_fields.filter((field) => field.database === stem.toLowerCase()),
    );
  const system = await read_core(`${SYSTEM_DATABASE}.dat / ${SYSTEM_DATABASE}.project`, () =>
    read_database(SYSTEM_DATABASE),
  );
  const core = new Map<string, WolfDocument>([
    [GAME_FILE.toLowerCase(), game],
    [COMMON_FILE.toLowerCase(), common],
    [`${SYSTEM_DATABASE}.dat`.toLowerCase(), system.data],
    [`${SYSTEM_DATABASE}.project`.toLowerCase(), system.project],
  ]);
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
      if (key === "data/basicdata/tilesetdata.dat") return read_wolf_tileset(content);
      if (/^data\/basicdata\/(?:c?database)\.(?:dat|project)$/u.test(key)) {
        const stem = key.slice(0, key.lastIndexOf(".")),
          project = key.endsWith(".project");
        const database = await read_database(
          stem,
          project ? content : undefined,
          project ? undefined : content,
        );
        return project ? database.project : database.data;
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
