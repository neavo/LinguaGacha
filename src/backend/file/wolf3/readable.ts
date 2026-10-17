import type { GameFiles } from "../game/format";
import { create_wolf_context } from "./wolf-format";

/** JSON 只读投影使用相同结构解析器，失败成员保留原字节及诊断。 */
export async function* read_wolf_sources(
  files: GameFiles,
): AsyncGenerator<readonly [string, Uint8Array]> {
  const context = await create_wolf_context(files);
  for (const [file, member] of files) {
    const content = await member.async("uint8array");
    yield [file, content];
    let projection: unknown;
    try {
      const doc = await context.read(file, content);
      if (!doc) continue;
      projection = {
        internal_file_path: file,
        data: doc.details,
        strings: doc.slots.map(({ text, location, usage, context }) => ({
          text,
          location,
          usage,
          context,
        })),
      };
    } catch (error) {
      projection = {
        internal_file_path: file,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    yield [file + ".json", Buffer.from(JSON.stringify(projection, null, 2))];
  }
}
