import { ApiStreamHub } from "../api/api-stream-hub";
import type { ApiJsonValue } from "../api/api-types";
import {
  ProjectChangeEventAdapter,
  type ProjectChangeDraftRecord,
} from "./project-change-event-adapter";
import { PROJECT_CHANGE_EVENT_TOPIC, type ProjectChangeEvent } from "../../shared/project-event";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 项目数据变更发布器：把领域变更草稿适配为 ProjectChangeEvent 后广播
 */
export class ProjectChangePublisher {
  private readonly project_change_adapter: ProjectChangeEventAdapter; // adapter 是领域变更到公开 ProjectChangeEvent 的唯一出口

  private readonly api_stream_hub: ApiStreamHub; // api_stream_hub 只广播已适配的公开 JSON topic

  /**
   * 注入变更适配器和公开 stream hub，项目域不需要理解 SSE 连接
   */
  public constructor(
    project_change_adapter: ProjectChangeEventAdapter,
    api_stream_hub: ApiStreamHub,
  ) {
    this.project_change_adapter = project_change_adapter;
    this.api_stream_hub = api_stream_hub;
  }

  /**
   * 发布项目数据变更，并把同一份 ProjectChangeEvent 返回给 HTTP mutation 响应
   */
  public publish_project_change(payload: ProjectChangeDraftRecord): ProjectChangeEvent | null {
    const event = this.project_change_adapter.adapt_project_change(payload);
    if (event === null) {
      return null;
    }
    this.api_stream_hub.publish(PROJECT_CHANGE_EVENT_TOPIC, event as unknown as JsonRecord);
    return event;
  }
}
