import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { api_get } from "@frontend/app/desktop/desktop-api";
import { AgentSessionStoreContext } from "@frontend/app/session/agent/agent-session-context";
import { useProjectChangeSignal } from "@frontend/app/state/use-desktop-state";
import { useProjectChangeSeqForSections } from "@frontend/app/state/project-change-signal";
import type { AgentFileCandidate, AgentFilesResponse } from "@shared/agent-reference";

/** 菜单查询只持有展示数据；会话、草稿上传与项目变更继续由各自拥有者管理。 */
export function useAgentMentionFiles(open: boolean, upload_key: string) {
  const session = useContext(AgentSessionStoreContext);
  if (session === null) throw new Error("Agent file mentions require AgentSessionProvider.");
  const project_change = useProjectChangeSignal();
  const change = useProjectChangeSeqForSections(project_change, ["files", "items", "pdf"]);
  const session_id = useSyncExternalStore(session.subscribe_input, session.get_session_id);
  const [state, set_state] = useState<{
    files: AgentFileCandidate[];
    status: "idle" | "loading" | "ready" | "error";
  }>({ files: [], status: "idle" });
  useEffect(() => {
    if (!open || session_id === null) {
      set_state({ files: [], status: "idle" });
      return;
    }
    let active = true; // 关闭菜单或切换会话后，旧请求只完成自身等待。
    set_state({ files: [], status: "loading" });
    void api_get<AgentFilesResponse>("/api/agent/files")
      .then((result) => {
        if (active && result.sessionId === session_id && session.get_session_id() === session_id)
          set_state({ files: result.files, status: "ready" });
      })
      .catch(() => {
        if (active) set_state({ files: [], status: "error" });
      });
    return () => {
      active = false;
    };
  }, [open, session_id, session, upload_key, change]);
  return state;
}
