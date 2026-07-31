import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import {
  CUSTOM_PROMPT_AUTOSAVE_DELAY_MS,
  useCustomPromptEditorState,
} from "@frontend/pages/custom-prompt-page/use-custom-prompt-editor-state";

const { api_fetch_mock, push_toast_mock, translate } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
    push_toast_mock: vi.fn(),
    translate: (key: string, params?: Record<string, string>) => {
      return params?.TITLE === undefined ? key : `${key}:${params.TITLE}`;
    },
  };
});

type RuntimeFixture = {
  project_snapshot: {
    path: string;
    loaded: boolean;
  };
  settings_snapshot: {
    app_language: string;
  };
  commit_project_write: ReturnType<typeof vi.fn>;
  runtime_snapshot: { revision: number; owner: "task" | "agent" | null };
};

type SaveHandler = (body: Record<string, unknown>, save_index: number) => Promise<void> | void;

let runtime_fixture: RuntimeFixture;
let latest_state: ReturnType<typeof useCustomPromptEditorState> | null = null;
let query_text = "项目提示词";
let query_enabled = false;
let query_revision = 3;
let query_handler: (() => Promise<Record<string, unknown>>) | null = null;
let save_handler: SaveHandler | null = null;
let save_index = 0;
let save_in_flight = 0;
let max_save_in_flight = 0;

