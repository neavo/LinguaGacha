import { describe_emit_image } from "../../tools/emit-image";
import { describe_host } from "../../tools/host";
import { describe_workspace_contract } from "../../tools/contract";
import { describe_user_skill_directory } from "../../tools/user-skill-directory";

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
      describe_user_skill_directory(),
      describe_emit_image(),
      describe_host(),
    ].map((member) =>
      member
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    ),
    "}>;",
  ].join("\n");
}
