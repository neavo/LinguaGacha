import { is_json_record, type JsonRecord, type JsonValue } from "../../../domain/json";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import type { AgentWorkspaceRuntimeContract } from "../workspace/schema";
import {
  AGENT_WORKSPACE_RUNTIME_METHODS,
  execute_agent_workspace_method,
  type AgentWorkspaceMethodName,
  type AgentWorkspaceRuntimeMethods,
} from "../methods/registry";
import { create_agent_workspace_method_context, type AgentWorkspaceReadPort } from "./data";

export type AgentWorkspaceRuntimeResponse =
  | { ok: true; result: JsonValue }
  | { ok: false; message: string };

export type AgentWorkspaceProgram = (workspace: AgentWorkspaceRuntimeApi) => Promise<unknown>;

export type AgentWorkspaceRuntimeApi = Readonly<
  { contract: AgentWorkspaceRuntimeContract } & AgentWorkspaceRuntimeMethods
>;

/** 收窄 stdin 的唯一请求对象，不接受空脚本或协议外字段。 */
export function read_agent_workspace_runtime_request(value: unknown): { script: string } {
  if (!is_json_record(value) || Object.keys(value).length !== 1 || !("script" in value)) {
    throw new Error("Runtime request must contain only script.");
  }
  const script = value["script"];
  if (typeof script !== "string" || script.trim() === "") {
    throw new Error("Runtime script must be a non-empty string.");
  }
  return { script };
}

/** 把脚本作为 TypeScript 异步函数体交给 Deno 原生模块加载器转译。 */
export async function execute_agent_workspace_script(
  script: string,
  read_port: AgentWorkspaceReadPort,
): Promise<AgentWorkspaceRuntimeResponse> {
  try {
    const program = await load_agent_workspace_program(script);
    return await execute_agent_workspace_program(program, read_port);
  } catch (error) {
    return { ok: false, message: error_message(error) };
  }
}

/** 用已加载程序验证冻结端口、JSON 投影与结果上限；Node 单测无需模拟 Deno 转译器。 */
export async function execute_agent_workspace_program(
  program: AgentWorkspaceProgram,
  read_port: AgentWorkspaceReadPort,
): Promise<AgentWorkspaceRuntimeResponse> {
  try {
    const result = await program(create_workspace(read_port));
    if (result === undefined) {
      return { ok: false, message: "工作区脚本必须显式返回 JSON 结果。" };
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(result);
    } catch (error) {
      return { ok: false, message: error_message(error) };
    }
    if (serialized === undefined) {
      return { ok: false, message: "工作区脚本必须显式返回 JSON 结果。" };
    }
    if (
      new TextEncoder().encode(serialized).byteLength > AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes
    ) {
      return {
        ok: false,
        message: "脚本返回结果过大；请在工作区内完成聚合并只返回摘要。",
      };
    }
    return { ok: true, result: JSON.parse(serialized) as JsonValue };
  } catch (error) {
    return { ok: false, message: error_message(error) };
  }
}

/** blob URL 保持脚本只存在于当前进程，并交给 Deno 的 TypeScript loader。 */
async function load_agent_workspace_program(script: string): Promise<AgentWorkspaceProgram> {
  const source = [
    "export default async function agentWorkspaceProgram(workspace: any) {",
    script,
    "}",
    "//# sourceURL=agent-workspace-program.ts",
  ].join("\n");
  const module_url = URL.createObjectURL(new Blob([source], { type: "application/typescript" }));
  try {
    const module = (await import(module_url)) as { default?: unknown };
    if (typeof module.default !== "function") {
      throw new Error("Agent Workspace TypeScript program is missing its executable entry.");
    }
    return module.default as AgentWorkspaceProgram;
  } finally {
    URL.revokeObjectURL(module_url);
  }
}

/** contract 与注册方法共同投影为脚本唯一全局端口。 */
function create_workspace(read_port: AgentWorkspaceReadPort): AgentWorkspaceRuntimeApi {
  const context = create_agent_workspace_method_context(read_port);
  const methods = Object.fromEntries(
    Object.entries(AGENT_WORKSPACE_RUNTIME_METHODS).map(([name]) => [
      name,
      async (args: unknown) =>
        await execute_agent_workspace_method(
          name as AgentWorkspaceMethodName,
          context,
          require_method_args(args, name),
        ),
    ]),
  ) as AgentWorkspaceRuntimeMethods;
  return deep_freeze({
    contract: deep_freeze(structuredClone(context.contract)),
    ...methods,
  });
}

/** 领域 Schema 细化前先统一拒绝非对象参数。 */
function require_method_args(value: unknown, name: string): JsonRecord {
  if (!is_json_record(value)) throw new Error(`${name} args must be an object`);
  return value;
}

function deep_freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deep_freeze(child);
  return Object.freeze(value);
}

/** 空异常正文回退到稳定脚本错误，保留其它可修复信息。 */
function error_message(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === "" ? "工作区脚本执行失败。" : message;
}
