import type { GameFiles } from "../shared/game/format";
import { readable_json, write_projection, type ReadableFile } from "../shared/game/readable";
import { create_wolf_context } from "./wolf-format";

/** 可读视图使用相同结构解析器，失败成员写出诊断。 */
export async function* read_wolf_projections(files: GameFiles): AsyncGenerator<ReadableFile> {
  const context = await create_wolf_context(files);
  for (const [file, member] of files) {
    const content = await member.async("uint8array");
    yield* write_projection(file, async () => {
      const doc = await context.read(file, content);
      if (!doc) return [];
      return [
        [
          file + ".reference.json",
          readable_json({
            internal_file_path: file,
            data: doc.details,
            strings: doc.slots.map(({ text, location, usage, context }) => ({
              text,
              location,
              usage,
              context,
            })),
          }),
        ],
      ];
    });
  }
}
