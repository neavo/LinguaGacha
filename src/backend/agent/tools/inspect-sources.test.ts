import { expect, it, vi } from "vitest";
import { execute_inspect_sources_request } from "./inspect-sources";
it("来源请求在父进程验证后交给领域端口", async () => {
  const inspect = vi.fn(async (sources: string[]) =>
    sources.map((source_path) => ({
      source_path,
      file_count: 1,
      contains_game: false,
      godot_packs: [],
      failures: [],
    })),
  );
  const signal = new AbortController().signal;
  await expect(
    execute_inspect_sources_request(
      { kind: "inspect_sources", source_paths: [12] },
      signal,
      inspect,
    ),
  ).rejects.toThrow();
  expect(inspect).not.toHaveBeenCalled();
  expect(
    await execute_inspect_sources_request(
      { kind: "inspect_sources", source_paths: ["work/a.txt"] },
      signal,
      inspect,
    ),
  ).toMatchObject([{ source_path: "work/a.txt", file_count: 1 }]);
});
