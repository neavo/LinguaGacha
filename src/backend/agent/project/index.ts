import type {
  TranslationFileGenerationResult,
  TranslationOutputPaths,
} from "../../../shared/translation-generation";
import { workspace_requests } from "../workspace/runtime/request-channel";
import type { SourceInspection } from "../../../shared/project-file-changes";
export type { SourceInspection } from "../../../shared/project-file-changes";

/** 通过宿主识别来源，返回与输入顺序一致的识别结果。 */
export async function inspectSources(source_paths: string[]): Promise<SourceInspection[]> {
  const result = await workspace_requests().call({ kind: "inspect_sources", source_paths });
  if (!Array.isArray(result)) throw new Error("Invalid inspect_sources response.");
  return result;
}

/**
 * 生成单语成果及通用写回输入。
 * `bilingual_files` 使用 `project_meta.json` 中的资产 `file_path`。空数组表示仅单语。
 * 双语范围按 `project-operation` 确认。通用包、视频和 PDF 的双语成果由 Agent 按格式能力制作。
 * 返回的双语目录可能尚不存在。
 */
export async function generateFiles(
  bilingual_files: string[],
): Promise<TranslationFileGenerationResult> {
  const result = await workspace_requests().call({ kind: "generate_files", bilingual_files });
  if (typeof result !== "object" || result === null || !("accepted" in result))
    throw new Error("Invalid generate_files response.");
  return result;
}

/** 通过宿主查询交付位置，工作区不解释应用保存设置。 */
export async function getOutputPaths(directory?: string): Promise<TranslationOutputPaths> {
  const result = await workspace_requests().call({
    kind: "get_output_paths",
    ...(directory === undefined ? {} : { directory }),
  });
  if (typeof result !== "object" || result === null || !("manual" in result))
    throw new Error("Invalid get_output_paths response.");
  return result;
}
