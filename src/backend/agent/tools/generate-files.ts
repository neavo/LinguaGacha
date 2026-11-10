import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import type { TranslationFileGenerationService } from "../../file/translation-file-generation-service";
import type {
  TranslationFileGenerationResult,
  TranslationOutputPaths,
} from "../../../shared/translation-generation";
import { AGENT_WORKSPACE_WORK_ROOT } from "../workspace/runtime/policy";

/** 脚本只请求生成，输出位置由宿主拥有。 */
export const WORKSPACE_GENERATE_FILES_REQUEST_SCHEMA = Type.Object(
  { kind: Type.Literal("generate_files"), bilingual_files: Type.Array(Type.String()) },
  { additionalProperties: false },
);
export type WorkspaceGenerateFilesRequest = Static<typeof WORKSPACE_GENERATE_FILES_REQUEST_SCHEMA>;
export type WorkspaceGenerateFilesPort = (
  bilingual_files: readonly string[],
) => Promise<TranslationFileGenerationResult>;

/** 路径由宿主选定，生成服务沿用已持有的工作区执行占用。 */
export function create_file_generator(
  root: string,
  generation: Pick<TranslationFileGenerationService, "generate_staging_files">,
): WorkspaceGenerateFilesPort {
  return (bilingual_files) =>
    generation.generate_staging_files(
      path.resolve(root, AGENT_WORKSPACE_WORK_ROOT, randomUUID()),
      bilingual_files,
    );
}

/** 不接受脚本路径参数，runner 在回收执行前等待本次生成结算。 */
export async function execute_generate_files_request(
  request: unknown,
  signal: AbortSignal,
  generate: WorkspaceGenerateFilesPort | undefined,
): Promise<TranslationFileGenerationResult> {
  if (!Check(WORKSPACE_GENERATE_FILES_REQUEST_SCHEMA, request))
    throw new Error("Invalid generate_files request.");
  if (!generate) throw new Error("File generation unavailable.");
  signal.throwIfAborted();
  return generate(request.bilingual_files);
}

export const WORKSPACE_GET_OUTPUT_PATHS_REQUEST_SCHEMA = Type.Object(
  { kind: Type.Literal("get_output_paths"), directory: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
export type WorkspaceGetOutputPathsRequest = Static<
  typeof WORKSPACE_GET_OUTPUT_PATHS_REQUEST_SCHEMA
>;
export type WorkspaceGetOutputPathsPort = (directory?: string) => TranslationOutputPaths;

/** 脚本参数在宿主边界收窄，目录存在性由生成服务校验。 */
export async function execute_get_output_paths_request(
  request: unknown,
  signal: AbortSignal,
  read_paths: WorkspaceGetOutputPathsPort | undefined,
): Promise<TranslationOutputPaths> {
  if (
    !Check(WORKSPACE_GET_OUTPUT_PATHS_REQUEST_SCHEMA, request) ||
    (request.directory !== undefined && !path.isAbsolute(request.directory))
  )
    throw new Error("Invalid get_output_paths request.");
  if (!read_paths) throw new Error("Output paths unavailable.");
  signal.throwIfAborted();
  return read_paths(request.directory);
}
