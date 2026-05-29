import { api_fetch } from "@frontend/app/desktop/desktop-api";

export type WorkbenchTaskSectionRevisions = Record<string, number | undefined>;

type WorkbenchTaskRevisionsResponse = {
  sectionRevisions?: WorkbenchTaskSectionRevisions;
};

// 工作台任务只读取启动、重置和导入需要的项目 revision。
export async function read_workbench_task_section_revisions(): Promise<WorkbenchTaskSectionRevisions> {
  const response = await api_fetch<WorkbenchTaskRevisionsResponse>("/api/workbench/view", {});
  return response.sectionRevisions ?? {};
}
