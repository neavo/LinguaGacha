import { useRef } from "react";
import { open_external_url } from "@frontend/app/desktop/desktop-api";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";

/** 协议相对地址在桌面端按 HTTPS 打开，剪贴板使用同一地址。 */
export function normalize_external_link(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

/** 合并同一链接的重复操作，失败后允许重试。 */
export function useExternalLink(): (url: string) => Promise<void> {
  const pending = useRef(false);
  const { t } = useI18n();
  return async (url) => {
    if (pending.current) return;
    pending.current = true;
    try {
      await open_external_url(normalize_external_link(url));
    } catch (error) {
      push_error_toast(t("app.feedback.activate_link"), error);
    } finally {
      pending.current = false;
    }
  };
}
