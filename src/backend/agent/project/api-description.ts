import { SOURCE_INSPECTION_SCHEMA } from "../../../shared/project-file-changes";
import {
  TRANSLATION_FILE_GENERATION_RESULT_SCHEMA,
  TRANSLATION_OUTPUT_PATHS_SCHEMA,
} from "../../../shared/translation-generation";
import { create_schema_renderer } from "../workspace/schema-description";
import type { TSchema } from "typebox";

/** `@lg/project` 的运行时结果 Schema 与模型声明共用同一结构。 */
export function format_project_typescript_api(): string {
  const types = create_schema_renderer(
    new Map<TSchema, string>([
      [SOURCE_INSPECTION_SCHEMA, "ProjectSourceInspection"],
      [TRANSLATION_FILE_GENERATION_RESULT_SCHEMA, "ProjectTranslationFileGenerationResult"],
      [TRANSLATION_OUTPUT_PATHS_SCHEMA, "ProjectTranslationOutputPaths"],
    ]),
  ).declarations();
  return [
    types,
    "declare module '@lg/project' {",
    "  type SourceInspection = ProjectSourceInspection;",
    "  type TranslationFileGenerationResult = ProjectTranslationFileGenerationResult;",
    "  type TranslationOutputPaths = ProjectTranslationOutputPaths;",
    "  function inspectSources(source_paths: string[]): Promise<SourceInspection[]>;",
    "  function getOutputPaths(directory?: string): Promise<TranslationOutputPaths>;",
    "  function generateFiles(bilingual_files: string[]): Promise<TranslationFileGenerationResult>;",
    "  /** `items` 传入按文件连续且文件内自然排列的工程条目数组或异步流，返回目标条目及同文件前后各 2 条非空原文（去重并保持首次出现顺序）。 */",
    "  function queryItemContexts<Item extends { item_id: number; file_path: string; src: string }>(items: AsyncIterable<Item> | Iterable<Item>, item_ids: readonly number[]): Promise<{ contexts: Array<{ target_item_id: number; item_ids: number[] }>; items: Item[]; missing_item_ids: number[] }>;",
    "}",
  ].join("\n");
}
