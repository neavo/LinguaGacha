import { Type, type Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import type { SourceInspection } from "../../../shared/project-file-changes";

/** 父进程在识别本机来源前校验脚本请求。 */
export const WORKSPACE_INSPECT_SOURCES_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("inspect_sources"),
    source_paths: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export type WorkspaceInspectSourcesRequest = Static<
  typeof WORKSPACE_INSPECT_SOURCES_REQUEST_SCHEMA
>;
export type WorkspaceInspectSourcesPort = (
  source_paths: string[],
  signal: AbortSignal,
) => Promise<SourceInspection[]>;

/** 校验与取消检查通过后才交给来源识别端口。 */
export async function execute_inspect_sources_request(
  request: unknown,
  signal: AbortSignal,
  inspect: WorkspaceInspectSourcesPort | undefined,
): Promise<SourceInspection[]> {
  if (!Check(WORKSPACE_INSPECT_SOURCES_REQUEST_SCHEMA, request))
    throw new Error("Invalid inspect_sources request.");
  if (!inspect) throw new Error("Source inspection unavailable.");
  signal.throwIfAborted();
  return inspect(request.source_paths, signal);
}
