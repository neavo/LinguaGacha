import { default_native_fs, type NativeFs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { AppPathService } from "../app/app-path-service";

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
    throw new AppErrors.FileIoFailedError({
      cause: error,
      diagnostic_context: { reason: "agent_system_prompt_read_failed", path: file_path },
    });
  }
  if (system_prompt === "") {
    throw new AppErrors.InvalidFileStructureError({
      diagnostic_context: { reason: "empty_agent_system_prompt", path: file_path },
    });
  }
  return system_prompt;
}
