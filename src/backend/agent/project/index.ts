import type {
  TranslationFileGenerationResult,
  TranslationOutputPaths,
} from "../../../shared/translation-generation";
import { workspace_requests } from "../workspace/runtime/request-channel";
import type { SourceInspection } from "../../../shared/project-file-changes";
export type { SourceInspection } from "../../../shared/project-file-changes";
export { queryItemContexts } from "./item-contexts";

/** 通过宿主识别来源，返回与输入顺序一致的识别结果。 */
export async function inspectSources(source_paths: string[]): Promise<SourceInspection[]> {
  return workspace_requests().call({ kind: "inspect_sources", source_paths });
}

/**
 * 生成单语成果、宿主原生双语对照及通用写回输入。
 * 宿主自动为 `TXT`、`EPUB` 和字幕资产生成双语对照；格式技能的双语成果由对应技能在写回阶段制作。
 * 返回的双语目录在未生成宿主双语时不存在。
 */
export async function generateFiles(): Promise<TranslationFileGenerationResult> {
  return workspace_requests().call({ kind: "generate_files" });
}

/** 通过宿主查询交付位置，工作区不解释应用保存设置。 */
export async function getOutputPaths(directory?: string): Promise<TranslationOutputPaths> {
  return workspace_requests().call({
    kind: "get_output_paths",
    ...(directory === undefined ? {} : { directory }),
  });
}
