import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumberSettingRow } from "./number-setting-row";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({ push_error_toast: notify }));

describe("NumberSettingRow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: ComponentProps<typeof NumberSettingRow>;
  const save = vi.fn(async (_value: number) => {});

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      title: "数量",
      description: "说明",
      invalid_message: "无效数量",
      value: 3,
      min: 0,
      max: 10,
      integer: true,
      pending: false,
      on_commit: save,
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    save.mockReset();
    notify.mockReset();
  });

  /** 重渲染模拟设置快照与保存状态变化。 */
  async function render(): Promise<HTMLInputElement> {
    await act(async () => root.render(<NumberSettingRow {...props} />));
    return container.querySelector("input")!;
  }

  /** 原生 setter 触发 React 受控输入更新。 */
  async function edit(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("无效草稿保留并提示，合法整数失焦后提交", async () => {
    const input = await render();
    for (const value of ["", "-1", "1.5", String(props.max + 1)]) {
      await edit(input, value);
      await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      expect(input.value).toBe(value);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(save).not.toHaveBeenCalled();
    }
    expect(notify).toHaveBeenLastCalledWith("app.feedback.save_failed", props.invalid_message);
    await edit(input, "7");
    expect(save).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(save).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("非整数设置允许小数", async () => {
    props.integer = false;
    const input = await render();
    await edit(input, "1.5");
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(save).toHaveBeenCalledExactlyOnceWith(1.5);
  });

  it("Enter 与失焦只提交一次，保存结束后采用权威值", async () => {
    let release!: () => void;
    save.mockImplementation(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const input = await render();
    await edit(input, "7");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    props.pending = true;
    await render();
    expect(input.disabled).toBe(true);
    await act(async () => release());
    props.pending = false;
    props.value = 3; // 保存失败时，编辑器恢复提交前的权威值。
    await render();
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(save).toHaveBeenCalledExactlyOnceWith(7);
    expect(input.value).toBe("3");
  });

  it("同值免提交，正在编辑的草稿保留外部更新", async () => {
    const input = await render();
    await edit(input, "3");
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(save).not.toHaveBeenCalled();
    await edit(input, "7");
    props.value = 5;
    await render();
    expect(input.value).toBe("7");
    await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(save).toHaveBeenCalledExactlyOnceWith(7);
    expect(input.value).toBe("5");
  });

  it("仅聚焦后收到新快照，失焦时采用新值且不回写旧值", async () => {
    const input = await render();
    await act(async () => input.focus());
    props.value = 5;
    await render();
    expect(input.value).toBe("3");
    await act(async () => input.blur());
    expect(input.value).toBe("5");
    expect(save).not.toHaveBeenCalled();
  });
});
