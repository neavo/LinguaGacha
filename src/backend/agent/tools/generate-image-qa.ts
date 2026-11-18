import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import type { ImageQualityResult } from "../../../shared/image";
import type { TranslationFileGenerationService } from "../../file/translation-file-generation-service";
import { AGENT_WORKSPACE_WORK_ROOT } from "../workspace/runtime/policy";

export const WORKSPACE_GENERATE_IMAGE_QA_REQUEST_SCHEMA = Type.Object(
  { kind: Type.Literal("generate_image_qa") },
  { additionalProperties: false },
);
export type WorkspaceGenerateImageQARequest = Static<
  typeof WORKSPACE_GENERATE_IMAGE_QA_REQUEST_SCHEMA
>;
export type WorkspaceGenerateImageQAPort = () => Promise<ImageQualityResult>;

/** 宿主为每次 QA 分配独立工作目录，图片域拥有输出语义。 */
export function create_image_qa_generator(
  root: string,
  generation: Pick<TranslationFileGenerationService, "generate_image_qa">,
): WorkspaceGenerateImageQAPort {
  return () =>
    generation.generate_image_qa(path.resolve(root, AGENT_WORKSPACE_WORK_ROOT, randomUUID()));
}

export async function execute_generate_image_qa_request(
  request: unknown,
  signal: AbortSignal,
  generate: WorkspaceGenerateImageQAPort | undefined,
): Promise<ImageQualityResult> {
  if (!Check(WORKSPACE_GENERATE_IMAGE_QA_REQUEST_SCHEMA, request))
    throw new Error("Invalid generate_image_qa request.");
  if (!generate) throw new Error("Image QA unavailable.");
  signal.throwIfAborted();
  return generate();
}
