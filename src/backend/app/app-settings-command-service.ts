import type { SettingsSnapshotResponse, SettingsUpdateResponse } from "../../shared/settings";
import {
  Setting,
  is_agent_approval_mode,
  is_proxy_mode,
  is_proxy_protocol,
  read_proxy_setting,
} from "../../domain/setting";
import {
  APP_PREFILTER_SETTING_KEYS,
  read_app_prefilter_settings,
} from "../../domain/project-settings";
import { is_json_record, type JsonRecord, type MutableJsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type { ProjectWriteResult } from "../../shared/project-event";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import type { ProjectSessionState } from "../project/project-session-state";
import type { ProjectContentService } from "../project/project-content-service";
import type { AppProxyService } from "./app-proxy-service";
import type { AppSettingService } from "./app-setting-service";

/** 设置命令拥有应用预过滤开关与当前工程同步的完整边界；持久化仍由各自服务负责。 */
export class AppSettingsCommandService {
  private proxy_save: Promise<unknown> = Promise.resolve(); // 代理下发与落盘按到达顺序整体串行

  /** 复用应用设置、工程身份与唯一写入口。 */
  public constructor(
    private readonly settings: AppSettingService, // 应用配置持久化拥有者
    private readonly gate: RuntimeOperationGate, // 持有准备、提交与补偿的完整写租约
    private readonly session: ProjectSessionState, // 当前工程的权威身份
    private readonly content: ProjectContentService, // 工程设置和预过滤的准备与提交入口
    private readonly proxy: AppProxyService, // 出站代理下发与运行期状态
  ) {}

  /** 保存用户修改；涉及已加载工程时统一完成同步与失败补偿。 */
  public async update(request: JsonRecord): Promise<SettingsUpdateResponse> {
    if (Object.hasOwn(request, "proxy")) validate_proxy_request(request["proxy"]);
    if (
      Object.hasOwn(request, "agent_approval_mode") &&
      !is_agent_approval_mode(request["agent_approval_mode"])
    ) {
      throw new AppError("request.validation_failed", {
        public_details: { field: "agent_approval_mode" },
      });
    }
    if (
      !this.session.snapshot().loaded ||
      !APP_PREFILTER_SETTING_KEYS.some((key) => Object.hasOwn(request, key))
    ) {
      return { ...(await this.write_settings(request)), accepted: true, changes: [] };
    }
    return await this.gate.run_project_write(async () => {
      const before = this.settings.read_setting();
      const previous = Setting.from_json(before);
      let next = previous;
      for (const [key, value] of Object.entries(request))
        next = next.with_setting_value(key, value);
      const next_snapshot = next.to_snapshot();
      const previous_snapshot = previous.to_snapshot();
      const changed_project_keys = APP_PREFILTER_SETTING_KEYS.filter(
        (key) => next_snapshot[key] !== previous_snapshot[key],
      );
      if (changed_project_keys.length === 0)
        return { ...(await this.write_settings(request)), accepted: true, changes: [] };

      // 项目语言由项目持有，预过滤读取项目语言并只采用新的应用开关。
      const commit = await this.content.prepare_prefilter_settings(
        this.session.require_loaded_project_path(),
        read_app_prefilter_settings(next_snapshot),
      );
      const rollback: MutableJsonRecord = {};
      const next_json = next.to_json();
      const changed_keys = Object.keys(request).filter((key) => next_json[key] !== before[key]);
      for (const key of changed_keys) rollback[key] = before[key] ?? null;

      // 先保存配置，工程失败时只补偿本次字段。事件等两个存储完成后发布。
      await this.write_settings(request, false);
      let result: ProjectWriteResult;
      try {
        result = await commit();
      } catch (error) {
        if (error instanceof AppError && error.code === "data.committed_sync_failed") {
          this.publish_committed_settings(changed_keys, error);
        } else {
          try {
            await this.write_settings(rollback, false);
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
      };
    });
  }

  /**
   * 应用级设置写入：代理字段先下发到宿主，再落盘；落盘失败回滚到上一份配置。
   *
   * 其它字段保持原有同步写入。代理整体串行，连续保存按到达顺序应用，最后一次为准。
   */
  private async write_settings(
    request: JsonRecord,
    publish = true,
  ): Promise<SettingsSnapshotResponse> {
    if (!Object.hasOwn(request, "proxy")) {
      return this.settings.update_app_settings(request, publish);
    }
    return await this.run_serialized(async () => {
      const previous = this.settings.read_setting()["proxy"];
      await this.proxy.apply_or_throw(request["proxy"]);
      try {
        return this.settings.update_app_settings(request, publish);
      } catch (error) {
        await this.proxy.revert(previous, error); // 恢复失败时抛出并保留落盘原因
        throw error;
      }
    });
  }

  /** 代理配置必须先下发、后落盘，串行避免两份保存交错成「文件与出站不一致」。 */
  private async run_serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.proxy_save.then(operation, operation);
    this.proxy_save = result.then(
      () => undefined,
      () => undefined,
    );
    return await result;
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

/**
 * 代理设置整体校验：模式与协议必须是已知值，切到手动时字段必须完整。
 *
 * 请求值非法时拒绝保存，设置文件与出站配置都保持不变；手工改坏的文件仍按
 * `read_proxy_setting` 归一为跟随系统，两者不冲突。
 */
function validate_proxy_request(value: unknown): void {
  if (!is_json_record(value)) throw validation_error("proxy");
  if (!is_proxy_mode(value["mode"])) throw validation_error("proxy.mode");
  if (!is_proxy_protocol(value["protocol"])) throw validation_error("proxy.protocol");
  const incomplete_field = read_proxy_setting(value).incomplete_field;
  if (incomplete_field !== null) throw validation_error(incomplete_field);
}

/** 定位到具体控件，界面据此在对应输入项反馈。 */
function validation_error(field: string): AppError {
  return new AppError("request.validation_failed", { public_details: { field } });
}
