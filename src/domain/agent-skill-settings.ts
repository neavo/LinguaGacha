import { read_json_record } from "./json";

export type AgentSkillSettings = {
  disabled: { builtin: string[]; user: string[] }; // 同名技能按来源独立开关。
  user_order: string[]; // 保留缺失技能的位置偏好。
};

/** 配置文件可被手动编辑，名称列表在持久化边界统一收窄并去重。 */
export function normalize_agent_skill_settings(value: unknown): AgentSkillSettings {
  const record = read_json_record(value);
  // 去重保留首个位置，避免手动配置改变排序语义。
  const names = (input: unknown): string[] =>
    Array.isArray(input)
      ? [
          ...new Set(
            input.filter(
              (name): name is string => typeof name === "string" && /^[a-z0-9-]+$/.test(name),
            ),
          ),
        ]
      : [];
  const disabled = read_json_record(record.disabled);
  return {
    disabled: {
      builtin: names(disabled.builtin),
      user: names(disabled.user),
    },
    user_order: names(record.user_order),
  };
}
