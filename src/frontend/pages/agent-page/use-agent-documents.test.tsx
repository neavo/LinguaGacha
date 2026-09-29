import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentDocuments } from "./use-agent-documents";
import type { AgentDocument } from "@shared/agent-workspace-file";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  saved: null as unknown,
  get: (): unknown => mocks.saved,
  set: (_key: string, value: unknown): void => {
    mocks.saved = value;
  },
  t: (key: string): string => key,
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: mocks.api }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_toast: mocks.toast }));
vi.mock("@frontend/app/locale/locale-context", () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock("@frontend/app/session/project-session-ui-state-context", () => ({
  useProjectSessionUiState: () => ({ get_page_ui_state: mocks.get, set_page_ui_state: mocks.set }),
}));

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useAgentDocuments>;
/** 直接观察 Hook 的公开状态，异步验证不依赖菜单和 Markdown 渲染。 */
function Harness({ session }: { session: string }) {
  state = useAgentDocuments(session);
  return null;
}
/** 用文件内容区分旧响应与当前文件，避免只断言调用次数。 */
function document(path: string, content = "正文"): AgentDocument {
  return { sessionId: "session", path, content };
}
/** 手动完成网络请求，稳定复现关闭、离页及乱序响应。 */
function pending_read() {
  let resolve!: (value: AgentDocument) => void;
  const promise = new Promise<AgentDocument>((finish) => {
    resolve = finish;
  });
  mocks.api.mockReturnValueOnce(promise);
  return resolve;
}
/** 同一根节点的会话 key 与页面生产入口一致。 */
async function render(session = "session"): Promise<void> {
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness key={session} session={session} />
      </StrictMode>,
    ),
  );
}
beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockClear();
  mocks.saved = null;
  mocks.api.mockImplementation(async (_route, body) => document(body.path));
  container = window.document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("并行查看按最新意图选中，同一路径共用读取", async () => {
  await render();
  const finish = pending_read();
  let first!: Promise<void>;
  let duplicate!: Promise<void>;
  await act(async () => {
    first = state.open_document("work/a.md");
    duplicate = state.open_document("work/a.md");
  });
  expect(mocks.api).toHaveBeenCalledOnce();
  await act(async () => state.open_document("work/b.md"));
  await act(async () => {
    finish(document("work/a.md"));
    await Promise.all([first, duplicate]);
  });
  expect(state.documents.map((item) => item.path)).toEqual(["work/b.md", "work/a.md"]);
  expect(state.selected).toBe("work/b.md");
});

it("关闭与换会话取消读取，迟到响应不重开标签", async () => {
  await render();
  await act(async () => state.open_document("work/a.md"));
  const finish = pending_read();
  let reading!: Promise<void>;
  await act(async () => {
    reading = state.open_document("work/a.md");
  });
  await act(async () => state.close("work/a.md"));
  await act(async () => {
    finish(document("work/a.md", "已关闭"));
    await reading;
  });
  expect(state.documents).toEqual([]);
  const finish_old = pending_read();
  await act(async () => {
    reading = state.open_document("work/a.md");
  });
  await render("next-session");
  await act(async () => {
    finish_old(document("work/a.md", "旧会话"));
    await reading;
  });
  expect(state.documents).toEqual([]);
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("恢复期间选择对话仍恢复文件和阅读位置，保留用户选中意图", async () => {
  mocks.saved = {
    session_id: "session",
    paths: ["work/a.md"],
    selected: "work/a.md",
    scroll: { "work/a.md": 80 },
  };
  let finish!: (value: AgentDocument) => void;
  mocks.api.mockImplementation(
    () =>
      new Promise<AgentDocument>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await act(async () => state.select(null));
  await act(async () => finish(document("work/a.md")));
  expect(state.documents.map((item) => item.path)).toEqual(["work/a.md"]);
  expect(state.selected).toBeNull();
  expect(state.scroll.current["work/a.md"]).toBe(80);
});
