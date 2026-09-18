import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { ProofreadingPagePreview } from "./proofreading-page-preview";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ api_fetch: vi.fn() }));
vi.mock("@frontend/widgets/app-page-dialog", () => ({
  AppPageDialog: (props: { children: ReactNode }) => <>{props.children}</>,
}));

// happy-dom 通过固定尺寸验证画布挂载、翻页和刷新之间的状态归属。
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
/** 推进挂载帧，使媒体尺寸观测落稳。 */
async function measure_viewports(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(32);
  });
}

it("译稿翻页与失败重试只更新右栏，卸载取消读取并释放预览", async () => {
  vi.mocked(api_fetch).mockReset();
  const signals: AbortSignal[] = [];
  vi.mocked(api_fetch).mockImplementation(async (_path, raw, signal) => {
    const request = raw as { action: string; output_page?: number };
    if (signal) signals.push(signal);
    return {
      count: request.action === "source" ? 3 : 2,
      page: request.output_page ?? 1,
      image: "data:image/png;base64,aQ==",
    };
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProofreadingPagePreview
          target={{ project: "test.lg", file_path: "book.pdf", page: 3 }}
          revision={1}
          on_close={() => undefined}
        />,
      ),
    );
    const button = (key: string) =>
      [...container.querySelectorAll("button")].find(
        (node) => node.textContent === key || node.getAttribute("aria-label") === key,
      )!;
    const source_calls = () =>
      vi
        .mocked(api_fetch)
        .mock.calls.filter(([, request]) => (request as { action: string }).action === "source");
    await measure_viewports();
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(source_calls()).toHaveLength(1);
    const [source, translation] = [
      ...container.querySelectorAll<HTMLElement>(".media-viewport__viewport"),
    ];
    const initial_transform = source!.querySelector<HTMLElement>(".media-viewport__content")!.style
      .transform;
    expect(button("proofreading_page.pages.previous").disabled).toBe(true);
    await act(async () => {
      source!.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
      translation!.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    });
    const source_transform = source!.querySelector<HTMLElement>(".media-viewport__content")!.style
      .transform;
    expect(source_transform).not.toBe(initial_transform);

    vi.mocked(api_fetch).mockRejectedValueOnce(new Error("render failed"));
    await act(async () => button("proofreading_page.pages.next").click());
    expect(container.textContent).toContain("proofreading_page.pages.failed");
    expect(
      container.querySelectorAll('.proofreading-page__preview-pane[aria-disabled="true"]'),
    ).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(button("proofreading_page.pages.next").disabled).toBe(true);
    expect(container.querySelectorAll(".media-viewport__viewport")[1]).toBe(translation);
    await act(async () => button("proofreading_page.pages.retry").click());
    expect(api_fetch).toHaveBeenLastCalledWith(
      "/api/proofreading/page",
      expect.objectContaining({ action: "translation", page: 3, output_page: 2 }),
      expect.any(AbortSignal),
    );
    expect(source_calls()).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    await measure_viewports();
    expect(container.querySelectorAll(".media-viewport__viewport")[0]).toBe(source);
    expect(source!.querySelector<HTMLElement>(".media-viewport__content")!.style.transform).toBe(
      source_transform,
    );
    const next_translation = container.querySelectorAll<HTMLElement>(
      ".media-viewport__viewport",
    )[1]!;
    expect(next_translation).not.toBe(translation);
    expect(
      next_translation.querySelector<HTMLElement>(".media-viewport__content")!.style.transform,
    ).toBe(initial_transform);
    expect(button("proofreading_page.pages.next").disabled).toBe(true);
    expect(button("proofreading_page.pages.previous").disabled).toBe(false);
    await act(async () =>
      next_translation.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true })),
    );
    const previous_transform = next_translation.querySelector<HTMLElement>(
      ".media-viewport__content",
    )!.style.transform;
    await act(async () =>
      root.render(
        <ProofreadingPagePreview
          target={{ project: "test.lg", file_path: "book.pdf", page: 3 }}
          revision={2}
          on_close={() => undefined}
        />,
      ),
    );
    expect(container.querySelectorAll(".media-viewport__viewport")[1]).toBe(next_translation);
    expect(
      next_translation.querySelector<HTMLElement>(".media-viewport__content")!.style.transform,
    ).toBe(previous_transform);
    vi.mocked(api_fetch).mockImplementation(async (_path, raw) => {
      const request = raw as { action: string };
      return {
        kind: "translate",
        reason: "",
        reviewed: false,
        count: 2,
        page: request.action === "translation" ? 1 : 3,
        image: "data:image/png;base64,aQ==",
      };
    });
    await act(async () =>
      root.render(
        <ProofreadingPagePreview
          target={{ project: "test.lg", file_path: "book.pdf", page: 3 }}
          revision={3}
          on_close={() => undefined}
        />,
      ),
    );
    await measure_viewports();
    const calls = vi.mocked(api_fetch).mock.calls.length;
    // 即使上一请求也请求第 2 页，实际页码回退后再次前进仍须发起读取。
    await act(async () => button("proofreading_page.pages.next").click());
    expect(vi.mocked(api_fetch).mock.calls.length).toBe(calls + 1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(api_fetch).toHaveBeenLastCalledWith(
    "/api/proofreading/page",
    expect.objectContaining({ action: "close" }),
  );
});

it("无图像响应只禁用译稿区域，保留原稿画布", async () => {
  vi.mocked(api_fetch).mockReset();
  vi.mocked(api_fetch).mockImplementation(async (_path, raw) =>
    (raw as { action: string }).action === "source"
      ? { image: "data:image/png;base64,aQ==", count: 3, page: 3 }
      : {},
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ProofreadingPagePreview
          target={{ project: "test.lg", file_path: "book.pdf", page: 3 }}
          revision={1}
          on_close={() => undefined}
        />,
      ),
    );
    expect(container.querySelectorAll(".media-viewport__controls")).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    const translation = container.querySelectorAll(
      ".proofreading-page__dialog-content-section",
    )[1]!;
    const pane = translation.querySelector(".proofreading-page__preview-pane")!;
    expect(pane.textContent).toBe("");
    expect(pane.getAttribute("aria-disabled")).toBe("true");
    expect(pane.getAttribute("aria-busy")).toBe("false");
    expect(pane.querySelector("[tabindex]")).toBeNull();
    expect(translation.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
