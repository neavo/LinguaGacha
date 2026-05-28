import { api_fetch } from "@/app/desktop/desktop-api";

// ProjectQuerySectionRevisions 是页面 mutation 读取的后端乐观锁依赖集合。
export type ProjectQuerySectionRevisions = Record<string, number | undefined>;

type ProjectRevisionsQueryResponse = {
  sectionRevisions?: ProjectQuerySectionRevisions;
};

// 项目 mutation 只读取后端 query 返回的 revision，避免依赖前端项目事实镜像。
export async function read_project_section_revisions(): Promise<ProjectQuerySectionRevisions> {
  const response = await api_fetch<ProjectRevisionsQueryResponse>(
    "/api/project/query/workbench",
    {},
  );
  return response.sectionRevisions ?? {};
}
