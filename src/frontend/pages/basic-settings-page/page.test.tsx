import { type ReactNode, act } from "react";

import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PROXY_SETTING, type ProxySettingValue } from "@domain/setting";
import { BasicSettingsPage } from "@frontend/pages/basic-settings-page/page";
import type { AppProxyRuntimeStatus, ProxyProbeSummary } from "@shared/proxy";

const { basic_settings_state_fixture, push_toast_mock } = vi.hoisted(() => {
  return {
    basic_settings_state_fixture: {
      current: null as ReturnType<typeof create_basic_settings_state_fixture> | null,
    },
    push_toast_mock: vi.fn(),
  };
});

vi.mock("@frontend/app/locale/locale-context", () => {
  return {
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  push_error_toast: push_toast_mock,
  push_toast: push_toast_mock,
}));

vi.mock("@frontend/pages/basic-settings-page/use-basic-settings-state", () => {
  return {
    useBasicSettingsState: () => basic_settings_state_fixture.current,
  };
});

vi.mock("@frontend/widgets/setting-card-row/setting-card-row", () => {
  return {
    SettingCardRow: (props: { title: string; action: ReactNode }) => (
      <section aria-label={props.title}>{props.action}</section>
    ),
  };
});

vi.mock("@frontend/widgets/boolean-segmented-toggle", () => {
  return {
    BooleanSegmentedToggle: () => <button type="button" />,
  };
});

