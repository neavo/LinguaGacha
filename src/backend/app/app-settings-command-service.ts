import {
  Setting,
  PROJECT_SETTING_KEYS,
  normalize_project_settings_snapshot,
} from "../../domain/setting";
import type { JsonRecord, MutableJsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type { ProjectWriteResult } from "../../shared/project-event";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import type { ProjectSessionState } from "../project/project-session-state";
import type { ProjectContentService } from "../project/project-content-service";
import type { AppSettingService } from "./app-setting-service";

/** 设置命令拥有应用配置与当前工程同步的完整边界；持久化仍由各自服务负责。 */
export class AppSettingsCommandService {
  /** 复用应用设置、工程身份与唯一写入口。 */
  public constructor(
    private readonly settings: AppSettingService, // 应用配置持久化拥有者
    private readonly gate: RuntimeOperationGate, // 持有准备、提交与补偿的完整写租约
    private readonly session: ProjectSessionState, // 当前工程的权威身份
    private readonly content: ProjectContentService, // 工程设置和预过滤的准备与提交入口
  ) {}

  /** 保存用户修改；涉及已加载工程时统一完成同步与失败补偿。 */
  public async update(request: JsonRecord): Promise<JsonRecord> {
    if (
      !this.session.snapshot().loaded ||
      !PROJECT_SETTING_KEYS.some((key) => Object.hasOwn(request, key))
    ) {
      return { ...this.settings.update_app_settings(request), accepted: true, changes: [] };
    }
    return await this.gate.run_project_write(async () => {
      const before = this.settings.read_setting();
      const previous = Setting.from_json(before);
      let next = previous;
      for (const [key, value] of Object.entries(request))
        next = next.with_setting_value(key, value);
      const next_snapshot = next.to_snapshot();
      const previous_snapshot = previous.to_snapshot();
      const changed_project_keys = PROJECT_SETTING_KEYS.filter(
        (key) => next_snapshot[key] !== previous_snapshot[key],
      );
      if (changed_project_keys.length === 0)
        return { ...this.settings.update_app_settings(request), accepted: true, changes: [] };

      const commit = this.content.prepare_settings_alignment(
        this.session.require_loaded_project_path(),
        normalize_project_settings_snapshot(next_snapshot),
        changed_project_keys.some((key) => key !== "target_language"),
      );
      const rollback: MutableJsonRecord = {};
      const next_json = next.to_json();
      const changed_keys = Object.keys(request).filter((key) => next_json[key] !== before[key]);
      for (const key of changed_keys) rollback[key] = before[key] ?? null;

      // 先保存配置，工程失败时只补偿本次字段。事件等两个存储完成后发布。
      this.settings.update_app_settings(request, false);
      let result: ProjectWriteResult;
      try {
        result = await commit();
      } catch (error) {
        if (error instanceof AppError && error.code === "data.committed_sync_failed") {
          this.publish_committed_settings(changed_keys, error);
        } else {
          try {
            this.settings.update_app_settings(rollback, false);
          } catch (rollback_error) {
            throw new AggregateError(
              [error, rollback_error],
              "Failed to restore app settings after project write failure.",
            );
          }
        }
        throw error;
      }
      this.publish_committed_settings(changed_keys);
      return {
        settings: this.settings.build_setting_snapshot(this.settings.read_setting()),
        ...result,
      } as unknown as JsonRecord;
    });
  }

  /** 两个存储已完成，通知失败保留 committed 语义与原始故障。 */
  private publish_committed_settings(changed_keys: string[], committed_error?: AppError): void {
    try {
      this.settings.publish_settings_changed(changed_keys);
    } catch (cause) {
      throw new AppError("data.committed_sync_failed", {
        cause:
          committed_error === undefined
            ? cause
            : new AggregateError(
                [committed_error, cause],
                "Settings and project publication failed.",
              ),
        public_details: { committed: true, action: "reload_project" },
      });
    }
  }
}
