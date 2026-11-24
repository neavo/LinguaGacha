import { useAgentApi } from "@frontend/app/desktop/scoped-api";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type JSX,
} from "react";
import type { AgentFile } from "@shared/agent-workspace-file";
import type { AgentWorkspaceLinkResult } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppContextMenuItem } from "@frontend/widgets/app-context-menu";
import { AgentFileContext } from "./agent-file-context";
import { AgentLinkMenu } from "./agent-link-menu";

/** 文件链接、正文图片和文件附件共用唯一动作入口。 */
export function AgentFileTrigger({
  path,
  attachment_preview,
  render,
  children,
}: {
  path: string;
  attachment_preview?: AgentFile["preview"]; // 已上传附件的文件信息可直接用于菜单。
  render: ReactElement;
  children?: ReactNode;
}): JSX.Element {
  const { post: api_fetch } = useAgentApi();
  const context = useContext(AgentFileContext);
  const { t } = useI18n();
  const [pending, set_pending] = useState(false);
  // 文件描述随阅读位置取消。系统操作已交给后端时，仍等待对话框和保存结果。
  const operation = useRef<AbortController | "system" | null>(null);
  useEffect(
    () => () => {
      if (operation.current instanceof AbortController) operation.current.abort();
    },
    [context?.active, path],
  );

  /** 左键和菜单共用一次文件操作，合并重复点击并统一反馈。 */
  const run = async (action: "open" | "save_as"): Promise<void> => {
    if (!context?.active || operation.current !== null) return;
    const file_request = action === "open" ? new AbortController() : null;
    operation.current = file_request ?? "system";
    set_pending(true);
    try {
      if (file_request) {
        const file = await api_fetch<AgentFile>(
          "/api/agent/workspace/file",
          { path, chatId: context.chat_id },
          file_request.signal,
        );
        if (file_request.signal.aborted) return;
        if (file.preview) {
          context.open_file(path, file);
          return;
        }
        operation.current = "system";
      }
      const result = await api_fetch<AgentWorkspaceLinkResult>(
        "/api/agent/workspace/activate-path",
        { path },
      );
      if (result.status === "saved") push_toast("success", t("agent_page.file_saved"));
    } catch (error) {
      if (!file_request?.signal.aborted) push_error_toast(t("app.feedback.activate_link"), error);
    } finally {
      operation.current = null;
      set_pending(false);
    }
  };
  return (
    <AgentLinkMenu
      trigger={{
        render,
        children,
        className: pending ? "select-text cursor-progress" : "select-text",
        "aria-busy": pending,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          void run("open");
        },
      }}
      copy_href={path}
    >
      <AppContextMenuItem onClick={() => void run("open")}>
        {t(
          attachment_preview === null ? "agent_page.document.save_as" : "agent_page.document.open",
        )}
      </AppContextMenuItem>
      {attachment_preview ? (
        <AppContextMenuItem onClick={() => void run("save_as")}>
          {t("agent_page.document.save_as")}
        </AppContextMenuItem>
      ) : null}
    </AgentLinkMenu>
  );
}
