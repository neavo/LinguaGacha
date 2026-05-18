import { CoreEventHub } from "../events/core-event-hub";
import type { ApiJsonValue } from "../api/api-types";
import {
  ProjectChangeEventAdapter,
  type ProjectChangeDraftRecord,
} from "./project-change-event-adapter";
import { PROJECT_CHANGE_EVENT_TOPIC, type ProjectChangeEvent } from "../../shared/project/event";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 项目数据变更发布器：把领域变更草稿适配为 ProjectChangeEvent 后广播
 */
export class ProjectChangePublisher {
  private readonly project_change_adapter: ProjectChangeEventAdapter; // adapter 是领域变更到公开事件的唯一出口

  private readonly core_event_hub: CoreEventHub; // event hub 只广播已适配的公开 JSON 事件

  /**
   * 注入变更适配器和公开事件总线，任务域不需要理解 SSE topic
   */
  public constructor(
    project_change_adapter: ProjectChangeEventAdapter,
    core_event_hub: CoreEventHub,
  ) {
    this.project_change_adapter = project_change_adapter;
    this.core_event_hub = core_event_hub;
  }

  /**
   * 发布项目数据变更，并把同一份公开事件返回给 HTTP mutation 响应
   */
  public publish_project_change(payload: ProjectChangeDraftRecord): ProjectChangeEvent | null {
    const event = this.project_change_adapter.adapt_project_change(payload);
    if (event === null) {
      return null;
    }
    this.core_event_hub.publish(PROJECT_CHANGE_EVENT_TOPIC, event as unknown as JsonRecord);
    return event;
  }
}
