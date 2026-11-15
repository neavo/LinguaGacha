import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@frontend/shadcn/tooltip";

const api_blob_mock = vi.hoisted(() => vi.fn());
const push_error_toast_mock = vi.hoisted(() => vi.fn());

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_blob: api_blob_mock,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_error_toast_mock,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { AgentToolImage } from "./agent-tool-image";

describe("AgentToolImage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let next_blob_id: number;

  beforeEach(() => {
    next_blob_id = 0;
    api_blob_mock.mockReset();
    push_error_toast_mock.mockReset();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:tool-image-${++next_blob_id}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(800);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  /** 与详情图片标签一致，以序号切换挂载身份。 */
  async function render_image(index: number): Promise<void> {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <AgentToolImage
            key={index}
            chat_id="chat:1"
            entry_id="tool:1"
            index={index}
            label="图片 1"
          />
        </TooltipProvider>,
      );
    });
  }

  it("按序号读取图片，换图时释放旧 Blob URL", async () => {
    api_blob_mock.mockResolvedValue(new Blob(["png"], { type: "image/png" }));

    await render_image(0);

    expect(api_blob_mock).toHaveBeenCalledTimes(1);
    expect(api_blob_mock.mock.calls[0]?.[0]).toBe(
      "/api/agent/tool-image?chatId=chat%3A1&entryId=tool%3A1&index=0",
    );
    expect(container.querySelector('img[src="blob:tool-image-1"]')).not.toBeNull();

    await render_image(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tool-image-1");
  });

  it("切换图片取消旧请求，迟到成功或失败结果不得覆盖当前画布或弹窗", async () => {
    const first = Promise.withResolvers<Blob>();
    const second = Promise.withResolvers<Blob>();
    api_blob_mock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await render_image(0);
    const first_signal = api_blob_mock.mock.calls[0]?.[1] as AbortSignal;
    expect(first_signal.aborted).toBe(false);

    await render_image(1);
    expect(first_signal.aborted).toBe(true);

    await act(async () => second.resolve(new Blob(["second"], { type: "image/png" })));
    expect(container.querySelector('img[src="blob:tool-image-1"]')).not.toBeNull();

    // 即使旧请求滞后拒绝或返回，也不得误报 toast、不得替换当前图像。
    await act(async () => first.reject(new Error("late failure")));
    expect(push_error_toast_mock).not.toHaveBeenCalled();
    expect(container.querySelector('img[src="blob:tool-image-1"]')).not.toBeNull();
  });

  it("HTTP 读取失败提示一次错误并在内容区显示回退，切换其他图片可恢复", async () => {
    const network_error = new Error("fetch failed");
    api_blob_mock
      .mockRejectedValueOnce(network_error)
      .mockResolvedValueOnce(new Blob(["ok"], { type: "image/png" }));

    await render_image(0);

    expect(push_error_toast_mock).toHaveBeenCalledTimes(1);
    expect(push_error_toast_mock).toHaveBeenCalledWith("app.feedback.read_failed", network_error);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "app.feedback.content_unavailable",
    );

    await render_image(1);

    expect(container.querySelector('img[src="blob:tool-image-1"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("浏览器图片解码失败触发错误反馈与内容区回退，不留空白画布", async () => {
    api_blob_mock.mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }));

    await render_image(0);

    const image = container.querySelector<HTMLImageElement>("img");
    expect(image).not.toBeNull();
    await act(async () => {
      image!.dispatchEvent(new Event("error"));
    });

    expect(push_error_toast_mock).toHaveBeenCalledTimes(1);
    expect(push_error_toast_mock).toHaveBeenCalledWith(
      "app.feedback.read_failed",
      "app.feedback.content_unavailable",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "app.feedback.content_unavailable",
    );
  });
});
