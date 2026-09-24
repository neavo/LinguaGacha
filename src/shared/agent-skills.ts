import type { AgentSkillDisplayDescriptions } from "./agent";

export const AGENT_SKILL_MAIN_FILE = "SKILL.md";
export const AGENT_SKILL_UI_FILE = "ui.json";
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

export type AgentSkillSource = "builtin" | "user";

/** 每个来源的同名技能只展示首个有效包，开关由来源和名称共同标识。 */
export type AgentSkillEntry = {
  name: string;
  source: AgentSkillSource;
  displayDescriptions: AgentSkillDisplayDescriptions;
  enabled: boolean;
};

export type AgentSkillsSnapshot = { skills: AgentSkillEntry[] };

export type AgentSkillIdentity = { source: AgentSkillSource; name: string };
export type AgentSkillFileEntry = { path: string; kind: "file" | "directory" };
export type AgentSkillTree = { skill: AgentSkillIdentity; entries: AgentSkillFileEntry[] };
export type AgentSkillDocument = { name: string; description: string; body: string };
export type AgentSkillFile = {
  skill: AgentSkillIdentity;
  path: string;
  revision: string;
  text: string | null; // 非 UTF-8 文本与超大文件仅提供文件信息。
  size: number;
  document?: AgentSkillDocument;
};
export type AgentSkillFileChange =
  | { operation: "create_file" | "create_directory" | "delete"; path: string }
  | { operation: "move"; path: string; destination: string };

/** 表单和持久化共用主文件约束，与技能加载器的名称及描述规则一致。 */
export function validate_agent_skill_document(
  document: AgentSkillDocument,
): "name" | "description" | null {
  if (
    document.name.length > MAX_SKILL_NAME_LENGTH ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(document.name)
  )
    return "name";
  if (
    !document.description.trim() ||
    document.description.length > MAX_SKILL_DESCRIPTION_LENGTH ||
    /[\r\n]/.test(document.description)
  )
    return "description";
  return null;
}
