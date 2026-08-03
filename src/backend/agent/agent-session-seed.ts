import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

import { is_json_record } from "../../domain/json";
import { default_native_fs, type NativeFs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";
import type { AppPathService } from "../app/app-path-service";

type AgentSessionSeedPaths = Pick<AppPathService, "get_agent_session_seed_path">;
type AgentSessionSeedNativeFs = Pick<NativeFs, "read_text_file">;
type AgentSessionSeedManager = Pick<SessionManager, "appendMessage">;

/** 每个新 Agent 会话最先进入模型历史的一问一答种子。 */
export type AgentSessionSeed = Readonly<{
  user: string;
  assistant: string;
}>;

/** 读取必需的内置会话种子；缺失或损坏时禁止无种子启动。 */
export function load_agent_session_seed(
  paths: AgentSessionSeedPaths,
  native_fs: AgentSessionSeedNativeFs = default_native_fs,
): AgentSessionSeed {
  const file_path = paths.get_agent_session_seed_path();
  let parsed: unknown;
  try {
    parsed = JsonTool.parseStrict(native_fs.read_text_file(file_path));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppErrors.FileParseFailedError({
        cause: error,
        diagnostic_context: { reason: "agent_session_seed_parse_failed", path: file_path },
      });
    }
    throw new AppErrors.FileIoFailedError({
      cause: error,
      diagnostic_context: { reason: "agent_session_seed_read_failed", path: file_path },
    });
  }
  if (
    !is_json_record(parsed) ||
    Object.keys(parsed).length !== 2 ||
    typeof parsed["user"] !== "string" ||
    parsed["user"].trim() === "" ||
    typeof parsed["assistant"] !== "string" ||
    parsed["assistant"].trim() === ""
  ) {
    throw new AppErrors.InvalidFileStructureError({
      diagnostic_context: { reason: "invalid_agent_session_seed", path: file_path },
    });
  }
  return { user: parsed["user"].trim(), assistant: parsed["assistant"].trim() };
}

/** 把种子写入模型历史而不进入 AgentService 的公开 UI 时间线。 */
export function append_agent_session_seed(
  session_manager: AgentSessionSeedManager,
  seed: AgentSessionSeed,
  model: Model<Api>,
): void {
  const timestamp = Date.now();
  session_manager.appendMessage({ role: "user", content: seed.user, timestamp });
  session_manager.appendMessage({
    role: "assistant",
    // SDK 的 assistant 消息类型要求 usage，种子并非真实响应，数值全程置零
    content: [{ type: "text", text: seed.assistant }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  });
}
