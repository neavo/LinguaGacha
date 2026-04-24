import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BasicSettingsPage } from "@/pages/basic-settings-page/page";

const { basic_settings_state_fixture, push_toast_mock } = vi.hoisted(() => {
  return {
    basic_settings_state_fixture: {
      current: null as ReturnType<typeof create_basic_settings_state_fixture> | null,
    },
    push_toast_mock: vi.fn(),
  };
});

vi.mock("@/i18n", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/app/runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@/pages/basic-settings-page/use-basic-settings-state", () => {
  return {
    useBasicSettingsState: () => basic_settings_state_fixture.current,
  };
});

vi.mock("@/widgets/setting-card-row/setting-card-row", () => {
  return {
    SettingCardRow: (props: { title: string; action: ReactNode }) => (
      <section aria-label={props.title}>{props.action}</section>
    ),
  };
});

vi.mock("@/widgets/segmented-toggle/segmented-toggle", () => {
  return {
    SegmentedToggle: () => <button type="button" />,
  };
});

vi.mock("@/shadcn/select", () => {
  return {
    Select: (props: { children: ReactNode }) => <div>{props.children}</div>,
    SelectContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    SelectGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
    SelectItem: (props: { children: ReactNode; value: string }) => (
      <div data-value={props.value}>{props.children}</div>
    ),
    SelectTrigger: (props: { children: ReactNode }) => (
      <button type="button">{props.children}</button>
    ),
    SelectValue: () => <span />,
  };
});

function create_basic_settings_state_fixture() {
  return {
    snapshot: {
      source_language: "JA",
      target_language: "ZH",
      project_save_mode: "MANUAL",
      project_fixed_path: "",
      output_folder_open_on_finish: false,
      request_timeout: 300,
    },
    pending_state: {
      source_language: false,
      target_language: false,
      project_save_mode: false,
      output_folder_open_on_finish: false,
      request_timeout: false,
    },
    is_refreshing: false,
    is_task_busy: false,
    refresh_snapshot: vi.fn(async () => {}),
    update_source_language: vi.fn(async (_next_language: string) => {}),
    update_target_language: vi.fn(async (_next_language: string) => {}),
    update_project_save_mode: vi.fn(async (_next_mode: "MANUAL" | "FIXED" | "SOURCE") => {}),
    update_output_folder_open_on_finish: vi.fn(async (_next_checked: boolean) => {}),
    update_request_timeout: vi.fn(async (_next_value: number) => {}),
  };
}

function set_input_value(input: HTMLInputElement, value: string): void {
  const value_setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (value_setter === undefined) {
    throw new Error("当前测试环境缺少 input value setter。");
  }

  value_setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function get_current_basic_settings_state(): ReturnType<
  typeof create_basic_settings_state_fixture
> {
  if (basic_settings_state_fixture.current === null) {
    throw new Error("基础设置页面测试状态尚未初始化。");
  }

  return basic_settings_state_fixture.current;
}

describe("BasicSettingsPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    basic_settings_state_fixture.current = create_basic_settings_state_fixture();
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    push_toast_mock.mockReset();
  });

  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<BasicSettingsPage is_sidebar_collapsed={false} />);
    });
  }

  function get_request_timeout_input(): HTMLInputElement {
    const input = container?.querySelector('input[type="number"]');

    if (!(input instanceof HTMLInputElement)) {
      throw new Error("未找到请求超时时间输入框。");
    }

    return input;
  }

  it("输入请求超时时间时只更新本地草稿，失焦后再提交", async () => {
    await mount_page();
    const input = get_request_timeout_input();

    await act(async () => {
      set_input_value(input, "1234");
    });

    expect(get_current_basic_settings_state().update_request_timeout).not.toHaveBeenCalled();

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(get_current_basic_settings_state().update_request_timeout).toHaveBeenCalledTimes(1);
    expect(get_current_basic_settings_state().update_request_timeout).toHaveBeenCalledWith(1234);
  });

  it("提交非法请求超时时间时标记红框并弹 toast", async () => {
    await mount_page();
    const input = get_request_timeout_input();

    await act(async () => {
      set_input_value(input, "");
    });

    expect(input.getAttribute("aria-invalid")).toBe("true");

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(get_current_basic_settings_state().update_request_timeout).not.toHaveBeenCalled();
    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "basic_settings_page.feedback.request_timeout_invalid",
    );
  });
});
