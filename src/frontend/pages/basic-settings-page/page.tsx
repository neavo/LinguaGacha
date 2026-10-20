import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { type JSX, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { parse_bounded_setting_number_draft } from "@frontend/features/settings-editor/setting-number-draft";
import { useI18n } from "@frontend/app/locale/locale-context";
import "@frontend/pages/basic-settings-page/basic-settings-page.css";
import {
  PROXY_MODE_LABEL_KEYS,
  PROXY_MODE_OPTIONS,
  PROXY_PROTOCOL_OPTIONS,
  PROJECT_SAVE_MODE_LABEL_KEYS,
  PROJECT_SAVE_MODE_OPTIONS,
  REQUEST_TIMEOUT_MAX,
  REQUEST_TIMEOUT_MIN,
  is_project_save_mode,
  read_proxy_incomplete_field,
  type ProxySettingValue,
} from "@frontend/pages/basic-settings-page/types";
import { ProjectLanguageSelect } from "@frontend/features/project-language/project-language-select";
import { useBasicSettingsState } from "@frontend/pages/basic-settings-page/use-basic-settings-state";
import { is_proxy_mode, is_proxy_protocol, is_same_proxy_setting } from "@domain/setting";
import { AppButton } from "@frontend/widgets/app-button";
import { Card, CardContent } from "@frontend/shadcn/card";
import { Input } from "@frontend/shadcn/input";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@frontend/shadcn/select";

type BasicSettingsPageProps = {
  is_sidebar_collapsed: boolean;
};
/** 保留数值输入草稿，在失焦或确认后提交设置。 */
export function BasicSettingsPage(_props: BasicSettingsPageProps): JSX.Element {
  const { t } = useI18n();

  const basic_settings_state = useBasicSettingsState();
  const [request_timeout_draft, set_request_timeout_draft] = useState<string>(() => {
    return String(basic_settings_state.snapshot.request_timeout);
  });
  const [is_request_timeout_editing, set_is_request_timeout_editing] = useState(false);
  const parsed_request_timeout = parse_bounded_setting_number_draft(
    request_timeout_draft,
    REQUEST_TIMEOUT_MIN,
    REQUEST_TIMEOUT_MAX,
  );
  const request_timeout_invalid = parsed_request_timeout === null;
  const project_save_mode_options = useMemo(() => {
    return PROJECT_SAVE_MODE_OPTIONS.map((mode) => {
      return {
        value: mode,
        label: t(PROJECT_SAVE_MODE_LABEL_KEYS[mode]),
      };
    });
  }, [t]);

  const project_save_mode_description =
    basic_settings_state.snapshot.project_save_mode === "FIXED" &&
    basic_settings_state.snapshot.project_fixed_path !== ""
      ? t("basic_settings_page.fields.project_save_mode.description_fixed", {
          PATH: basic_settings_state.snapshot.project_fixed_path,
        })
      : t("basic_settings_page.fields.project_save_mode.description");

  const language_locked = basic_settings_state.language_locked;

  // 代理手动字段整体提交：草稿在页面内保留，保存成功后才成为已保存配置。
  const [proxy_draft, set_proxy_draft] = useState<ProxySettingValue>(() => {
    return basic_settings_state.snapshot.proxy;
  });
  // 草稿仍等于上一份成功基线时视为没有用户编辑；外部快照变化可以安全覆盖草稿。
  const proxy_baseline = useRef<ProxySettingValue>(basic_settings_state.snapshot.proxy);
  const saved_proxy = basic_settings_state.snapshot.proxy;
  const proxy_dirty = !is_same_proxy_setting(proxy_draft, saved_proxy);
  const proxy_incomplete_field = read_proxy_incomplete_field(proxy_draft);
  const saved_proxy_incomplete_field = read_proxy_incomplete_field(saved_proxy);

  useEffect(() => {
    if (!is_same_proxy_setting(proxy_draft, proxy_baseline.current)) return;
    proxy_baseline.current = saved_proxy;
    set_proxy_draft(saved_proxy);
  }, [proxy_draft, saved_proxy]);

  const proxy_mode_options = useMemo(() => {
    return PROXY_MODE_OPTIONS.map((mode) => {
      return { value: mode, label: t(PROXY_MODE_LABEL_KEYS[mode]) };
    });
  }, [t]);

  const proxy_notices = useMemo(() => {
    const notices: string[] = [];
    const status = basic_settings_state.proxy_status;
    if (status !== null && !status.applied) {
      notices.push(
        t("basic_settings_page.status.apply_failed", { REASON: status.failureReason ?? "" }),
      );
    }
    if (saved_proxy_incomplete_field !== null) {
      notices.push(t("basic_settings_page.status.manual_incomplete"));
    }
    if (
      saved_proxy.mode === "manual" &&
      saved_proxy.protocol === "SOCKS5" &&
      saved_proxy.username !== ""
    ) {
      notices.push(t("basic_settings_page.status.socks5_auth"));
    }
    return notices;
  }, [basic_settings_state.proxy_status, saved_proxy, saved_proxy_incomplete_field, t]);

  /** 更新草稿字段；端口只接受数字，空值保留为 0 以便就地提示。 */
  function update_proxy_draft(patch: Partial<ProxySettingValue>): void {
    set_proxy_draft((previous) => ({ ...previous, ...patch }));
  }

  /** 校验通过后整体提交代理设置，失败时通用编辑器保留草稿并提示。 */
  async function commit_proxy_draft(): Promise<void> {
    if (proxy_incomplete_field !== null) {
      return;
    }

    const saved = await basic_settings_state.save_proxy(proxy_draft);
    if (saved !== null) {
      // 后端会裁剪首尾空格；草稿以保存响应为准，避免一直停留在「有未保存修改」。
      proxy_baseline.current = saved;
      set_proxy_draft(saved);
      push_toast("success", t("basic_settings_page.feedback.proxy_saved"));
    }
  }

  useEffect(() => {
    if (is_request_timeout_editing) {
      return;
    }

    set_request_timeout_draft(String(basic_settings_state.snapshot.request_timeout));
  }, [basic_settings_state.snapshot.request_timeout, is_request_timeout_editing]);

  /** 校验输入后提交超时设置，无效草稿留在当前编辑状态。 */
  async function commit_request_timeout_draft(): Promise<void> {
    if (parsed_request_timeout === null) {
      push_error_toast(
        t("app.feedback.save_failed"),
        t("basic_settings_page.feedback.request_timeout_invalid"),
      );
      set_is_request_timeout_editing(true);
      return;
    }

    if (parsed_request_timeout === basic_settings_state.snapshot.request_timeout) {
      set_request_timeout_draft(String(parsed_request_timeout));
      set_is_request_timeout_editing(false);
      return;
    }

    await basic_settings_state.update_request_timeout(parsed_request_timeout);
    set_is_request_timeout_editing(false);
  }
  /** Enter 与失焦共用提交入口。 */
  function handle_request_timeout_key_down(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void commit_request_timeout_draft();
  }

  return (
    <div className="basic-settings-page page-shell page-shell--full">
      <section className="basic-settings-page__list" aria-label={t("basic_settings_page.title")}>
        <SettingCardRow
          action_width="content"
          title={t("app.language_role.source")}
          description={t("basic_settings_page.fields.source_language.description")}
          action={
            <ProjectLanguageSelect
              field="source_language"
              value={basic_settings_state.languages.source_language}
              disabled={
                language_locked || basic_settings_state.language_pending_state.source_language
              }
              on_change={(next_value) => {
                void basic_settings_state.update_source_language(next_value);
              }}
            />
          }
        />

        <SettingCardRow
          action_width="content"
          title={t("app.language_role.target")}
          description={t("basic_settings_page.fields.target_language.description")}
          action={
            <ProjectLanguageSelect
              field="target_language"
              value={basic_settings_state.languages.target_language}
              disabled={
                language_locked || basic_settings_state.language_pending_state.target_language
              }
              on_change={(next_value) => {
                void basic_settings_state.update_target_language(next_value);
              }}
            />
          }
        />

        <SettingCardRow
          action_width="content"
          title={t("basic_settings_page.fields.project_save_mode.title")}
          description={project_save_mode_description}
          action={
            <Select
              items={project_save_mode_options}
              value={basic_settings_state.snapshot.project_save_mode}
              disabled={basic_settings_state.pending_state.project_save_mode}
              onValueChange={(next_value) => {
                if (next_value !== null && is_project_save_mode(next_value)) {
                  void basic_settings_state.update_project_save_mode(next_value);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {project_save_mode_options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />

        <SettingCardRow
          title={t("basic_settings_page.fields.output_folder_open_on_finish.title")}
          description={t("basic_settings_page.fields.output_folder_open_on_finish.description")}
          action={
            <BooleanSegmentedToggle
              aria_label={t("basic_settings_page.fields.output_folder_open_on_finish.title")}
              value={basic_settings_state.snapshot.output_folder_open_on_finish}
              stretch
              disabled={basic_settings_state.pending_state.output_folder_open_on_finish}
              on_value_change={(next_value) => {
                void basic_settings_state.update_output_folder_open_on_finish(next_value);
              }}
            />
          }
        />

        <SettingCardRow
          title={t("basic_settings_page.fields.request_timeout.title")}
          description={t("basic_settings_page.fields.request_timeout.description")}
          action={
            <div className="basic-settings-page__number-field">
              <Input
                type="number"
                min={REQUEST_TIMEOUT_MIN}
                max={REQUEST_TIMEOUT_MAX}
                value={request_timeout_draft}
                aria-invalid={request_timeout_invalid || undefined}
                disabled={basic_settings_state.pending_state.request_timeout}
                onChange={(event) => {
                  set_is_request_timeout_editing(true);
                  set_request_timeout_draft(event.target.value);
                }}
                onBlur={() => {
                  void commit_request_timeout_draft();
                }}
                onKeyDown={handle_request_timeout_key_down}
                onFocus={() => {
                  set_is_request_timeout_editing(true);
                }}
              />
            </div>
          }
        />

        <Card className="basic-settings-page__proxy-card">
          <CardContent className="basic-settings-page__proxy-card-content">
            <SettingCardRow
              embedded
              action_width="content"
              title={t("basic_settings_page.fields.proxy.title")}
              description={t("basic_settings_page.fields.proxy.description")}
              action={
                <Select
                  items={proxy_mode_options}
                  value={proxy_draft.mode}
                  disabled={basic_settings_state.pending_state.proxy}
                  onValueChange={(next_value) => {
                    if (next_value !== null && is_proxy_mode(next_value)) {
                      update_proxy_draft({ mode: next_value });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {proxy_mode_options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              }
            />

            {proxy_draft.mode === "manual" ? (
              <>
                <SettingCardRow
                  embedded
                  action_width="content"
                  title={t("basic_settings_page.fields.proxy.server_label")}
                  description={t("basic_settings_page.fields.proxy.server_description")}
                  action={
                    <div className="basic-settings-page__proxy-server">
                      <Select
                        items={PROXY_PROTOCOL_OPTIONS.map((protocol) => ({
                          value: protocol,
                          label: protocol,
                        }))}
                        value={proxy_draft.protocol}
                        disabled={basic_settings_state.pending_state.proxy}
                        onValueChange={(next_value) => {
                          if (next_value !== null && is_proxy_protocol(next_value)) {
                            update_proxy_draft({ protocol: next_value });
                          }
                        }}
                      >
                        <SelectTrigger
                          aria-label={t("basic_settings_page.fields.proxy.protocol_label")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {PROXY_PROTOCOL_OPTIONS.map((protocol) => (
                              <SelectItem key={protocol} value={protocol}>
                                {protocol}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <Input
                        className="basic-settings-page__proxy-host"
                        value={proxy_draft.host}
                        placeholder={t("basic_settings_page.fields.proxy.host_placeholder")}
                        aria-label={t("basic_settings_page.fields.proxy.address_label")}
                        aria-invalid={proxy_incomplete_field === "proxy.host" || undefined}
                        aria-describedby={
                          proxy_incomplete_field === "proxy.host"
                            ? "basic-settings-proxy-host-error"
                            : undefined
                        }
                        disabled={basic_settings_state.pending_state.proxy}
                        onChange={(event) => {
                          update_proxy_draft({ host: event.target.value });
                        }}
                      />

                      <Input
                        className="basic-settings-page__proxy-port"
                        inputMode="numeric"
                        value={proxy_draft.port === 0 ? "" : String(proxy_draft.port)}
                        placeholder={t("basic_settings_page.fields.proxy.port_placeholder")}
                        aria-label={t("basic_settings_page.fields.proxy.port_label")}
                        aria-invalid={proxy_incomplete_field === "proxy.port" || undefined}
                        aria-describedby={
                          proxy_incomplete_field === "proxy.port"
                            ? "basic-settings-proxy-port-error"
                            : undefined
                        }
                        disabled={basic_settings_state.pending_state.proxy}
                        onChange={(event) => {
                          const digits = event.target.value.replace(/\D/gu, "");
                          update_proxy_draft({ port: digits === "" ? 0 : Number(digits) });
                        }}
                      />
                    </div>
                  }
                />

                {proxy_incomplete_field === "proxy.host" ||
                proxy_incomplete_field === "proxy.port" ? (
                  <p
                    id={
                      proxy_incomplete_field === "proxy.host"
                        ? "basic-settings-proxy-host-error"
                        : "basic-settings-proxy-port-error"
                    }
                    className="basic-settings-page__proxy-field-error"
                  >
                    {t(
                      proxy_incomplete_field === "proxy.host"
                        ? "basic_settings_page.feedback.proxy_host_invalid"
                        : "basic_settings_page.feedback.proxy_port_invalid",
                    )}
                  </p>
                ) : null}

                <SettingCardRow
                  embedded
                  action_width="content"
                  title={t("basic_settings_page.fields.proxy.auth_label")}
                  description={t("basic_settings_page.fields.proxy.auth_description")}
                  action={
                    <div className="basic-settings-page__proxy-server">
                      <Input
                        className="basic-settings-page__proxy-username"
                        value={proxy_draft.username}
                        placeholder={t("basic_settings_page.fields.proxy.username_placeholder")}
                        aria-label={t("basic_settings_page.fields.proxy.username_placeholder")}
                        aria-invalid={proxy_incomplete_field === "proxy.username" || undefined}
                        aria-describedby={
                          proxy_incomplete_field === "proxy.username"
                            ? "basic-settings-proxy-username-error"
                            : undefined
                        }
                        disabled={basic_settings_state.pending_state.proxy}
                        onChange={(event) => {
                          update_proxy_draft({ username: event.target.value });
                        }}
                      />

                      <Input
                        className="basic-settings-page__proxy-password"
                        type="password"
                        value={proxy_draft.password}
                        placeholder={t("basic_settings_page.fields.proxy.password_placeholder")}
                        aria-label={t("basic_settings_page.fields.proxy.password_placeholder")}
                        autoComplete="off"
                        disabled={basic_settings_state.pending_state.proxy}
                        onChange={(event) => {
                          update_proxy_draft({ password: event.target.value });
                        }}
                      />
                    </div>
                  }
                />

                {proxy_incomplete_field === "proxy.username" ? (
                  <p
                    id="basic-settings-proxy-username-error"
                    className="basic-settings-page__proxy-field-error"
                  >
                    {t("basic_settings_page.feedback.proxy_username_required")}
                  </p>
                ) : null}
              </>
            ) : null}

            {proxy_notices.length > 0 ? (
              <div className="basic-settings-page__proxy-notices">
                {proxy_notices.map((notice) => {
                  return (
                    <p key={notice} className="basic-settings-page__proxy-notice">
                      {notice}
                    </p>
                  );
                })}
              </div>
            ) : null}

            <div className="basic-settings-page__proxy-actions">
              <AppButton
                size="sm"
                disabled={
                  !proxy_dirty ||
                  proxy_incomplete_field !== null ||
                  basic_settings_state.pending_state.proxy
                }
                onClick={() => {
                  void commit_proxy_draft();
                }}
              >
                {t("basic_settings_page.fields.proxy.save")}
              </AppButton>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
