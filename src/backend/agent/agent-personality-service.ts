import { createHash } from "node:crypto";
import type { JsonRecord } from "../../domain/json";
import type { AgentPersonality } from "../../shared/agent-personality";
import { AppError } from "../../shared/error";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { load_agent_personality } from "./agent-system-prompt";

/** 管理应用级角色覆盖值；正文仍由模型请求入口拼接进系统上下文。 */
export class AgentPersonalityService {
  /** 复用默认资源路径、应用配置写入口和 Agent 运行互斥。 */
  public constructor(
    private readonly paths: Pick<AppPathService, "get_agent_system_prompt_path">,
    private readonly settings: Pick<
      AppSettingService,
      "read_setting" | "save_setting" | "publish_settings_changed"
    >,
    private readonly gate: Pick<RuntimeOperationGate, "run_skill_write">,
  ) {}

  /** 返回有效正文，版本同时标识正文与是否存在用户覆盖。 */
  public read(): AgentPersonality {
    const value = this.settings.read_setting().agent_personality;
    const override = typeof value === "string" ? value : null;
    const body = override ?? load_agent_personality(this.paths);
    return {
      body,
      revision: createHash("sha256")
        .update(JSON.stringify([override, body]))
        .digest("hex"),
    };
  }

  /** 保存与重置共用版本检查和运行互斥；null 清除覆盖，空字符串保留用户选择。 */
  public save(request: JsonRecord): Promise<AgentPersonality> {
    return this.gate.run_skill_write(() => {
      if (
        (request.body !== null && typeof request.body !== "string") ||
        typeof request.revision !== "string"
      )
        throw new AppError("request.validation_failed");
      if (this.read().revision !== request.revision) throw new AppError("data.revision_conflict");
      this.settings.save_setting({
        ...this.settings.read_setting(),
        agent_personality: request.body,
      });
      this.settings.publish_settings_changed(["agent_personality"]);
      return this.read();
    });
  }
}
