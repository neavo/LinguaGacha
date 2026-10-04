import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apply: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@frontend/app/desktop/desktop-api", async (actual) => ({
  ...(await actual<typeof import("@frontend/app/desktop/desktop-api")>()),
  api_fetch: mocks.api,
}));
vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    project_snapshot: { path: "project.lg" },
    settings_snapshot: { glossary_default_preset: "user:old.json" },
    apply_settings_snapshot: mocks.apply,
    refresh_settings: mocks.refresh,
  }),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: mocks.toast,
  push_toast: mocks.toast,
}));

import { useQualityRulePresets } from "./use-quality-rule-presets";

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  vi.clearAllMocks();
});

it.each([false, true])("保存预设按实际失败阶段反馈，刷新阶段：%s", async (refresh_failed) => {
  mocks.api.mockRejectedValue(new Error("Preset operation failed"));
  if (refresh_failed) mocks.api.mockResolvedValueOnce({});
  let current!: ReturnType<typeof useQualityRulePresets<"glossary">>;
  function Probe() {
    current = useQualityRulePresets("glossary", []);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
  await act(async () => current.request_save_preset());
  await act(async () => current.update_preset_input_value("new"));
  await act(async () => current.submit_preset_input());
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
    refresh_failed ? "app.feedback.load_failed" : "app.feedback.save_failed",
    expect.any(Error),
  );
  expect(current.preset_input_state).toMatchObject({ open: true, submitting: false });
});

it("重命名只提交一个业务命令，以后端回包同时更新预设与设置", async () => {
  const response = {
    builtin_presets: [],
    user_presets: [
      { name: "new", file_name: "new.json", virtual_id: "user:new.json", type: "user" },
    ],
    settings: { glossary_default_preset: "user:new.json" },
  };
  mocks.api.mockResolvedValue(response);
  let current!: ReturnType<typeof useQualityRulePresets<"glossary">>;
  /** 通过公开 Hook 输出观察页面状态与操作结果。 */
  function Probe() {
    current = useQualityRulePresets("glossary", []);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(createElement(Probe));
  });
  await act(async () => {
    current.request_rename_preset({ name: "old", virtual_id: "user:old.json", type: "user" });
  });
  await act(async () => {
    current.update_preset_input_value("new");
  });
  await act(async () => {
    await current.submit_preset_input();
  });
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/quality/rules/presets/rename", {
    rule_type: "glossary",
    virtual_id: "user:old.json",
    new_name: "new",
  });
  expect(mocks.apply).toHaveBeenCalledWith(response);
  expect(current.preset_items.map((item) => item.virtual_id)).toEqual(["user:new.json"]);
  expect(current.preset_input_state.open).toBe(false);
});
