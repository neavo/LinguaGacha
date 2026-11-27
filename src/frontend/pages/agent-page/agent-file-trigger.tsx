import type { ReactElement, ReactNode, JSX } from "react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppContextMenuItem } from "@frontend/widgets/app-context-menu";
import { AgentLinkMenu } from "./agent-link-menu";
import { useAgentFileAction, type AgentFileTarget } from "./use-agent-file-action";

/** 文件链接、正文图片和文件附件共用唯一动作入口。 */
export function AgentFileTrigger({
  render,
  children,
  ...target
}: AgentFileTarget & {
  render: ReactElement;
  children?: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const action = useAgentFileAction(target.path);
  return (
    <AgentLinkMenu
      trigger={{
        render,
        children,
        className: action.pending ? "select-text cursor-progress" : "select-text",
        "aria-busy": action.pending,
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          void action.run(target);
        },
      }}
      copy_href={target.source?.path ?? target.path}
    >
      {action.menu_items(target).map(({ label, run }) => (
        <AppContextMenuItem key={label} onClick={run}>
          {t(label)}
        </AppContextMenuItem>
      ))}
    </AgentLinkMenu>
  );
}
