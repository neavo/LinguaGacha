/** 每个工程只有一篇知识文档，数据库键、工作区投影和页面标题共用这个名称。 */
export const PROJECT_KNOWLEDGE_DOCUMENT = "project-knowledge.md";

export type KnowledgeFile = Readonly<{ text: string; fp: string }>;
