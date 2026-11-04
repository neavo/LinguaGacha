import { useEffect, useState } from "react";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import type { ProjectPreview, ProjectPreviewResponse } from "@shared/project-preview";

type PreviewState =
  | { status: "idle" | "loading" | "failed" }
  | { status: "ready"; preview: ProjectPreview };

/** 路径变化与卸载都撤销旧请求，迟到结果不能覆盖当前路径。 */
export function useProjectPreview(path: string | null): PreviewState {
  const [result, set_result] = useState<{ path: string; state: PreviewState } | null>(null);
  useEffect(() => {
    set_result(null);
    if (path === null) return;
    const request = new AbortController();
    void api_fetch<ProjectPreviewResponse>("/api/session/project/preview", { path }, request.signal)
      .then(({ preview }) => {
        if (!request.signal.aborted) set_result({ path, state: { status: "ready", preview } });
      })
      .catch(() => {
        // 悬停读取失败时保留路径，直接打开仍由打开流程反馈错误。
        if (!request.signal.aborted) set_result({ path, state: { status: "failed" } });
      });
    return () => request.abort();
  }, [path]);
  if (path === null) return { status: "idle" };
  return result?.path === path ? result.state : { status: "loading" };
}
