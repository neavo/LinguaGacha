/** 用户技能根由应用路径服务提供，声明说明其跨工作区用途。 */
export function describe_user_skill_directory(): string {
  return "/** 用户技能根目录的绝对路径，可读写，不同工程共用，工作区重置时保留。 */\nuserSkillDirectory: string;";
}
