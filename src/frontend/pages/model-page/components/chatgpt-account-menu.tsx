import { type JSX, type ReactNode, useEffect } from "react";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useI18n } from "@frontend/app/locale/locale-context";
import {
  apply_model_auth_snapshot,
  useModelAuthSnapshot,
} from "@frontend/app/state/model-auth-store";
import type { ChatGPTAuthSnapshot } from "@shared/model-auth";
import { LogIn, LogOut } from "lucide-react";
import {
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
} from "@frontend/widgets/app-dropdown-menu";

/** 账户只通过模型管理通道操作；目录和接口测试由原有按钮触发。 */
export function ChatGPTAccountMenu(props: {
  readonly: boolean;
  on_logout: () => void;
  on_login: () => void;
  children: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const snapshot = useModelAuthSnapshot();
  useEffect(() => {
    let cancelled = false;
    // 只补读本地账户摘要，让 CLI 的退出或重新登录在再次打开设置时可见。
    void api_fetch<{ snapshot: ChatGPTAuthSnapshot }>("/api/models/auth/snapshot", {})
      .then((result) => {
        if (!cancelled) apply_model_auth_snapshot(result.snapshot);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          push_toast(
            "error",
            resolve_visible_error_message(
              error,
              t,
              error instanceof Error ? error.message : t("app.error.model.provider_failed.message"),
            ),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const account_action = (
    <AppDropdownMenuGroup>
      <AppDropdownMenuItem
        disabled={props.readonly}
        onClick={() => {
          if (snapshot?.connected) props.on_logout();
          else props.on_login();
        }}
      >
        {snapshot?.connected ? <LogOut /> : <LogIn />}
        {t(snapshot?.connected ? "model_page.auth.logout" : "model_page.auth.login")}
      </AppDropdownMenuItem>
    </AppDropdownMenuGroup>
  );

  // 普通模型操作保持同一位置与组件身份，登录置顶、退出置底共用账户快照。
  return (
    <>
      {!snapshot?.connected ? (
        <>
          {account_action}
          <AppDropdownMenuSeparator />
        </>
      ) : null}
      {props.children}
      {snapshot?.connected ? (
        <>
          <AppDropdownMenuSeparator />
          {account_action}
        </>
      ) : null}
    </>
  );
}
