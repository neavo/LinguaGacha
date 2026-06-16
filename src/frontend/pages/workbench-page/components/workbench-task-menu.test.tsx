import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisTaskMenu } from "@frontend/pages/workbench-page/components/analysis-task-menu";
import { TranslationTaskMenu } from "@frontend/pages/workbench-page/components/translation-task-menu";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/widgets/app-dropdown-menu", () => {
  return {
    AppDropdownMenu: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
    AppDropdownMenuContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuGroup: (props: { children: ReactNode }) => <div>{props.children}</div>,
    AppDropdownMenuSeparator: () => <hr />,
    AppDropdownMenuItem: (props: {
      children: ReactNode;
      disabled?: boolean;
      onSelect?: () => void;
    }) => (
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => {
          props.onSelect?.();
        }}
      >
        {props.children}
      </button>
    ),
  };
});

vi.mock("@frontend/widgets/segmented-progress/segmented-progress", () => {
  return {
    SegmentedProgress: () => <div data-testid="segmented-progress" />,
  };
});

vi.mock("@frontend/shadcn/tooltip", () => {
  return {
    Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
    TooltipContent: (props: { children: ReactNode }) => <div role="tooltip">{props.children}</div>,
  };
});

const workbench_stats = {
  total_items: 4,
  completed_count: 1,
  failed_count: 0,
  pending_count: 3,
  skipped_count: 0,
  completion_percent: 25,
};

const translation_task_metrics = {
  active: false,
  stopping: false,
  processed_count: 0,
  failed_count: 0,
  elapsed_seconds: 0,
  remaining_seconds: 0,
  average_output_speed: 0,
  input_tokens: 0,
  output_tokens: 0,
  request_in_flight_count: 0,
  completion_percent: 0,
};

const analysis_task_metrics = {
  ...translation_task_metrics,
  candidate_count: 2,
};

describe("工作台任务菜单", () => {
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
  });

  it("任务菜单触发按钮展示说明提示", () => {
    const html = renderToStaticMarkup(
      <>
        <TranslationTaskMenu
          translation_task_metrics={translation_task_metrics}
          workbench_stats={workbench_stats}
          disabled={false}
          busy={false}
          active_task_action_kind={null}
          on_start_or_continue={async () => {}}
          on_request_confirmation={() => {}}
        />
        <AnalysisTaskMenu
          analysis_task_metrics={analysis_task_metrics}
          workbench_stats={workbench_stats}
          disabled={false}
          busy={false}
          importing={false}
          active_task_action_kind={null}
          on_start_or_continue={async () => {}}
          on_request_confirmation={() => {}}
        />
      </>,
    );

    expect(html).toContain("workbench_page.translation_task.menu.tooltip");
    expect(html).toContain("workbench_page.analysis_task.menu.tooltip");
  });

  it("导入候选术语先请求分析任务确认", async () => {
    const on_request_confirmation = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AnalysisTaskMenu
          analysis_task_metrics={analysis_task_metrics}
          workbench_stats={workbench_stats}
          disabled={false}
          busy={false}
          importing={false}
          active_task_action_kind={null}
          on_start_or_continue={async () => {}}
          on_request_confirmation={on_request_confirmation}
        />,
      );
    });

    const import_button = [...container.querySelectorAll("button")].find((button) => {
      return button.textContent?.includes("workbench_page.action.import_analysis_glossary");
    });
    expect(import_button).not.toBeUndefined();

    await act(async () => {
      import_button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(on_request_confirmation).toHaveBeenCalledWith("import-glossary");
  });
});
