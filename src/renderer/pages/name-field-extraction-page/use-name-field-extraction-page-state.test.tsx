import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNameFieldExtractionPageState } from "@/pages/name-field-extraction-page/use-name-field-extraction-page-state";

const { api_fetch_mock, push_toast_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
  };
});

let runtime_state = {
  project: {
    path: "E:/demo/sample.lg",
    loaded: true,
  },
  files: {},
  items: {
    "1": {
      item_id: 1,
      src: "Alice says hello",
      name_src: "Alice",
    },
    "2": {
      item_id: 2,
      src: "Bob says hello",
      name_src: "Bob",
    },
  },
  quality: {
    glossary: {
      entries: [
        {
          src: "Alice",
          dst: "爱丽丝",
          info: "",
          case_sensitive: false,
        },
      ],
      enabled: true,
      mode: "custom",
      revision: 4,
    },
    pre_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
    post_replacement: { entries: [], enabled: false, mode: "off", revision: 0 },
    text_preserve: { entries: [], enabled: false, mode: "off", revision: 0 },
  },
};

const project_store_listeners = new Set<() => void>();

function notify_project_store(): void {
  for (const listener of project_store_listeners) {
    listener();
  }
}

const project_store = {
  subscribe: (listener: () => void) => {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState: () => runtime_state,
};

vi.mock("@/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: runtime_state.project,
      project_store,
      commit_local_project_change: (input: {
        operations: Array<{
          sections?: {
            quality?: {
              data?: typeof runtime_state.quality;
            };
          };
        }>;
      }) => {
        const previous_quality = runtime_state.quality;
        const quality_patch = input.operations.find(
          (operation) => operation.sections?.quality?.data !== undefined,
        );
        const next_quality = quality_patch?.sections?.quality?.data;
        if (next_quality !== undefined) {
          runtime_state = {
            ...runtime_state,
            quality: next_quality,
          };
          notify_project_store();
        }

        return {
          rollback: () => {
            runtime_state = {
              ...runtime_state,
              quality: previous_quality,
            };
            notify_project_store();
          },
        };
      },
      refresh_project_runtime: vi.fn(),
      align_project_runtime_ack: vi.fn(),
      task_snapshot: {
        busy: false,
        status: "idle",
      },
    }),
  };
});

vi.mock("@/app/ui-runtime/toast/use-desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

function Probe(props: {
  on_ready: (state: ReturnType<typeof useNameFieldExtractionPageState>) => void;
}): JSX.Element | null {
  const state = useNameFieldExtractionPageState();

  useEffect(() => {
    props.on_ready(state);
  }, [props, state]);

  return null;
}

describe("useNameFieldExtractionPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useNameFieldExtractionPageState> | null = null;

  beforeEach(() => {
    project_store_listeners.clear();
    api_fetch_mock.mockReset();
    push_toast_mock.mockReset();
    runtime_state = {
      ...runtime_state,
      quality: {
        ...runtime_state.quality,
        glossary: {
          entries: [
            {
              src: "Alice",
              dst: "爱丽丝",
              info: "",
              case_sensitive: false,
            },
          ],
          enabled: true,
          mode: "custom",
          revision: 4,
        },
      },
    };
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
    latest_state = null;
  });

  async function mount_probe(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Probe
          on_ready={(state) => {
            latest_state = state;
          }}
        />,
      );
    });
  }

  it("导入姓名术语遇到重复时先确认，跳过只保存非重复姓名", async () => {
    await mount_probe();
    api_fetch_mock.mockResolvedValueOnce({
      accepted: true,
      projectRevision: 2,
      sectionRevisions: {
        quality: 5,
      },
    });

    await act(async () => {
      await latest_state?.extract_rows();
    });
    await act(async () => {
      await latest_state?.import_to_glossary();
    });

    expect(latest_state?.import_confirm_state.open).toBe(true);
    expect(latest_state?.import_confirm_state.duplicate_count).toBe(1);
    expect(api_fetch_mock).not.toHaveBeenCalled();

    await act(async () => {
      await latest_state?.import_duplicate_skip();
    });

    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/rules/save-entries", {
      rule_type: "glossary",
      expected_revision: 4,
      entries: [
        {
          src: "Alice",
          dst: "爱丽丝",
          info: "",
          case_sensitive: false,
        },
        {
          src: "Bob",
          dst: "",
          info: "",
          case_sensitive: false,
        },
      ],
    });
  });
});
