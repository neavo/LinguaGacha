import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExpertSettingsPage } from "@frontend/pages/expert-settings-page/page";

const { expert_settings_state_fixture, push_toast_mock } = vi.hoisted(() => {
  return {
    expert_settings_state_fixture: {
      current: null as ReturnType<typeof create_expert_settings_state_fixture> | null,
    },
    push_toast_mock: vi.fn(),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@frontend/pages/expert-settings-page/use-expert-settings-state", () => {
  return {
    useExpertSettingsState: () => expert_settings_state_fixture.current,
  };
});

vi.mock("@frontend/widgets/setting-card-row/setting-card-row", () => {
  return {
    SettingCardRow: (props: { title: string; action: ReactNode }) => (
      <section aria-label={props.title}>{props.action}</section>
    ),
  };
});

vi.mock("@frontend/widgets/segmented-toggle/segmented-toggle", () => {
  return {
    SegmentedToggle: () => <button type="button" />,
  };
});

/**
 * 构造当前场景的标准初始数据。
 */
function create_expert_settings_state_fixture() {
  return {
    snapshot: {
      preceding_lines_threshold: 0,
      clean_ruby: false,
      deduplication_in_bilingual: false,
      write_translated_name_fields_to_file: false,
      auto_process_prefix_suffix_preserved_text: false,
    },
    pending_state: {
      preceding_lines_threshold: false,
      clean_ruby: false,
      deduplication_in_bilingual: false,
      write_translated_name_fields_to_file: false,
      auto_process_prefix_suffix_preserved_text: false,
    },
    is_task_busy: false,
    refresh_snapshot: vi.fn(async () => {}),
    update_preceding_lines_threshold: vi.fn(async (_next_value: number) => {}),
    update_clean_ruby: vi.fn(async (_next_checked: boolean) => {}),
    update_deduplication_in_bilingual: vi.fn(async (_next_checked: boolean) => {}),
    update_write_translated_name_fields_to_file: vi.fn(async (_next_checked: boolean) => {}),
    update_auto_process_prefix_suffix_preserved_text: vi.fn(async (_next_checked: boolean) => {}),
  };
}

/**
 * 写入当前测试交互值。
 */
function set_input_value(input: HTMLInputElement, value: string): void {
  const value_setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (value_setter === undefined) {
    throw new Error("当前测试环境缺少 input value setter。");
  }

  value_setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * 获取当前测试场景的公开值。
 */
function get_current_expert_settings_state(): ReturnType<
  typeof create_expert_settings_state_fixture
> {
  if (expert_settings_state_fixture.current === null) {
    throw new Error("专家设置页面测试状态尚未初始化。");
  }

  return expert_settings_state_fixture.current;
}

describe("ExpertSettingsPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    expert_settings_state_fixture.current = create_expert_settings_state_fixture();
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

  /**
   * 挂载当前测试组件并等待渲染完成。
   */
  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ExpertSettingsPage is_sidebar_collapsed={false} />);
    });
  }

  /**
   * 读取当前场景需要的稳定数据。
   */
  function get_preceding_lines_threshold_input(): HTMLInputElement {
    const input = container?.querySelector('input[type="number"]');

    if (!(input instanceof HTMLInputElement)) {
      throw new Error("未找到参考上文行数阈值输入框。");
    }

    return input;
  }

  it("不再渲染结果检查规则入口", async () => {
    await mount_page();

    expect(
      container?.textContent?.includes("expert_settings_page.fields.response_check_settings.title"),
    ).toBe(false);
  });

  it("输入参考上文行数阈值时只更新本地草稿，失焦后再提交", async () => {
    await mount_page();
    const input = get_preceding_lines_threshold_input();

    await act(async () => {
      set_input_value(input, "12");
    });

    expect(
      get_current_expert_settings_state().update_preceding_lines_threshold,
    ).not.toHaveBeenCalled();

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      get_current_expert_settings_state().update_preceding_lines_threshold,
    ).toHaveBeenCalledTimes(1);
    expect(
      get_current_expert_settings_state().update_preceding_lines_threshold,
    ).toHaveBeenCalledWith(12);
  });

  it("提交非法参考上文行数阈值时标记红框并弹 toast", async () => {
    await mount_page();
    const input = get_preceding_lines_threshold_input();

    await act(async () => {
      set_input_value(input, "");
    });

    expect(input.getAttribute("aria-invalid")).toBe("true");

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      get_current_expert_settings_state().update_preceding_lines_threshold,
    ).not.toHaveBeenCalled();
    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "expert_settings_page.feedback.preceding_lines_threshold_invalid",
    );
  });

  it("任务运行中锁定专家设置输入", async () => {
    expert_settings_state_fixture.current = {
      ...create_expert_settings_state_fixture(),
      is_task_busy: true,
    };

    await mount_page();
    const input = get_preceding_lines_threshold_input();

    expect(input.disabled).toBe(true);
  });
});