vi.mock("@frontend/app/desktop/desktop-api", async (import_original) => {
  const actual = await import_original<typeof import("@frontend/app/desktop/desktop-api")>();
  return {
    ...actual,
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => runtime_fixture,
    useRuntimeSnapshot: () => runtime_fixture.runtime_snapshot,
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => {
  return {
    useDesktopToast: () => ({
      push_toast: push_toast_mock,
    }),
  };
});

vi.mock("@frontend/app/locale/locale-provider", () => {
  return {
    useI18n: () => ({
      t: translate,
    }),
  };
});

function create_prompt_change(prompts_revision: number): Record<string, unknown> {
  return {
    source: "quality_prompt_save",
    projectPath: runtime_fixture.project_snapshot.path,
    projectRevision: prompts_revision,
    updatedSections: ["prompts"],
    operations: [],
    sectionRevisions: {
      prompts: prompts_revision,
    },
  };
}

function create_runtime_fixture(): RuntimeFixture {
  return {
    project_snapshot: {
      path: "E:/demo/project.lg",
      loaded: true,
    },
    settings_snapshot: {
      app_language: "ZH",
    },
    commit_project_write: vi.fn(
      async (request: {
        run: () => Promise<Record<string, unknown>>;
      }): Promise<Record<string, unknown>> => {
        const payload = await request.run();
        const prompts_revision = Number(payload["prompts_revision"]);
        return {
          payload,
          write_result: {
            accepted: true,
            changes: [create_prompt_change(prompts_revision)],
          },
        };
      },
    ),
    runtime_snapshot: { revision: 0, owner: null },
  };
}

function create_query_payload(): Record<string, unknown> {
  return {
    prompt: {
      text: query_text,
      enabled: query_enabled,
    },
    sectionRevisions: {
      prompts: query_revision,
    },
  };
}

function Probe(): JSX.Element | null {
  const state = useCustomPromptEditorState("translation");

  useEffect(() => {
    latest_state = state;
  }, [state]);

  return null;
}

describe("useCustomPromptEditorState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    runtime_fixture = create_runtime_fixture();
    latest_state = null;
    query_text = "项目提示词";
    query_enabled = false;
    query_revision = 3;
    query_handler = null;
    save_handler = null;
    save_index = 0;
    save_in_flight = 0;
    max_save_in_flight = 0;
    push_toast_mock.mockReset();
    api_fetch_mock.mockReset();
    api_fetch_mock.mockImplementation(async (path: string, body: Record<string, unknown> = {}) => {
      if (path === "/api/quality/prompts/template") {
        return {
          template: {
            default_text: "默认提示词",
            prefix_text: "前缀",
            suffix_text: "后缀",
          },
        };
      }
      if (path === "/api/quality/prompts/view") {
        return query_handler === null ? create_query_payload() : await query_handler();
      }
      if (path === "/api/quality/prompts/save") {
        save_index += 1;
        save_in_flight += 1;
        max_save_in_flight = Math.max(max_save_in_flight, save_in_flight);
        try {
          await save_handler?.(body, save_index);
        } finally {
          save_in_flight -= 1;
        }
        const expected_revisions = body["expected_section_revisions"] as
          | Record<string, unknown>
          | undefined;
        return {
          prompts_revision: Number(expected_revisions?.["prompts"] ?? 0) + 1,
        };
      }
      throw new Error(`未处理的测试请求：${path}`);
    });
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
    vi.useRealTimers();
  });

  async function render_probe(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => {
      root?.render(<Probe />);
    });
    await flush_async_updates();
  }

  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function get_save_payloads(): Record<string, unknown>[] {
    return api_fetch_mock.mock.calls
      .filter(([path]) => path === "/api/quality/prompts/save")
      .map(([, body]) => body as Record<string, unknown>);
  }

  it("默认模板不是脏草稿，连续编辑只在一秒后保存最终 trim 值", async () => {
    query_text = "";
    await render_probe();

    expect(latest_state?.prompt_text).toBe("默认提示词");
    await act(async () => {
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
    });
    expect(get_save_payloads()).toHaveLength(0);

    await act(async () => {
      latest_state?.update_prompt_text("第一次");
      latest_state?.update_prompt_text("  最终提示词  ");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS - 1);
    });
    expect(get_save_payloads()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        expected_section_revisions: {
          prompts: 3,
        },
        text: "最终提示词",
        enabled: false,
      }),
    ]);
    expect(push_toast_mock).not.toHaveBeenCalledWith("success", expect.anything());
  });

  it("保存期间继续编辑时保持单飞并在旧请求后提交最新草稿", async () => {
    let release_first_save: (() => void) | null = null;
    const first_save = new Promise<void>((resolve) => {
      release_first_save = resolve;
    });
    save_handler = async (_body, current_save_index) => {
      if (current_save_index === 1) {
        await first_save;
      }
    };
    await render_probe();

    await act(async () => {
      latest_state?.update_prompt_text("第一版");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
    });
    expect(get_save_payloads()).toHaveLength(1);

    await act(async () => {
      latest_state?.update_prompt_text("第二版");
      release_first_save?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(max_save_in_flight).toBe(1);
    expect(get_save_payloads()).toEqual([
      expect.objectContaining({ text: "第一版" }),
      expect.objectContaining({
        expected_section_revisions: {
          prompts: 4,
        },
        text: "第二版",
      }),
    ]);
    expect(latest_state?.prompt_text).toBe("第二版");
  });

  it("revision 冲突时刷新 query revision 且只重试一次", async () => {
    let query_count = 0;
    query_handler = async () => {
      query_count += 1;
      if (query_count > 1) {
        query_revision = 8;
      }
      return create_query_payload();
    };
    save_handler = (_body, current_save_index) => {
      if (current_save_index === 1) {
        throw new DesktopApiError({
          message: "revision conflict",
          code: "data.revision_conflict",
          status: 409,
        });
      }
    };
    await render_probe();

    await act(async () => {
      latest_state?.update_prompt_text("冲突后的本地草稿");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        expected_section_revisions: {
          prompts: 3,
        },
      }),
      expect.objectContaining({
        expected_section_revisions: {
          prompts: 8,
        },
      }),
    ]);
    expect(query_count).toBe(2);
    expect(push_toast_mock).not.toHaveBeenCalledWith("error", expect.anything());
  });

  it("普通失败不推进基线，下一次编辑使用原 revision 重试", async () => {
    save_handler = (_body, current_save_index) => {
      if (current_save_index === 1) {
        throw new Error("保存失败");
      }
    };
    await render_probe();

    await act(async () => {
      latest_state?.update_prompt_text("失败版本");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(push_toast_mock).toHaveBeenCalledWith(
      "error",
      "custom_prompt_page.feedback.save_failed",
    );

    await act(async () => {
      latest_state?.update_prompt_text("重试版本");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        expected_section_revisions: {
          prompts: 3,
        },
        text: "失败版本",
      }),
      expect.objectContaining({
        expected_section_revisions: {
          prompts: 3,
        },
        text: "重试版本",
      }),
    ]);
  });

  it("开关立即收束最新草稿，失败时不会在后续编辑中偷偷启用", async () => {
    save_handler = (_body, current_save_index) => {
      if (current_save_index === 1) {
        throw new Error("启用失败");
      }
    };
    await render_probe();

    await act(async () => {
      latest_state?.update_prompt_text("待保存草稿");
    });
    await act(async () => {
      await latest_state?.update_enabled(true);
    });
    expect(latest_state?.enabled).toBe(false);

    await act(async () => {
      latest_state?.update_prompt_text("继续编辑");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        text: "待保存草稿",
        enabled: true,
      }),
      expect.objectContaining({
        text: "继续编辑",
        enabled: false,
      }),
    ]);
  });

  it("Agent 锁定会暂停防抖，解除锁定后保存仍然脏的草稿", async () => {
    await render_probe();
    await act(async () => {
      latest_state?.update_prompt_text("锁定前草稿");
    });

    runtime_fixture.runtime_snapshot = { revision: 1, owner: "agent" };
    await render_probe();
    await act(async () => {
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
    });
    expect(get_save_payloads()).toHaveLength(0);

    runtime_fixture.runtime_snapshot = { revision: 2, owner: null };
    await render_probe();
    await act(async () => {
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        text: "锁定前草稿",
      }),
    ]);
  });

  it("Agent 锁定时只允许在途写入结束，解除后再提交后续草稿", async () => {
    let release_first_save: (() => void) | null = null;
    const first_save = new Promise<void>((resolve) => {
      release_first_save = resolve;
    });
    save_handler = async (_body, current_save_index) => {
      if (current_save_index === 1) {
        await first_save;
      }
    };
    await render_probe();

    await act(async () => {
      latest_state?.update_prompt_text("在途版本");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
    });
    await act(async () => {
      latest_state?.update_prompt_text("锁定后待保存版本");
    });

    runtime_fixture.runtime_snapshot = { revision: 1, owner: "agent" };
    await render_probe();
    await act(async () => {
      release_first_save?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(get_save_payloads()).toEqual([expect.objectContaining({ text: "在途版本" })]);

    runtime_fixture.runtime_snapshot = { revision: 2, owner: null };
    await render_probe();
    await act(async () => {
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(get_save_payloads()).toEqual([
      expect.objectContaining({ text: "在途版本" }),
      expect.objectContaining({ text: "锁定后待保存版本" }),
    ]);
  });

  it("页面卸载时立即提交尚未到期的防抖草稿", async () => {
    await render_probe();
    await act(async () => {
      latest_state?.update_prompt_text("离页前草稿");
    });

    await act(async () => {
      root?.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    root = null;

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        text: "离页前草稿",
      }),
    ]);
  });

  it("项目切换后忽略旧 query 的迟到结果", async () => {
    let resolve_old_query: ((payload: Record<string, unknown>) => void) | null = null;
    const old_query = new Promise<Record<string, unknown>>((resolve) => {
      resolve_old_query = resolve;
    });
    let query_count = 0;
    query_handler = async () => {
      query_count += 1;
      if (query_count === 1) {
        return await old_query;
      }
      return {
        prompt: {
          text: "新项目提示词",
          enabled: true,
        },
        sectionRevisions: {
          prompts: 10,
        },
      };
    };

    await render_probe();
    runtime_fixture.project_snapshot.path = "E:/demo/next.lg";
    await render_probe();
    expect(latest_state?.prompt_text).toBe("新项目提示词");

    await act(async () => {
      resolve_old_query?.({
        prompt: {
          text: "旧项目迟到提示词",
          enabled: false,
        },
        sectionRevisions: {
          prompts: 3,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest_state?.prompt_text).toBe("新项目提示词");
    expect(latest_state?.enabled).toBe(true);
  });

  it("项目切换时等待旧写入并继续保存新项目草稿", async () => {
    let resolve_old_save: (() => void) | null = null;
    const old_save = new Promise<void>((resolve) => {
      resolve_old_save = resolve;
    });
    save_handler = async (_body, current_save_index) => {
      if (current_save_index === 1) {
        await old_save;
      }
    };
    query_handler = async () => {
      const is_next_project = runtime_fixture.project_snapshot.path.endsWith("next.lg");
      return {
        prompt: {
          text: is_next_project ? "新项目提示词" : "旧项目提示词",
          enabled: false,
        },
        sectionRevisions: {
          prompts: is_next_project ? 10 : 3,
        },
      };
    };

    await render_probe();
    await act(async () => {
      latest_state?.update_prompt_text("旧项目修改");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
    });
    expect(get_save_payloads()).toHaveLength(1);

    runtime_fixture.project_snapshot.path = "E:/demo/next.lg";
    await render_probe();
    expect(latest_state?.prompt_text).toBe("新项目提示词");

    await act(async () => {
      latest_state?.update_prompt_text("新项目修改");
      vi.advanceTimersByTime(CUSTOM_PROMPT_AUTOSAVE_DELAY_MS);
      await Promise.resolve();
    });
    expect(get_save_payloads()).toHaveLength(1);

    await act(async () => {
      resolve_old_save?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(get_save_payloads()).toEqual([
      expect.objectContaining({
        text: "旧项目修改",
      }),
      expect.objectContaining({
        expected_section_revisions: {
          prompts: 10,
        },
        text: "新项目修改",
      }),
    ]);
  });
});
