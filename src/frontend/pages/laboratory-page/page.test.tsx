import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaboratoryPage } from "@frontend/pages/laboratory-page/page";

const { laboratory_state_fixture } = vi.hoisted(() => ({
  laboratory_state_fixture: {
    current: null as ReturnType<typeof create_laboratory_state_fixture> | null,
  },
}));

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => key,
  }),
}));

vi.mock("@frontend/pages/laboratory-page/use-laboratory-page-state", () => ({
  useLaboratoryPageState: () => laboratory_state_fixture.current,
}));

vi.mock("@frontend/widgets/setting-help-button", () => ({
  SettingHelpButton: () => null,
}));

vi.mock("@frontend/widgets/boolean-segmented-toggle", () => ({
  BooleanSegmentedToggle: (props: {
    aria_label: string;
    value: boolean;
    disabled: boolean;
    on_value_change: (value: boolean) => void;
  }) => (
    <button
      type="button"
      aria-label={props.aria_label}
      disabled={props.disabled}
      onClick={() => props.on_value_change(!props.value)}
    />
  ),
}));

/** 提供页面可编辑值和运行状态，保存命令由断言观察。 */
function create_laboratory_state_fixture() {
  return {
    snapshot: {
      prompt_enhancement_enable: true,
      agent_batch_translation_thinking_adaptive_enable: true,
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    },
    pending_state: {
      prompt_enhancement_enable: false,
      agent_batch_translation_thinking_adaptive_enable: false,
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    },
    runtime_locked: false,
    update_setting: vi.fn(async (_field: string, _next_value: boolean) => {}),
  };
}

describe("LaboratoryPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    laboratory_state_fixture.current = create_laboratory_state_fixture();
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    laboratory_state_fixture.current = null;
  });

  /** 挂载页面以验证用户点击和禁用态。 */
  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<LaboratoryPage is_sidebar_collapsed={false} />);
    });
  }

  it("点击思考自适应开关提交新值", async () => {
    const field = "agent_batch_translation_thinking_adaptive_enable";
    await mount_page();
    const toggle = container?.querySelector<HTMLButtonElement>(
      `button[aria-label="laboratory_page.fields.${field}.title"]`,
    );
    await act(async () => {
      toggle?.click();
    });
    expect(laboratory_state_fixture.current?.update_setting).toHaveBeenCalledWith(field, false);
  });

  it("运行时占用只禁用会同步工程的开关", async () => {
    laboratory_state_fixture.current = {
      ...create_laboratory_state_fixture(),
      runtime_locked: true,
    };
    await mount_page();

    for (const field of [
      "prompt_enhancement_enable",
      "agent_batch_translation_thinking_adaptive_enable",
    ]) {
      const toggle = container?.querySelector<HTMLButtonElement>(
        `button[aria-label="laboratory_page.fields.${field}.title"]`,
      );
      expect(toggle?.disabled).toBe(false);
    }
    expect(
      container?.querySelector<HTMLButtonElement>(
        'button[aria-label="laboratory_page.fields.mtool_optimizer_enable.title"]',
      )?.disabled,
    ).toBe(true);
  });
});
