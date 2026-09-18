import { createContext, useContext } from "react";
import type { ProjectTranslationStats } from "@shared/project-translation-stats";

export const ProjectTranslationStatsContext = createContext<
  ProjectTranslationStats | null | undefined
>(undefined);

/** 消费会话统计；null 表示当前工程尚无有效结果。 */
export function useProjectTranslationStats(): ProjectTranslationStats | null {
  const stats = useContext(ProjectTranslationStatsContext);
  if (stats === undefined)
    throw new Error("useProjectTranslationStats requires ProjectTranslationStatsProvider.");
  return stats;
}
