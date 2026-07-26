import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api_fetch } from "@frontend/app/desktop/desktop-api";
import {
  normalize_settings_snapshot,
  type SettingsSnapshot,
  type SettingsSnapshotPayload,
} from "@frontend/app/state/desktop-state-context";
import { useSettingsEditor } from "@frontend/features/settings-editor/use-settings-editor";

type RuntimeFixture = {
  settings_snapshot: SettingsSnapshot;
  apply_settings_snapshot: ReturnType<typeof vi.fn>;
  refresh_settings: ReturnType<typeof vi.fn>;
};

type EditorSnapshot = Pick<SettingsSnapshot, "source_language" | "request_timeout">;

const PENDING_FIELDS = ["source_language", "request_timeout"] as const;
const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};
const push_toast = vi.fn();
const translate = (key: string): string => key;

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => runtime_fixture.current,
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({
    push_toast,
  }),
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: translate,
  }),
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: vi.fn(),
  report_renderer_error: vi.fn(async () => undefined),
  DesktopApiError: class DesktopApiError extends Error {},
}));

function create_settings_snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return normalize_settings_snapshot({
    settings: {
      app_language: "ZH",
      source_language: "JA",
      target_language: "ZH",
      request_timeout: 300,
      mtool_optimizer_enable: false,
      skip_duplicate_source_text_enable: true,
      ...overrides,
    },
  });
}

function create_runtime_fixture(): RuntimeFixture {
  const settings_snapshot = create_settings_snapshot();
  return {
    settings_snapshot,
    apply_settings_snapshot: vi.fn((payload: SettingsSnapshotPayload) => {
      const next_settings_snapshot = normalize_settings_snapshot(payload);
      runtime_fixture.current = {
        ...runtime_fixture.current,
        settings_snapshot: next_settings_snapshot,
      };
      return next_settings_snapshot;
    }),
    refresh_settings: vi.fn(async () => runtime_fixture.current.settings_snapshot),
  };
}

function select_snapshot(settings_snapshot: SettingsSnapshot): EditorSnapshot {
  return {
    source_language: settings_snapshot.source_language,
    request_timeout: settings_snapshot.request_timeout,
  };
}

function create_deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((promise_resolve, promise_reject) => {
    resolve = promise_resolve;
    reject = promise_reject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

describe("useSettingsEditor", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<
    typeof useSettingsEditor<EditorSnapshot, "source_language" | "request_timeout">
  > | null = null;

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
    runtime_fixture.current = create_runtime_fixture();
    push_toast.mockReset();
    vi.mocked(api_fetch).mockReset();
  });

  function EditorProbe(): JSX.Element | null {
    latest_state = useSettingsEditor({
      select_snapshot,
      pending_fields: PENDING_FIELDS,
      refresh_error_key: "basic_settings_page.feedback.refresh_failed",
      update_error_key: "basic_settings_page.feedback.update_failed",
    });
    return null;
  }

  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(EditorProbe));
      await Promise.resolve();
    });
  }

  it("设置上下文变化时同步页面投影", async () => {
    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      settings_snapshot: create_settings_snapshot({
        source_language: "EN",
        request_timeout: 900,
      }),
    };
    await render_hook();

    expect(latest_state?.snapshot).toEqual({
      source_language: "EN",
      request_timeout: 900,
    });
  });

  it("提交期间乐观更新并在失败时只回滚本次 patch 字段", async () => {
    const source_request = create_deferred<SettingsSnapshotPayload>();
    const timeout_request = create_deferred<SettingsSnapshotPayload>();
    vi.mocked(api_fetch).mockImplementation(async (_path, body) => {
      if ("source_language" in (body ?? {})) {
        return await source_request.promise;
      }
      return await timeout_request.promise;
    });
    await render_hook();
    if (latest_state === null) {
      throw new Error("设置编辑器测试状态尚未初始化。");
    }

    let source_update: Promise<SettingsSnapshot | null> | null = null;
    await act(async () => {
      source_update =
        latest_state?.commit_update("source_language", {
          source_language: "EN",
        }) ?? null;
      await Promise.resolve();
    });
    let timeout_update: Promise<SettingsSnapshot | null> | null = null;
    await act(async () => {
      timeout_update =
        latest_state?.commit_update("request_timeout", {
          request_timeout: 600,
        }) ?? null;
      await Promise.resolve();
    });

    expect(latest_state?.snapshot).toEqual({
      source_language: "EN",
      request_timeout: 600,
    });
    expect(latest_state?.pending_state).toEqual({
      source_language: true,
      request_timeout: true,
    });

    source_request.reject(new Error("update_failed"));
    await act(async () => {
      await source_update;
    });

    expect(latest_state?.snapshot).toEqual({
      source_language: "JA",
      request_timeout: 600,
    });
    expect(latest_state?.pending_state).toEqual({
      source_language: false,
      request_timeout: true,
    });
    expect(push_toast).toHaveBeenCalledWith("error", "basic_settings_page.feedback.update_failed");

    timeout_request.resolve({
      settings: create_settings_snapshot({
        request_timeout: 601,
      }),
    });
    await act(async () => {
      await timeout_update;
    });

    expect(latest_state?.snapshot).toEqual({
      source_language: "JA",
      request_timeout: 601,
    });
    expect(latest_state?.pending_state).toEqual({
      source_language: false,
      request_timeout: false,
    });
    expect(vi.mocked(api_fetch).mock.calls).toEqual([
      ["/api/settings/update", { source_language: "EN" }],
      ["/api/settings/update", { request_timeout: 600 }],
    ]);
  });

  it("刷新失败时保留当前投影并显示页面指定的错误", async () => {
    runtime_fixture.current.refresh_settings = vi.fn(async () => {
      throw new Error("refresh_failed");
    });

    await render_hook();

    expect(latest_state?.snapshot).toEqual({
      source_language: "JA",
      request_timeout: 300,
    });
    expect(push_toast).toHaveBeenCalledWith("error", "basic_settings_page.feedback.refresh_failed");
  });
});
