import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentSessionStoreContext } from "@frontend/app/session/agent/agent-session-context";
import { AgentSessionStore } from "@frontend/app/session/agent/agent-session-store";
import { api_get } from "@frontend/app/desktop/desktop-api";
import type { AgentFilesResponse } from "@shared/agent-reference";
import { useAgentMentionFiles } from "./use-agent-mention-files";

vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_get: vi.fn() }));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useProjectChangeSignal: () => ({ seq: 0, updated_sections: [] }),
}));

it("菜单查询按上传完成刷新，跨会话迟到结果不会覆盖新文件", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let sessionId = "one";
  const store = new AgentSessionStore(window.localStorage, vi.fn());
  vi.spyOn(store, "get_session_id").mockImplementation(() => sessionId);
  const pending: ((value: AgentFilesResponse) => void)[] = [];
  vi.mocked(api_get).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve as (value: AgentFilesResponse) => void)),
  );
  let value: ReturnType<typeof useAgentMentionFiles>;
  /** 暴露 Hook 的查询结果，测试从渲染边界推进状态。 */
  function Probe({ open, upload }: { open: boolean; upload: string }) {
    value = useAgentMentionFiles(open, upload);
    return null;
  }
  /** 同一实例接收菜单与会话变化。 */
  async function render(open: boolean, upload = "") {
    await act(async () =>
      root.render(
        <AgentSessionStoreContext.Provider value={store}>
          <Probe open={open} upload={upload} />
        </AgentSessionStoreContext.Provider>,
      ),
    );
  }
  try {
    await render(false);
    expect(api_get).not.toHaveBeenCalled();
    await render(true);
    expect(value!.status).toBe("loading");
    await act(async () =>
      pending.shift()!({
        sessionId: "one",
        files: [{ kind: "workspace", path: "书.epub", count: 12, unit: "items" }],
      }),
    );
    expect(value!.files[0]?.path).toBe("书.epub");
    await render(true, "uploaded");
    expect(api_get).toHaveBeenCalledTimes(2);
    const old = pending.shift()!;
    sessionId = "two";
    await render(true, "uploaded");
    await act(async () =>
      old({ sessionId: "one", files: [{ kind: "upload", path: "uploads/old.txt", size: 1 }] }),
    );
    expect(value!.files).toEqual([]);
    await act(async () =>
      pending.shift()!({
        sessionId: "two",
        files: [{ kind: "upload", path: "uploads/new.txt", size: 2 }],
      }),
    );
    expect(value!.files[0]?.path).toBe("uploads/new.txt");
  } finally {
    await act(async () => root.unmount());
  }
});
