import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TranslationTransferPage } from "@frontend/pages/translation-transfer-page/page";
import type { RuntimeActivityOwner } from "@shared/runtime-activity";
import { create_text_resolver } from "@shared/i18n";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

const runtime = vi.hoisted(() => ({ owner: null as RuntimeActivityOwner | null }));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_toast: vi.fn(),
  push_error_toast: vi.fn(),
  run_modal_progress_toast: (args: { task: () => Promise<unknown> }) => args.task(),
}));

vi.mock("@frontend/app/desktop/desktop-api", async (import_original) => ({
  ...(await import_original<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: vi.fn(),
}));

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useRuntimeSnapshot: () => ({ revision: 0, owner: runtime.owner }),
}));

const SOURCE_PATH = "E:/projects/source.lg";
const BASE_PATH = "E:/projects/base.lg";
const OUTPUT_PATH = "E:/projects/output.lg";
const t = create_text_resolver("zh-CN"); // 从词典读取文案，测试只锁定交互和结果参数。

describe("TranslationTransferPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  const pick_project = vi.fn();
  const pick_save = vi.fn();

  /** 依次点击迁出与迁入两张卡片。已选择的卡片改显示文件名，剩余的空卡片总在首位。 */
  async function select_projects(source: string, base: string): Promise<void> {
    for (const path of [source, base]) {
      pick_project.mockResolvedValueOnce({ canceled: false, paths: [path] });
      await act(async () =>
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent?.includes(t("project_page.open.drop_title")))!
          .click(),
      );
    }
  }

  /** 生成按钮位于命令栏，文案唯一。 */
  function start_button(): HTMLButtonElement {
    return [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(t("translation_transfer_page.action.start")),
    )!;
  }

  /** 重绘页面以接收运行占用变化。 */
  async function render(): Promise<void> {
    await act(async () => {
      root.render(
        <LocaleProvider locale="zh-CN">
          <TranslationTransferPage is_sidebar_collapsed={false} />
        </LocaleProvider>,
      );
    });
  }

  beforeEach(async () => {
    runtime.owner = null;
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: { pickProjectFilePath: pick_project, pickProjectSavePath: pick_save },
      }),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(api_fetch).mockReset();
    vi.mocked(push_toast).mockReset();
    vi.mocked(push_error_toast).mockReset();
    pick_project.mockReset();
    pick_save.mockReset();
  });

  it("缺少路径、两路径相同或运行占用时禁止生成", async () => {
    expect(start_button().disabled).toBe(true);
    await select_projects(SOURCE_PATH, SOURCE_PATH);
    expect(start_button().disabled).toBe(true);

    const clear_base = container.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${t("app.action.reset")}"]`,
    )[1]!;
    await act(async () => clear_base.click());
    expect(start_button().disabled).toBe(true);
    pick_project.mockResolvedValueOnce({ canceled: false, paths: [BASE_PATH] });
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes(t("project_page.open.drop_title")))!
        .click(),
    );
    expect(start_button().disabled).toBe(false);

    runtime.owner = "batch_translation";
    await render();
    expect(start_button().disabled).toBe(true);
  });

  it("另存为期间拒绝重复提交，取消后恢复生成入口", async () => {
    await select_projects(SOURCE_PATH, BASE_PATH);
    const picker = Promise.withResolvers<{ canceled: boolean; paths: string[] }>();
    pick_save.mockReturnValueOnce(picker.promise);
    await act(async () => {
      start_button().click();
      start_button().click(); // 同一轮事件尚未提交禁用状态。
    });
    expect(pick_save).toHaveBeenCalledOnce();
    expect(start_button().disabled).toBe(true);

    await act(async () => picker.resolve({ canceled: true, paths: [] }));
    expect(api_fetch).not.toHaveBeenCalled();
    expect(start_button().disabled).toBe(false);
  });

  it("生成成功后以所选模式提交并通知结果，失败时通知原因", async () => {
    await select_projects(SOURCE_PATH, BASE_PATH);
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find(
          (button) => button.textContent === t("translation_transfer_page.fields.mode.overwrite"),
        )!
        .click(),
    );
    pick_save.mockResolvedValue({ canceled: false, paths: [OUTPUT_PATH] });
    vi.mocked(api_fetch).mockResolvedValueOnce({ filled: 3, replaced: 1, unmatched: 2 });

    await act(async () => start_button().click());

    expect(api_fetch).toHaveBeenCalledWith("/api/toolbox/translation-transfer/apply", {
      source_path: SOURCE_PATH,
      base_path: BASE_PATH,
      output_path: OUTPUT_PATH,
      mode: "overwrite",
    });
    expect(push_toast).toHaveBeenCalledWith("success", t("app.feedback.operation_success"), {
      description: t("translation_transfer_page.feedback.result", {
        FILLED: "3",
        REPLACED: "1",
        UNMATCHED: "2",
      }),
    });

    const error = new Error("broken project");
    vi.mocked(api_fetch).mockRejectedValueOnce(error);
    await act(async () => start_button().click());
    expect(push_error_toast).toHaveBeenCalledWith(t("app.feedback.operation_failed"), error);
    expect(start_button().disabled).toBe(false); // 保留选择，便于再次生成。
  });
});
