export const KNOWLEDGE_LOCAL_SOURCE_PATHS_DOCUMENT = "local-source-paths.md";

export type KnowledgeDocument = Readonly<{ path: string; text: string }>;
export type KnowledgeEntry = Readonly<{ path: string; description?: string; fp: string }>;
export type KnowledgeFile = KnowledgeDocument & Readonly<{ fp: string }>;
export type KnowledgeIntent =
  | Readonly<{ op: "create"; line: number; path: string; text: string }>
  | Readonly<{ op: "update"; line: number; path: string; fp: string; text: string }>
  | Readonly<{ op: "delete"; line: number; path: string; fp: string }>;
