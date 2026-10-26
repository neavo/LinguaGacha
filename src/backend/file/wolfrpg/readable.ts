import type { GameFiles } from "../shared/game/format";
import {
  readable_json,
  write_projection,
  type ProjectionFailure,
  type ReadableFile,
} from "../shared/game/readable";
import { create_wolf_context } from "./wolf-format";

/** 可读视图使用相同结构解析器。缺少用途上下文时报告问题，并退回只含结构的参考。 */
export async function* read_wolf_projections(
  files: GameFiles,
  report?: ProjectionFailure,
  signal?: AbortSignal,
): AsyncGenerator<ReadableFile> {
  const context = await create_wolf_context(files);
  for (const [file, member] of files) {
    signal?.throwIfAborted();
    yield* write_projection(
      file,
      async () => {
        const content = await member.async("uint8array");
        signal?.throwIfAborted();
        let doc;
        try {
          doc = await context.read(file, content);
        } catch (error) {
          signal?.throwIfAborted();
          report?.(file, error);
          doc = await context.read_structure(file, content);
        }
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
      },
      report,
      signal,
    );
  }
}