vi.mock("@frontend/shadcn/select", () => {
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

/** 隔离页面输入行为，保存结果由状态 Hook 测试验证。 */
function create_basic_settings_state_fixture() {
  return {
    snapshot: {
      project_save_mode: "MANUAL",
      project_fixed_path: "",
      output_folder_open_on_finish: false,
      request_timeout: 300,
      proxy: { ...DEFAULT_PROXY_SETTING },
    },
    pending_state: {
      project_save_mode: false,
      output_folder_open_on_finish: false,
      request_timeout: false,
      proxy: false,
    },
    languages: { source_language: "JA", target_language: "ZH" },
    language_pending_state: { source_language: false, target_language: false },
    language_locked: false,
    runtime_locked: false,
    proxy_status: null as AppProxyRuntimeStatus | null,
    proxy_probe: null as ProxyProbeSummary | null,
    is_probing_proxy: false,
    update_source_language: vi.fn(async (_next_language: string) => {}),
    update_target_language: vi.fn(async (_next_language: string) => {}),
    update_project_save_mode: vi.fn(async (_next_mode: "MANUAL" | "FIXED" | "SOURCE") => {}),
    update_output_folder_open_on_finish: vi.fn(async (_next_checked: boolean) => {}),
    update_request_timeout: vi.fn(async (_next_value: number) => {}),
    save_proxy: vi.fn(async (next_value: ProxySettingValue) => next_value),
    probe_proxy: vi.fn(async () => {}),
  };
}

/** 经原生 setter 和输入事件触发 React 的受控输入更新。 */
function set_input_value(input: HTMLInputElement, value: string): void {
  const value_setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (value_setter === undefined) {
    throw new Error("当前测试环境缺少 input value setter。");
  }

  value_setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 读取当前用例的隔离夹具，未初始化时立即暴露错误。 */
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

  /** 挂载真实页面以验证输入、失焦与键盘提交。 */
  async function mount_page(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<BasicSettingsPage is_sidebar_collapsed={false} />);
    });
  }

  /** 在页面中定位超时输入，缺失时终止当前测试。 */
  function get_button(label: string): HTMLButtonElement {
    const button = [...(container?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === label,
    );

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`未找到按钮：${label}`);
    }

    return button;
  }

  function get_proxy_field(label: string): HTMLInputElement {
    const input = container?.querySelector(`input[aria-label="${label}"]`);

    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`未找到代理输入项：${label}`);
    }

    return input;
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

  it("没有用户编辑时跟随外部快照更新草稿", async () => {
    const initial: ProxySettingValue = {
      mode: "manual",
      protocol: "HTTP",
      host: "127.0.0.1",
      port: 7890,
      username: "",
      password: "",
    };
    get_current_basic_settings_state().snapshot.proxy = initial;
    await mount_page();

    get_current_basic_settings_state().snapshot.proxy = { ...initial, host: "10.0.0.2" };
    await act(async () => {
      set_input_value(get_request_timeout_input(), "600");
    });

    expect(get_proxy_field("basic_settings_page.fields.proxy.address_label").value).toBe(
      "10.0.0.2",
    );
    expect(get_button("basic_settings_page.fields.proxy.save").disabled).toBe(true);
  });

  it("保存成功后草稿采用后端裁剪后的配置", async () => {
    const saved_proxy: ProxySettingValue = {
      mode: "manual",
      protocol: "HTTP",
      host: "10.0.0.2",
      port: 7890,
      username: "",
      password: "",
    };
    get_current_basic_settings_state().snapshot.proxy = saved_proxy;
    get_current_basic_settings_state().save_proxy = vi.fn(async () => saved_proxy);
    await mount_page();

    await act(async () => {
      set_input_value(
        get_proxy_field("basic_settings_page.fields.proxy.address_label"),
        " 10.0.0.2 ",
      );
    });

    await act(async () => {
      get_button("basic_settings_page.fields.proxy.save").click();
      await Promise.resolve();
    });

    expect(get_proxy_field("basic_settings_page.fields.proxy.address_label").value).toBe(
      "10.0.0.2",
    );
  });

  it("手动代理整组提交草稿，改动前保存与测试均不可用", async () => {
    get_current_basic_settings_state().snapshot.proxy = {
      mode: "manual",
      protocol: "HTTP",
      host: "127.0.0.1",
      port: 7890,
      username: "",
      password: "",
    };
    await mount_page();

    expect(get_button("basic_settings_page.fields.proxy.save").disabled).toBe(true);
    expect(get_button("basic_settings_page.fields.proxy.test").disabled).toBe(false);

    await act(async () => {
      set_input_value(
        get_proxy_field("basic_settings_page.fields.proxy.address_label"),
        "10.0.0.2",
      );
    });

    expect(get_button("basic_settings_page.fields.proxy.test").disabled).toBe(true);
    expect(container?.textContent).toContain("basic_settings_page.feedback.proxy_test_unsaved");

    await act(async () => {
      get_button("basic_settings_page.fields.proxy.save").click();
      await Promise.resolve();
    });

    expect(get_current_basic_settings_state().save_proxy).toHaveBeenCalledExactlyOnceWith({
      mode: "manual",
      protocol: "HTTP",
      host: "10.0.0.2",
      port: 7890,
      username: "",
      password: "",
    });
    expect(push_toast_mock).toHaveBeenCalledWith(
      "success",
      "basic_settings_page.feedback.proxy_saved",
    );
  });

  it("手动字段不完整时就地标记并禁止保存", async () => {
    get_current_basic_settings_state().snapshot.proxy = {
      mode: "manual",
      protocol: "HTTP",
      host: "",
      port: 7890,
      username: "",
      password: "",
    };
    await mount_page();

    expect(
      get_proxy_field("basic_settings_page.fields.proxy.address_label").getAttribute(
        "aria-invalid",
      ),
    ).toBe("true");
    expect(container?.textContent).toContain("basic_settings_page.feedback.proxy_host_invalid");
    expect(get_button("basic_settings_page.fields.proxy.save").disabled).toBe(true);
  });

  it("手动地址带协议前缀时给出同一条就地提示", async () => {
    get_current_basic_settings_state().snapshot.proxy = {
      mode: "manual",
      protocol: "HTTP",
      host: "http://127.0.0.1:7890",
      port: 7890,
      username: "",
      password: "",
    };
    await mount_page();

    expect(
      get_proxy_field("basic_settings_page.fields.proxy.address_label").getAttribute(
        "aria-invalid",
      ),
    ).toBe("true");
    expect(container?.textContent).toContain("basic_settings_page.feedback.proxy_host_invalid");
    expect(get_button("basic_settings_page.fields.proxy.save").disabled).toBe(true);
  });

  it("降级状态与 SOCKS5 认证限制显示为常驻提示", async () => {
    get_current_basic_settings_state().snapshot.proxy = {
      mode: "manual",
      protocol: "SOCKS5",
      host: "127.0.0.1",
      port: 1080,
      username: "user",
      password: "pass",
    };
    get_current_basic_settings_state().proxy_status = {
      applied: false,
      effectiveMode: "system",
      failureReason: "boom",
    };
    await mount_page();

    expect(container?.textContent).toContain("basic_settings_page.status.apply_failed");
    expect(container?.textContent).toContain("basic_settings_page.status.socks5_auth");
  });

  it("测试连接按钮读取已保存配置并展示两条链路结果", async () => {
    get_current_basic_settings_state().proxy_probe = {
      translation: { ok: true, status: 204, elapsedMs: 12, route: null, failureReason: null },
      updates: {
        ok: false,
        status: null,
        elapsedMs: 30,
        route: "PROXY 127.0.0.1:7890",
        failureReason: "ECONNREFUSED",
      },
    };
    await mount_page();

    await act(async () => {
      get_button("basic_settings_page.fields.proxy.test").click();
      await Promise.resolve();
    });

    expect(get_current_basic_settings_state().probe_proxy).toHaveBeenCalledOnce();
    expect(container?.textContent).toContain("basic_settings_page.probe.succeeded");
    expect(container?.textContent).toContain("basic_settings_page.probe.failed");
    expect(container?.textContent).toContain("basic_settings_page.probe.route");
  });

  it("路由解析失败时显示失败提示", async () => {
    get_current_basic_settings_state().proxy_probe = {
      translation: {
        ok: false,
        status: null,
        elapsedMs: 0,
        route: null,
        failureReason: "resolve failed",
      },
      updates: {
        ok: false,
        status: null,
        elapsedMs: 0,
        route: null,
        failureReason: "resolve failed",
      },
    };
    await mount_page();

    expect(container?.textContent).toContain("basic_settings_page.probe.route_failed");
  });

  it("保存与测试按钮收在代理卡片内，链路结果与按钮同处一行", async () => {
    get_current_basic_settings_state().snapshot.proxy = {
      mode: "manual",
      protocol: "HTTP",
      host: "127.0.0.1",
      port: 7890,
      username: "",
      password: "",
    };
    get_current_basic_settings_state().proxy_probe = {
      translation: { ok: true, status: 204, elapsedMs: 12, route: null, failureReason: null },
      updates: {
        ok: false,
        status: null,
        elapsedMs: 30,
        route: "PROXY 127.0.0.1:7890",
        failureReason: "ECONNREFUSED",
      },
    };
    await mount_page();

    const save_button = get_button("basic_settings_page.fields.proxy.save");
    const card = save_button.closest('[data-slot="card"]');
    expect(card).not.toBeNull();
    expect(
      card?.querySelector('input[aria-label="basic_settings_page.fields.proxy.address_label"]'),
    ).not.toBeNull();

    const footer = save_button.closest(".basic-settings-page__proxy-footer");
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain("basic_settings_page.probe.succeeded");
    expect(footer?.textContent).toContain("basic_settings_page.probe.route");
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
      "app.feedback.save_failed",
      "basic_settings_page.feedback.request_timeout_invalid",
    );
  });
});
