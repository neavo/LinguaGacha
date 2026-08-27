import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaboratoryPage } from "@frontend/pages/laboratory-page/page";

const { laboratory_state_fixture } = vi.hoisted(() => ({
  laboratory_state_fixture: {
    current: null as ReturnType<typeof create_laboratory_state_fixture> | null,
  },
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
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
      data-value={String(props.value)}
      disabled={props.disabled}
      onClick={() => props.on_value_change(!props.value)}
    />
  ),
}));

function create_laboratory_state_fixture() {
  return {
    snapshot: {
      prompt_enhancement_enable: true,
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    },
    pending_state: {
      prompt_enhancement_enable: false,
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: false,
    },
    runtime_locked: false,
    update_prompt_enhancement_enable: vi.fn(async (_next_value: boolean) => {}),
    update_mtool_optimizer_enable: vi.fn(async (_next_value: boolean) => {}),
    update_skip_duplicate_source_text_enable: vi.fn(async (_next_value: boolean) => {}),
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

  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<LaboratoryPage is_sidebar_collapsed={false} />);
    });
  }

  it("展示提示词增强开关并按设置值提交", async () => {
    await mount_page();
    const toggle = container?.querySelector(
      'button[aria-label="laboratory_page.fields.prompt_enhancement_enable.title"]',
    );
    await act(async () => {
      (toggle as HTMLButtonElement | undefined)?.click();
    });
    expect(laboratory_state_fixture.current?.update_prompt_enhancement_enable).toHaveBeenCalledWith(
      false,
    );
  });

  it("运行时占用时禁用提示词增强开关", async () => {
    laboratory_state_fixture.current = {
      ...create_laboratory_state_fixture(),
      runtime_locked: true,
    };
    await mount_page();

    const toggle = container?.querySelector(
      'button[aria-label="laboratory_page.fields.prompt_enhancement_enable.title"]',
    );
    expect((toggle as HTMLButtonElement | null)?.disabled).toBe(true);
  });
});
