import type { AgentSkillDisplayDescriptions } from "./agent";

export const AGENT_SKILL_MAIN_FILE = "SKILL.md";
export const AGENT_SKILL_UI_FILE = "ui.json";
const MAX_SKILL_NAME_LENGTH = 64;

/** 模型目录、偏好与编辑共用单行消费值，原文件由后端保留。 */
export function normalize_agent_skill_text(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/** 名称只承担逻辑身份，长度按 Unicode 字符计算，路径权限由资源入口校验。 */
export function is_agent_skill_name(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = normalize_agent_skill_text(value);
  return name.length > 0 && [...name].length <= MAX_SKILL_NAME_LENGTH;
}

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

/** 加载与编辑共用字段规则，返回首个无效字段。正文不参与元数据校验。 */
export function validate_agent_skill_document(document: {
  name: unknown;
  description: unknown;
}): "name" | "description" | null {
  if (!is_agent_skill_name(document.name)) return "name";
  if (typeof document.description !== "string" || !normalize_agent_skill_text(document.description))
    return "description";
  return null;
}
