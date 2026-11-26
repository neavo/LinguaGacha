import { useState, type JSX } from "react";
import { GITHUB_REPOSITORY_URL } from "@frontend/app/desktop/desktop-api";
import { useExternalLink } from "@frontend/app/desktop/use-external-link";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";

const STAR_PROMPT_DISMISSED_STORAGE_KEY = "lg-github-star-prompt-dismissed";

/** 管理点星弹窗和提醒偏好，挂载时机由对话页面决定。 */
export function AgentStarPrompt(): JSX.Element | null {
  const { t } = useI18n();
  const activate_external_link = useExternalLink();
  const [state, set_state] = useState<"ready" | "open" | "dismissed">(() =>
    window.localStorage.getItem(STAR_PROMPT_DISMISSED_STORAGE_KEY) === "1" ? "dismissed" : "ready",
  );
  if (state === "dismissed") return null;

  /** 不再提醒和跳转共用本机设置，关闭窗口后仍生效。 */
  function dismiss_permanently(): void {
    window.localStorage.setItem(STAR_PROMPT_DISMISSED_STORAGE_KEY, "1");
    set_state("dismissed");
  }

  return (
    <>
      <button type="button" className="agent-star-prompt" onClick={() => set_state("open")}>
        <span className="agent-star-prompt__label">{t("agent_page.star_prompt.action")}</span>
      </button>
      <AppActionDialog
        open={state === "open"}
        hideTitle
        description={t("agent_page.star_prompt.description")}
        secondaryAction={{
          label: t("agent_page.star_prompt.never_remind"),
          onSelect: dismiss_permanently,
        }}
        primaryAction={{
          label: t("agent_page.star_prompt.open_github"),
          onSelect: () => {
            dismiss_permanently();
            void activate_external_link(GITHUB_REPOSITORY_URL);
          },
        }}
        onClose={() => set_state("ready")}
      />
    </>
  );
}
