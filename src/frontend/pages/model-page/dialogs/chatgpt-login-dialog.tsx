import type { JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Input } from "@frontend/shadcn/input";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import type { useChatGPTLogin } from "../use-chatgpt-login";

/** 三按钮沿用公共动作弹窗，授权结果统一由登录流程通过 Toast 反馈。 */
export function ChatGPTLoginDialog({
  login,
}: {
  login: ReturnType<typeof useChatGPTLogin>;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <AppActionDialog
      open={login.open}
      title={null}
      description={
        <Input
          readOnly
          value={login.url ?? ""}
          placeholder={t("app.action.loading")}
          aria-label={t("model_page.auth.copy_link")}
          onFocus={(event) => {
            event.currentTarget.select();
            event.currentTarget.scrollLeft = 0;
          }}
        />
      }
      onClose={() => {
        void login.cancel();
      }}
      secondaryAction={{
        label: t(login.copied ? "model_page.auth.copied" : "model_page.auth.copy_link"),
        disabled: login.url === null,
        onSelect: login.copy,
      }}
      primaryAction={{
        label: t("model_page.auth.open_login_page"),
        disabled: login.url === null,
        onSelect: login.login,
      }}
    />
  );
}
