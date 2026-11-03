import { workspace_requests } from "../workspace/runtime/request-channel";
import type { SourceInspection } from "../../../shared/project-file-changes";
export type { SourceInspection } from "../../../shared/project-file-changes";

/** 通过宿主识别来源，返回与输入顺序一致的识别结果。 */
export async function inspectSources(source_paths: string[]): Promise<SourceInspection[]> {
  const result = await workspace_requests().call({ kind: "inspect_sources", source_paths });
  if (!Array.isArray(result)) throw new Error("Invalid inspect_sources response.");
  return result;
}
