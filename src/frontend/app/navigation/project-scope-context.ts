import { createContext, useContext } from "react";
import type { RouteId } from "./types";

export type ProjectTabScope = Readonly<{ projectId: string; tabId: RouteId; active: boolean }>;
export const ProjectScopeContext = createContext<ProjectTabScope | null>(null);
export function useProjectTabActive(): boolean {
  return useContext(ProjectScopeContext)?.active ?? true;
}
