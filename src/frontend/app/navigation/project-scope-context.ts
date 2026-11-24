import { createContext } from "react";

export type ProjectScope = Readonly<{ projectId: string }>;
export const ProjectScopeContext = createContext<ProjectScope | null>(null);
