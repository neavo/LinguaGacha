import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentPreviews } from "./use-agent-previews";
import type { AgentFile } from "@shared/agent-workspace-file";

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
let state: ReturnType<typeof useAgentPreviews>;
/** 直接观察 Hook 的公开状态，异步验证不依赖菜单和 Markdown 渲染。 */
function Harness({ session }: { session: string }) {
  state = useAgentPreviews(session);
  return null;
}
/** 文件名称用于区分恢复结果与用户重新打开的描述。 */
function document(path: string, name = "报告"): AgentFile {
  return { path, name, kind: "file", preview: "markdown" };
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

it("文件描述直接打开标签，重复打开更新内容意图，普通切换保留阅读状态", async () => {
  await render();
  await act(async () => state.open_file("work/a.md#first", document("work/a.md")));
  const first = state.documents[0]!.activation;
  await act(async () => state.open_file("work/b.md", document("work/b.md")));
  await act(async () => state.open_file("work/a.md#second", document("work/a.md", "更新")));
  expect(state.documents.map((file) => file.path)).toEqual(["work/a.md", "work/b.md"]);
  expect(state.documents[0]).toMatchObject({ name: "更新", anchor: "second" });
  expect(state.documents[0]!.activation).toBeGreaterThan(first);
  expect(mocks.api).not.toHaveBeenCalled();
  await act(async () => state.close("work/a.md"));
  expect(state.selected).toBe("work/b.md");
});

it.each(["close", "reset"])("恢复期间 %s 使迟到描述失效", async (action) => {
  mocks.saved = {
    chat_id: "session",
    paths: ["work/a.md", "work/b.md"],
    selected: "work/a.md",
    scroll: {},
  };
  const finish = new Map<string, (file: AgentFile) => void>();
  mocks.api.mockImplementation(
    (_route, body) => new Promise<AgentFile>((resolve) => finish.set(body.path, resolve)),
  );
  await render();
  if (action === "close") {
    await act(async () => state.open_file("work/a.md", document("work/a.md")));
    await act(async () => state.close("work/a.md"));
  } else await render("next-session");
  await act(async () => {
    for (const [path, resolve] of finish) resolve(document(path));
  });
  expect(state.documents.map((file) => file.path)).toEqual(action === "close" ? ["work/b.md"] : []);
  expect(state.selected).toBeNull();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("恢复期间选择对话仍恢复文件和阅读位置，保留用户选中意图", async () => {
  mocks.saved = {
    chat_id: "session",
    paths: ["work/a.md"],
    selected: "work/a.md",
    scroll: { "work/a.md": 80 },
  };
  let finish!: (value: AgentFile) => void;
  mocks.api.mockImplementation(
    () =>
      new Promise<AgentFile>((resolve) => {
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
