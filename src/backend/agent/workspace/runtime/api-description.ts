import { WORKSPACE_HOST_REQUEST_SCHEMA, WORKSPACE_IMAGE_OPTIONS_SCHEMA } from "./host-contract";
import { create_schema_renderer } from "../schema-description";
import type { TSchema } from "@earendil-works/pi-ai";

import { AGENT_TODO_ITEM_LIMIT, AGENT_TODO_TEXT_LIMIT } from "../../../../shared/agent-todo";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA } from "../schema";

const NAMED_SCHEMAS = new Map<TSchema, string>([
  [AGENT_WORKSPACE_CONTRACT_SCHEMA, "WorkspaceContract"],
]);

/**
 * 使用 TypeScript 声明紧凑描述参数、联合类型与返回结构，减少模型能力说明的 token 开销。
 * 工作区脚本执行 JavaScript；声明用于能力说明，实际数据校验由运行时 Schema 负责。
 */
export function format_agent_workspace_typescript_api(): string {
  const { render: render_schema, declarations } = create_schema_renderer(NAMED_SCHEMAS);
  return [
    declarations(),
    "",
    "declare const ws: Readonly<{",
    "  contract: WorkspaceContract;",
    "  /** 用户技能根目录的绝对路径。 */",
    "  userSkillDirectory: string;",
    "  /** 输出工作区图片，按调用顺序返回。await 完成后内容已固定，模型在程序成功返回后看到图片。 */",
    `  emitImage(path: string, options?: ${render_schema(WORKSPACE_IMAGE_OPTIONS_SCHEMA)}): Promise<void>;`,
    `  host(request: ${render_schema(WORKSPACE_HOST_REQUEST_SCHEMA)}, signal?: AbortSignal): Promise<{ path: string }>;`,
    "  todo: Readonly<{",
    "    /** 读取当前有序 Todo。 */",
    "    read(): readonly string[];",
    `    /** 设置完整的有序 Todo，程序成功后提交。最多 ${AGENT_TODO_ITEM_LIMIT.toString()} 项。每项为不超过 ${AGENT_TODO_TEXT_LIMIT.toString()} 字符的短行动标签。去掉首尾空白后须非空。空数组清空 Todo。 */`,
    "    write(todos: readonly string[]): void;",
    "  }>;",
    "}>;",
  ].join("\n");
}
