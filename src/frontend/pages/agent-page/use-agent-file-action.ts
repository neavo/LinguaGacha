import { useContext, useEffect, useRef, useState } from "react";
import { useAgentApi } from "@frontend/app/session/agent/agent-chat-context";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import type { AgentWorkspaceLinkResult } from "@shared/agent";
import type { AgentReference } from "@shared/agent-reference";
import { resolve_workspace_image_mime } from "@shared/image-formats";
import {
  encode_agent_workspace_path,
  is_agent_file_url,
  local_path_to_file_url,
  resolve_agent_text_format,
  type AgentFile,
} from "@shared/agent-workspace-file";
import { AgentFileContext } from "./agent-file-context";

/** API 地址用于打开文件，引用另保留原路径供定位和复制。 */
export type AgentFileTarget = Readonly<{
  path: string;
  source?: Readonly<{ kind: "file" | "upload"; path: string }>;
  attachment_preview?: AgentFile["preview"] | undefined; // null 表示菜单仅提供另存，undefined 表示打开时才查询能力。
}>;
type AgentFileAction = "open" | "save_as";

/** 只有上传引用和有效本机路径可以触发文件操作。 */
export function resolve_agent_reference_file(reference: AgentReference): AgentFileTarget | null {
  if (reference.kind === "file") {
    const path = local_path_to_file_url(reference.path);
    return path === null ? null : { path, source: { kind: reference.kind, path: reference.path } };
  }
  if (reference.kind !== "upload") return null;
  const path = encode_agent_workspace_path(reference.path);
  if (path === null) return null;
  return {
    path,
    source: { kind: reference.kind, path: reference.path },
    attachment_preview: resolve_workspace_image_mime(reference.path)
      ? "image"
      : resolve_agent_text_format(path),
  };
}

/** 链接和引用菜单共享剪贴板反馈。 */
export function useAgentCopyText(): (text: string) => Promise<void> {
  const { t } = useI18n();
  return async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      push_toast("success", t("agent_page.action.copied"));
    } catch (error) {
      push_error_toast(t("app.feedback.copy_failed"), error);
    }
  };
}

/** 正文链接、附件和编辑器共用文件能力读取、预览与系统动作。 */
export function useAgentFileAction(path?: string) {
  const { post } = useAgentApi();
  const context = useContext(AgentFileContext);
  const { t } = useI18n();
  const [pending, set_pending] = useState(false);
  // 标签或链接变化时取消能力读取，已经发出的系统动作仍等待结果。
  const operation = useRef<AbortController | "system" | null>(null);
  useEffect(
    () => () => {
      if (operation.current instanceof AbortController) operation.current.abort();
    },
    [context?.active, context?.chat_id, path],
  );

  // 无工程时只有本机引用能交给系统文件管理器。
  const can_open = (target: AgentFileTarget): boolean =>
    context === null ? target.source?.kind === "file" : context.active;

  /** 一次打开可能接续系统对话框，整个操作结束前合并重复点击。 */
  async function run(target: AgentFileTarget, action: AgentFileAction = "open"): Promise<void> {
    if (!can_open(target) || operation.current !== null) return;
    const file_request = context !== null && action === "open" ? new AbortController() : null;
    operation.current = file_request ?? "system";
    set_pending(true);
    try {
      if (context === null) {
        await window.desktopApp.revealPath(target.source!.path);
        return;
      }

      const request = { path: target.path, chatId: context.chat_id };
      if (file_request) {
        const file = await post<AgentFile>(
          "/api/agent/workspace/file",
          request,
          file_request.signal,
        );
        if (file_request.signal.aborted) return;
        if (file.preview) {
          context.open_file(target.path, file);
          return;
        }
        operation.current = "system";
        // 工作区内的本机文件仍按原位置定位，目录由后端打开。
        if (
          target.source?.kind === "file" &&
          file.kind === "file" &&
          !is_agent_file_url(file.path)
        ) {
          await window.desktopApp.revealPath(target.source.path);
          return;
        }
      }
      const result = await post<AgentWorkspaceLinkResult>(
        "/api/agent/workspace/activate-path",
        request,
      );
      if (result.status === "saved") push_toast("success", t("agent_page.file_saved"));
    } catch (error) {
      if (!file_request?.signal.aborted) push_error_toast(t("app.feedback.activate_link"), error);
    } finally {
      operation.current = null;
      set_pending(false);
    }
  }

  /** 菜单另存可直接激活保存，打开时才读取文件能力。 */
  function menu_items(target: AgentFileTarget): { label: LocaleKey; run: () => void }[] {
    const save_only = target.attachment_preview === null;
    const primary_label =
      context === null && target.source?.kind === "file"
        ? "app.workspace.reveal_path"
        : save_only
          ? "agent_page.document.save_as"
          : "agent_page.document.open";
    const items: { label: LocaleKey; run: () => void }[] = [
      {
        label: primary_label,
        run: () => void run(target, save_only ? "save_as" : "open"),
      },
    ];
    if (target.attachment_preview)
      items.push({ label: "agent_page.document.save_as", run: () => void run(target, "save_as") });
    return items;
  }

  return { pending, can_open, run, menu_items };
}
