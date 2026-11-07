import { describe_emit_image } from "../../tools/emit-image";
import { describe_doing } from "../../tools/doing";
import { describe_workspace_contract } from "../../tools/contract";

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
      "/** 用户技能根目录的绝对路径，可读写，不同工程共用，工作区重置时保留。 */\nuserSkillDirectory: string;",
      "/** 应用随附字体目录的绝对路径，只读。`LGBaseFont` 是应用界面字体。 */\nfontsDirectory: string;",
      describe_emit_image(),
      describe_doing(),
      "/** 用火山引擎预设发送一次视频识别请求，模型与参数由宿主固定，不重试。file 为小于 50 MB 的 mp4，工作区相对路径或本机绝对路径。返回脱敏的原始响应文本，调用方解析并检查状态与可见输出。用法见 `video` 技能。 */\nrequestVideo(file: string, prompt: string): Promise<string>;",
    ].map((member) =>
      member
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    ),
    "}>;",
  ].join("\n");
}
