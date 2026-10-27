import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateDialog } from "./update-dialog";

const mocks = vi.hoisted(() => ({ open: vi.fn(async (_url: string) => {}) }));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ open_external_url: mocks.open }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("更新弹窗", () => {
  let container: HTMLDivElement;
  let root: Root;
  const release = {
    latest_version: "1.2.4",
    release_url: "https://github.com/neavo/LinguaGacha/releases/tag/v1.2.4",
    windows_zip_urls: {},
  };

  beforeEach(() => {
    mocks.open.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render_dialog(release_notes: string, onConfirm = vi.fn()): Promise<void> {
    await act(async () =>
      root.render(
        <UpdateDialog
          state={{ phase: "confirming", release: { ...release, release_notes } }}
          onConfirm={onConfirm}
          onClose={() => {}}
        />,
      ),
    );
  }

  it("渲染发行日志并安全打开相对链接，链接回车不提交更新", async () => {
    const onConfirm = vi.fn();
    await render_dialog(
      "# 更新\n\n- **修复** [问题](../../issues/1036)\n- [危险](javascript:alert(1))\n\n<script>alert(1)</script>",
      onConfirm,
    );
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.querySelector('[data-slot="alert-dialog-header"]')).toBeNull();
    expect(dialog.getAttribute("aria-label")).toBe("app.update.action");
    expect(dialog.querySelector("h1")?.textContent).toBe("更新");
    expect(dialog.querySelector("li strong")?.textContent).toBe("修复");
    const link = [...dialog.querySelectorAll("a")].find((a) => a.textContent === "问题")!;
    expect(link.getAttribute("href")).toBe("https://github.com/neavo/LinguaGacha/issues/1036");
    expect([...dialog.querySelectorAll("a")].some((a) => a.textContent === "危险")).toBe(false);
    expect(dialog.querySelector("script")).toBeNull();
    link.focus();
    await act(async () =>
      link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => link.click());
    expect(mocks.open).toHaveBeenCalledWith("https://github.com/neavo/LinguaGacha/issues/1036");
    await render_dialog("", onConfirm);
    await act(async () =>
      (
        document.querySelector('[data-slot="alert-dialog-primary-action"]') as HTMLButtonElement
      ).click(),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("链接中的图片打开外层目标，独立图片打开图片地址", async () => {
    await render_dialog(
      "[![徽章](../../assets/badge.png)](../../issues/1037)\n\n![独立图片](../../assets/image.png)",
    );
    const dialog = document.querySelector('[role="alertdialog"]')!;
    const badge = [...dialog.querySelectorAll("a")].filter((a) => a.textContent === "徽章").at(-1)!;
    await act(async () => badge.click());
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/neavo/LinguaGacha/issues/1037",
    );
    expect(dialog.querySelector("a a")).toBeNull();
    expect(dialog.querySelector("img")).toBeNull();

    const image = [...dialog.querySelectorAll("a")].find((a) => a.textContent === "独立图片")!;
    await act(async () => image.click());
    expect(mocks.open).toHaveBeenLastCalledWith(
      "https://github.com/neavo/LinguaGacha/assets/image.png",
    );
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  it("表格与代码块保留正文，不显示附加工具栏", async () => {
    await render_dialog(
      "| 名称 | 值 |\n| --- | --- |\n| 状态 | 完成 |\n\n```js\nconst value = 1;\n```",
    );
    const details = document.querySelector('[data-slot="alert-dialog-details"]')!;
    expect(details.querySelector("table")?.textContent).toContain("完成");
    expect(details.querySelector("pre")?.textContent).toContain("const value = 1;");
    expect(details.querySelector("button")).toBeNull();
  });
});
