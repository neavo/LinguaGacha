import path from "node:path";
import { default_native_fs, type NativeFs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { AppPathService } from "../app/app-path-service";

type AgentSystemPromptPaths = Pick<AppPathService, "get_agent_system_prompt_path">;
type AgentSystemPromptNativeFs = Pick<NativeFs, "read_text_file">;
const PERSONALITY_SLOT = "{{agent_personality}}";

/** 读取必需的内置 Agent system prompt；资源损坏时禁止无基础约束启动。 */
export function load_agent_system_prompt(
  paths: AgentSystemPromptPaths,
  native_fs: AgentSystemPromptNativeFs = default_native_fs,
): string {
  const prompt = load_prompt(paths.get_agent_system_prompt_path(), native_fs);
  if (prompt.split(PERSONALITY_SLOT).length !== 2) {
    throw new AppErrors.AppError("file.invalid_structure", {
      diagnostic_context: { reason: "invalid_agent_personality_slot" },
    });
  }
  return prompt;
}

/** 在模板原位插入正文；回调替换保留用户输入中的美元符号等字面内容。 */
export function insert_agent_personality(prompt: string, personality: string): string {
  return prompt.replace(PERSONALITY_SLOT, () => personality);
}

/** 默认角色与固定系统指令同属启动资源，用户覆盖值由应用配置持久化。 */
export function load_agent_personality(
  paths: AgentSystemPromptPaths,
  native_fs: AgentSystemPromptNativeFs = default_native_fs,
): string {
  return load_prompt(
    path.join(path.dirname(paths.get_agent_system_prompt_path()), "personality.md"),
    native_fs,
  );
}

/** 默认人格和系统模板共用资源校验，读取失败保留路径与原始异常。 */
function load_prompt(file_path: string, native_fs: AgentSystemPromptNativeFs): string {
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
  return system_prompt;
}
