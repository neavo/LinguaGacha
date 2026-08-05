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

type AgentSessionSeedMessage = Readonly<{
  role: "user" | "assistant";
  content: string;
}>;

/** 每个新 Agent 会话最先进入模型历史的有序 user / assistant 消息列表，可为空。 */
export type AgentSessionSeed = readonly AgentSessionSeedMessage[];

/** 所有结构错误共享同一诊断语义，调用方无需理解资源内部 schema。 */
function throw_invalid_agent_session_seed(file_path: string): never {
  throw new AppErrors.InvalidFileStructureError({
    diagnostic_context: { reason: "invalid_agent_session_seed", path: file_path },
  });
}

/** 读取必需的内置会话种子；缺失或结构损坏时阻止启动。 */
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
  if (!Array.isArray(parsed)) {
    throw_invalid_agent_session_seed(file_path);
  }
  return parsed.map((value) => {
    if (
      !is_json_record(value) ||
      Object.keys(value).length !== 2 ||
      (value["role"] !== "user" && value["role"] !== "assistant") ||
      typeof value["content"] !== "string"
    ) {
      throw_invalid_agent_session_seed(file_path);
    }
    return { role: value["role"], content: value["content"].trim() };
  });
}

/** 把种子写入模型历史而不进入 AgentService 的公开 UI 时间线。 */
export function append_agent_session_seed(
  session_manager: AgentSessionSeedManager,
  seed: AgentSessionSeed,
  model: Model<Api>,
): void {
  const timestamp = Date.now();
  for (const message of seed) {
    if (message.role === "user") {
      session_manager.appendMessage({ role: "user", content: message.content, timestamp });
      continue;
    }
    session_manager.appendMessage({
      role: "assistant",
      // SDK 的 assistant 消息类型要求 usage，种子并非真实响应，数值全程置零
      content: [{ type: "text", text: message.content }],
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
}
