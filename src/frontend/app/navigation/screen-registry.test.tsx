import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { custom_prompt_variant_mock, text_replacement_variant_mock } = vi.hoisted(() => {
  return {
    custom_prompt_variant_mock: vi.fn(),
    text_replacement_variant_mock: vi.fn(),
  };
});

vi.mock("@frontend/pages/basic-settings-page/page", () => {
  return { BasicSettingsPage: () => <div data-page="basic-settings" /> };
});

vi.mock("@frontend/pages/custom-prompt-page/page", () => {
  return {
    CustomPromptPage: (props: { variant: string }) => {
      custom_prompt_variant_mock(props.variant);
      return <div data-page="custom-prompt" data-variant={props.variant} />;
    },
  };
});

vi.mock("@frontend/pages/expert-settings-page/page", () => {
  return { ExpertSettingsPage: () => <div data-page="expert-settings" /> };
});

vi.mock("@frontend/pages/glossary-page/page", () => {
  return { GlossaryPage: () => <div data-page="glossary" /> };
});

vi.mock("@frontend/pages/laboratory-page/page", () => {
  return { LaboratoryPage: () => <div data-page="laboratory" /> };
});

vi.mock("@frontend/pages/model-page/page", () => {
  return { ModelPage: () => <div data-page="model" /> };
});

vi.mock("@frontend/pages/proofreading-page/page", () => {
  return { ProofreadingPage: () => <div data-page="proofreading" /> };
});

vi.mock("@frontend/pages/project-page/page", () => {
  return { ProjectPage: () => <div data-page="project" /> };
});

vi.mock("@frontend/pages/text-preserve-page/page", () => {
  return { TextPreservePage: () => <div data-page="text-preserve" /> };
});

vi.mock("@frontend/pages/text-replacement-page/page", () => {
  return {
    TextReplacementPage: (props: { variant: string }) => {
      text_replacement_variant_mock(props.variant);
      return <div data-page="text-replacement" data-variant={props.variant} />;
    },
  };
});

vi.mock("@frontend/pages/toolbox-page/page", () => {
  return { ToolboxPage: () => <div data-page="toolbox" /> };
});

vi.mock("@frontend/pages/ts-conversion-page/page", () => {
  return { TsConversionPage: () => <div data-page="ts-conversion" /> };
});

import { SCREEN_REGISTRY } from "@frontend/app/navigation/screen-registry";

describe("SCREEN_REGISTRY", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    custom_prompt_variant_mock.mockClear();
    text_replacement_variant_mock.mockClear();
  });

  async function render_registered_screen(route_id: keyof typeof SCREEN_REGISTRY): Promise<void> {
    const screen = SCREEN_REGISTRY[route_id];

    if (screen === undefined) {
      throw new Error(`未找到路由：${route_id}`);
    }

    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
      container?.remove();
    }

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      const Component = screen.component;
      root?.render(<Component is_sidebar_collapsed={false} />);
    });
  }

  it("为核心页面提供稳定标题 key", () => {
    expect(SCREEN_REGISTRY["project-home"]?.title_key).toBe("project_page.title");
    expect(SCREEN_REGISTRY.workbench?.title_key).toBe("workbench_page.title");
    expect(SCREEN_REGISTRY.proofreading?.title_key).toBe("proofreading_page.title");
    expect(SCREEN_REGISTRY.glossary?.title_key).toBe("glossary_page.title");
  });

  it("替换与提示词复用页面会写入对应 variant", async () => {
    await render_registered_screen("pre-translation-replacement");
    expect(text_replacement_variant_mock).toHaveBeenCalledWith("pre");

    await render_registered_screen("post-translation-replacement");
    expect(text_replacement_variant_mock).toHaveBeenCalledWith("post");

    await render_registered_screen("translation-prompt");
    expect(custom_prompt_variant_mock).toHaveBeenCalledWith("translation");

    await render_registered_screen("analysis-prompt");
    expect(custom_prompt_variant_mock).toHaveBeenCalledWith("analysis");
  });
});
