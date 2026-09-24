import type { AgentSkillDisplayDescriptions } from "./agent";

export type AgentSkillSource = "builtin" | "user";

/** 每个来源的同名技能只展示首个有效包，开关由来源和名称共同标识。 */
export type AgentSkillEntry = {
  name: string;
  source: AgentSkillSource;
  displayDescriptions: AgentSkillDisplayDescriptions;
  enabled: boolean;
};

export type AgentSkillsSnapshot = { skills: AgentSkillEntry[] };
