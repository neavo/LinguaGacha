import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogDetail } from "@frontend/app/desktop/desktop-api";
import { LogDetailView } from "@frontend/pages/log-window-page/log-detail-view";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@frontend/widgets/app-editor/app-editor", () => ({
  AppEditor: (props: { value: string; aria_label: string }): ReactNode => (
    <pre aria-label={props.aria_label} data-log-editor="true">
      {props.value}
    </pre>
  ),
}));

/** 构造最小有效详情，单个用例只覆盖关心的判别分支。 */
function build_detail(overrides: Partial<LogDetail>): LogDetail {
  return {
    id: "log-1",
    sequence: 1,
    created_at: "2026-04-26T00:00:00.000Z",
    level: "info",
    source: "test",
    content: { kind: "text", text: "普通日志" },
    ...overrides,
  };
}

describe("LogDetailView", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  /** 挂载详情并等待 React 提交，DOM 断言只观察用户可见结果。 */
  async function render_detail(detail: LogDetail): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<LogDetailView detail={detail} />));
  }

  it("普通文本继续通过只读编辑器显示并拼接错误", async () => {
    await render_detail(
      build_detail({
        content: { kind: "text", text: "任务失败" },
        error: { message: "供应商失败", stack: "Error: 供应商失败" },
      }),
    );

    expect(container?.querySelector('[data-log-editor="true"]')?.textContent).toBe(
      "任务失败\n供应商失败\nError: 供应商失败",
    );
  });

  it("翻译结果按顺序展示对照、姓名胶囊和纵向过程段落", async () => {
    await render_detail(
      build_detail({
        level: "error",
        content: {
          kind: "translation_result",
          summary: ["任务失败"],
          sections: [{ title: "思考过程：", text: "过程正文" }],
          pairs: [
            { src: "こんにちは", dst: "你好", actor_src: "虎鉄", actor_dst: "虎铁" },
            { src: "地の文", dst: "旁白", actor_src: null, actor_dst: null },
          ],
        },
        error: { message: "请求失败", stack: "Error: 请求失败" },
      }),
    );

    expect(container?.querySelectorAll(".log-detail-view__translation-pair")).toHaveLength(2);
    expect(container?.textContent?.indexOf("こんにちは")).toBeLessThan(
      container?.textContent?.indexOf("地の文") ?? 0,
    );
    const name_badges = container?.querySelectorAll(".log-detail-view__name-badge");
    expect(name_badges).toHaveLength(2);
    expect(name_badges?.[0]?.getAttribute("title")).toBe("虎鉄");
    expect(name_badges?.[0]?.parentElement?.textContent).toBe("虎鉄こんにちは");
    expect(container?.textContent).toContain("log_window_page.detail.content.error");
    expect(container?.textContent).toContain("请求失败");
    expect(container?.querySelector(".log-detail-view__process")?.textContent).toContain(
      "过程正文",
    );
  });

  it("分析结果展示术语与备注并把输入放入过程详情", async () => {
    await render_detail(
      build_detail({
        content: {
          kind: "analysis_result",
          summary: ["任务完成"],
          sections: [],
          src_title: "分析输入：",
          srcs: ["Alice 登场"],
          result_title: "分析结果：",
          empty_result_text: "没有术语",
          terms: [{ src: "Alice", dst: "爱丽丝", info: "女性人名" }],
        },
      }),
    );

    expect(container?.textContent).toContain("Alice");
    expect(container?.textContent).toContain("爱丽丝");
    expect(container?.textContent).toContain("女性人名");
    expect(container?.querySelector(".log-detail-view__process")?.textContent).toContain(
      "Alice 登场",
    );
  });

  it("分析空结果显示任务提供的空文案", async () => {
    await render_detail(
      build_detail({
        content: {
          kind: "analysis_result",
          summary: [],
          sections: [],
          src_title: "分析输入：",
          srcs: [],
          result_title: "分析结果：",
          empty_result_text: "没有术语",
          terms: [],
        },
      }),
    );

    expect(container?.querySelector(".log-detail-view__empty-result")?.textContent).toBe(
      "没有术语",
    );
    expect(container?.querySelector(".log-detail-view__process")).toBeNull();
  });
});
