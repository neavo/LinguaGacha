import { describe_emit_image } from "../../tools/emit-image";
import { describe_doing } from "../../tools/doing";
import { describe_workspace_contract } from "../contract";

/**
 * 使用 TypeScript 声明紧凑描述参数、联合类型与返回结构，减少模型能力说明的 token 开销。
 * 工作区脚本执行 JavaScript；声明用于能力说明，实际数据校验由运行时 Schema 负责。
 */
export function format_agent_workspace_typescript_api(): string {
  const contract = describe_workspace_contract();
  return [
    contract.types,
    "",
    "declare const ws: Readonly<{",
    ...[
      contract.member,
      "/** 应用共用的用户技能根目录，使用绝对路径，可读写。 */\nuserSkillDirectory: string;",
      "/** 应用随附字体目录的绝对路径，只读。 */\nfontsDirectory: string;",
      describe_emit_image(),
      describe_doing(),
    ].map((member) =>
      member
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    ),
    "}>;",
  ].join("\n");
}
