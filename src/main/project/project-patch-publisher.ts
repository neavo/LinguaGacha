import { CoreEventHub } from "../events/core-event-hub";
import type { ApiJsonValue } from "../api/api-types";
import { ProjectPatchAdapter } from "./project-patch-adapter";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 项目 patch 发布器：补齐数据库运行态后通过 Core 事件总线广播 `project.patch`
 */
export class ProjectPatchPublisher {
  private readonly project_patch_adapter: ProjectPatchAdapter; // project_patch_adapter 是最小 patch 到公开项目事实的唯一适配入口

  private readonly core_event_hub: CoreEventHub; // core_event_hub 只负责广播已经适配好的公开事件

  /**
   * 注入 patch 适配器和公开事件总线，避免任务域直接持有项目 patch 细节
   */
  public constructor(project_patch_adapter: ProjectPatchAdapter, core_event_hub: CoreEventHub) {
    this.project_patch_adapter = project_patch_adapter;
    this.core_event_hub = core_event_hub;
  }

  /**
   * 发布 project.patch；调用方只提供最小 patch 语义
   */
  public publish_project_patch(payload: JsonRecord): void {
    this.core_event_hub.publish(
      "project.patch",
      this.project_patch_adapter.adapt_project_patch(payload),
    );
  }
}
