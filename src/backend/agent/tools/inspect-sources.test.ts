import { expect, it, vi } from "vitest";
import {
  execute_inspect_sources_request,
  type WorkspaceInspectSourcesPort,
} from "./inspect-sources";
it("来源请求在父进程验证后交给领域端口", async () => {
  const inspections = [
    {
      source_path: "work/a.txt",
      files: [{ path: "work/a.txt", kind: "file" as const }],
      godot_packs: [],
      failures: [],
    },
  ];
  const inspect = vi.fn<WorkspaceInspectSourcesPort>(async () => inspections);
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
  ).toEqual(inspections);
  expect(inspect).toHaveBeenCalledExactlyOnceWith(["work/a.txt"], signal);
});
