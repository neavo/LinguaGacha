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
import { api_fetch } from "@frontend/app/desktop/desktop-api";

import { useI18n } from "@frontend/app/locale/locale-context";
import {
  AppContextMenu,
  AppContextMenuTrigger,
  AppContextMenuContent,
  AppContextMenuItem,
} from "@frontend/widgets/app-context-menu";
import { AgentFileContext } from "./agent-file-context";

/** 文件链接、正文图片和文件附件共用唯一动作入口。 */
export function AgentFileTrigger({
  path,
  render,
  children,
}: {
  path: string;
  render: ReactElement;
  children?: ReactNode;
}): JSX.Element {
  const context = useContext(AgentFileContext);
  const { t } = useI18n();
  const [pending, set_pending] = useState(false);
  const [open, set_open] = useState(false);
  const [file, set_file] = useState<AgentFile | null>(null);
  const controller = useRef<AbortController | null>(null);
  const saving = useRef(false);
  // 标签隐藏、链接目标改变或卸载时，旧菜单与在途读取一起失效。
  useEffect(() => {
    set_open(false);
    return () => controller.current?.abort();
  }, [context?.active, path]);
  /** 文件操作共用一次用户可见错误反馈。 */
  const report = (error: unknown): void => {
    push_error_toast(t("agent_page.error.activate_link"), error);
  };
  /** 保存对话框返回前合并重复保存，取消时安静结束。 */
  const save = async (): Promise<void> => {
    if (saving.current) return;
    saving.current = true;
    try {
      const result = await api_fetch<AgentWorkspaceLinkResult>(
        "/api/agent/workspace/activate-path",
        { path },
      );
      if (result.status === "saved") push_toast("success", t("agent_page.file_saved"));
    } catch (error) {
      report(error);
    } finally {
      saving.current = false;
    }
  };
  /** 先识别文件能力；右键只提供动作，左键才执行默认操作。 */
  const resolve = async (menu: boolean): Promise<void> => {
    if (!context?.active) return;
    controller.current?.abort();
    set_pending(true);
    const request = new AbortController();
    controller.current = request;
    try {
      const next = await api_fetch<AgentFile>(
        "/api/agent/workspace/file",
        { path, chatId: context?.chat_id },
        request.signal,
      );
      if (request.signal.aborted) return;
      if (menu) {
        set_file(next);
        set_open(next.kind === "file");
      } else if (next.preview) context.open_file(path, next);
      else await save();
    } catch (error) {
      if (!request.signal.aborted) report(error);
    } finally {
      if (controller.current === request) set_pending(false);
    }
  };
  return (
    <AppContextMenu
      open={open}
      onOpenChange={(value) => {
        if (value) void resolve(true);
        else set_open(false);
      }}
    >
      <AppContextMenuTrigger
        render={render}
        className={pending ? "select-text cursor-progress" : "select-text"}
        aria-busy={pending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void resolve(false);
        }}
      >
        {children}
      </AppContextMenuTrigger>
      <AppContextMenuContent>
        {file?.preview && context ? (
          <AppContextMenuItem
            onClick={() => {
              context.open_file(path, file);
            }}
          >
            {t("agent_page.document.view")}
          </AppContextMenuItem>
        ) : null}
        <AppContextMenuItem
          onClick={() => {
            void save();
          }}
        >
          {t("agent_page.document.save_as")}
        </AppContextMenuItem>
      </AppContextMenuContent>
    </AppContextMenu>
  );
}
