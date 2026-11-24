import type { SettingsUpdateResponse } from "../../shared/settings";
import { is_agent_approval_mode } from "../../domain/setting";
import {
  APP_PREFILTER_SETTING_KEYS,
  read_app_prefilter_settings,
} from "../../domain/project-settings";
import type { JsonRecord } from "../../domain/json";
import { AppError } from "../../shared/error";
import type { ProjectWriteResult } from "../../shared/project-event";
import type { GlobalOperationGate } from "../runtime-operation-gate";
import type { ProjectContentService } from "../project/project-content-service";
import type { AppSettingService } from "./app-setting-service";

/** 应用预过滤开关在生命周期闸内顺次同步到已打开工程。 */
export class AppSettingsCommandService {
  /** 复用应用设置、工程身份与唯一写入口。 */
  public constructor(
    private readonly settings: AppSettingService, // 应用配置持久化拥有者
    private readonly gate: GlobalOperationGate, // 持有准备、提交与补偿的完整写租约
    private readonly projects: () => Iterable<{
      id: string;
      path: string;
      content: ProjectContentService;
    }>,
  ) {}

  /** 保存设置，跨工程失败时报告已完成的工程与失败位置。 */
  public async update(request: JsonRecord): Promise<SettingsUpdateResponse> {
    if (
      Object.hasOwn(request, "agent_approval_mode") &&
      !is_agent_approval_mode(request["agent_approval_mode"])
    ) {
      throw new AppError("request.validation_failed", {
        public_details: { field: "agent_approval_mode" },
      });
    }
    if (!APP_PREFILTER_SETTING_KEYS.some((key) => Object.hasOwn(request, key))) {
      return { ...this.settings.update_app_settings(request), accepted: true, changes: [] };
    }
    return await this.gate.run_laboratory(async () => {
      const projects = [...this.projects()];
      const keys = Object.keys(request);
      const filter = read_app_prefilter_settings({ ...this.settings.read_setting(), ...request });
      // 全部已打开工程完成预过滤准备后再落盘配置，确保准备期错误不留下未同步的设置修改。
      const prepared: Array<{ id: string; commit: () => Promise<ProjectWriteResult> }> = [];
      for (const project of projects) {
        prepared.push({
          id: project.id,
          commit: await project.content.prepare_prefilter_settings(project.path, filter),
        });
      }
      this.settings.update_app_settings(request, false);
      const changes: ProjectWriteResult["changes"] = [];
      const completed: string[] = [];
      let failure: AppError | undefined;
      for (const project of prepared) {
        try {
          const result = await project.commit();
          completed.push(project.id);
          changes.push(...result.changes);
        } catch (cause) {
          failure = new AppError("data.committed_sync_failed", {
            cause,
            public_details: {
              committed: true,
              action: "reload_project",
              completedProjectIds: completed,
              failedProjectId: project.id,
            },
          });
          break;
        }
      }
      try {
        this.settings.publish_settings_changed(keys);
      } catch (cause) {
        throw new AppError("data.committed_sync_failed", {
          cause: failure ? new AggregateError([failure, cause]) : cause,
          public_details: failure?.public_details ?? {
            committed: true,
            action: "reload_project",
            completedProjectIds: completed,
          },
        });
      }
      if (failure) throw failure;
      return {
        settings: this.settings.build_setting_snapshot(this.settings.read_setting()),
        accepted: true,
        changes,
      };
    });
  }
}
