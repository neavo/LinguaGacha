import { default_native_fs, type NativeFs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { AppPathService } from "../app/app-path-service";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./workspace/runtime/policy";
import { format_agent_workspace_tool_routes } from "./workspace/runtime/tool/api-description";

type AgentSystemPromptPaths = Pick<AppPathService, "get_agent_system_prompt_path">;
type AgentSystemPromptNativeFs = Pick<NativeFs, "read_text_file">;

/** 读取必需的内置 Agent system prompt；资源损坏时禁止无基础约束启动。 */
export function load_agent_system_prompt(
  paths: AgentSystemPromptPaths,
  native_fs: AgentSystemPromptNativeFs = default_native_fs,
): string {
  const file_path = paths.get_agent_system_prompt_path();
  let system_prompt: string;
  try {
    system_prompt = native_fs.read_text_file(file_path).trim();
  } catch (error) {
    throw new AppErrors.AppError("file.io_failed", {
      cause: error,
      diagnostic_context: { reason: "agent_system_prompt_read_failed", path: file_path },
    });
  }
  if (system_prompt === "") {
    throw new AppErrors.AppError("file.invalid_structure", {
      diagnostic_context: { reason: "empty_agent_system_prompt", path: file_path },
    });
  }
  return fill_workspace_runtime_placeholders(system_prompt, file_path);
}

/** 静态 Markdown 拥有正文结构；这里只投影运行时机器事实并严格验证模板。 */
function fill_workspace_runtime_placeholders(template: string, file_path: string): string {
  const policy = AGENT_WORKSPACE_RUNTIME_POLICY;
  const replacements = new Map([
    ["{{WORKSPACE_WRITE_SCOPES}}", policy.writeRoots.map((root) => `\`${root}/**\``).join("、")],
    ["{{WORKSPACE_DENO_ARGS}}", policy.denoArgs.map((argument) => `\`${argument}\``).join("、")],
    ["{{WORKSPACE_TOOL_ROUTES}}", format_agent_workspace_tool_routes()],
  ]);
  let result = template;
  for (const [placeholder, value] of replacements) {
    const occurrences = result.split(placeholder).length - 1;
    if (occurrences !== 1) {
      throw new AppErrors.AppError("file.invalid_structure", {
        diagnostic_context: {
          reason: "agent_system_prompt_placeholder_invalid",
          path: file_path,
          placeholder,
          occurrences,
        },
      });
    }
    result = result.replace(placeholder, value);
  }
  const unresolved_placeholder = result.match(/\{\{WORKSPACE_[A-Z_]+\}\}/u)?.[0];
  if (unresolved_placeholder !== undefined) {
    throw new AppErrors.AppError("file.invalid_structure", {
      diagnostic_context: {
        reason: "agent_system_prompt_placeholder_invalid",
        path: file_path,
        placeholder: unresolved_placeholder,
        occurrences: result.split(unresolved_placeholder).length - 1,
      },
    });
  }
  return result;
}
