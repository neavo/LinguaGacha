import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useExternalLink } from "./use-external-link";

const mocks = vi.hoisted(() => ({ open: vi.fn(), report: vi.fn() }));
vi.mock("@frontend/app/desktop/desktop-api", () => ({ open_external_url: mocks.open }));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: mocks.report }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

it("合并重复打开，失败后反馈并允许重试", async () => {
  const pending = Promise.withResolvers<void>();
  const error = new Error("offline");
  mocks.open.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined);
  function Link() {
    const open = useExternalLink();
    return <button onClick={() => void open("//example.com")}>打开</button>;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Link />));
    const button = container.querySelector("button")!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith("https://example.com");
    await act(async () => pending.reject(error));
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith("app.feedback.activate_link", error);
    await act(async () => button.click());
    expect(mocks.open).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
