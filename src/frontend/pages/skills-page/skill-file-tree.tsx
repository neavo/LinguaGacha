import { AGENT_SKILL_MAIN_FILE } from "@shared/agent-skills";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus2,
  Folder,
  FolderPlus,
  MoreHorizontal,
} from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { Input } from "@frontend/shadcn/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import {
  AppContextMenu,
  AppContextMenuContent,
  AppContextMenuItem,
  AppContextMenuTrigger,
} from "@frontend/widgets/app-context-menu";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import type { AgentSkillFileChange, AgentSkillFileEntry } from "@shared/agent-skills";

type Props = {
  entries: AgentSkillFileEntry[];
  path: string;
  readonly: boolean;
  busy: boolean;
  on_open: (path: string) => Promise<boolean>;
  on_change: (change: AgentSkillFileChange) => Promise<boolean>;
};
type EntryAction = "rename" | "move" | "delete";
type InputAction = {
  operation: "create_file" | "create_directory" | "rename";
  path: string;
  parent: string;
};
/** 包根目录用空字符串表示，保持文件命令的相对路径约定。 */
const parent_path = (value: string) => value.slice(0, Math.max(0, value.lastIndexOf("/")));
/** 在选中的父目录下组合新名称。 */
const join_path = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

/** 文件树只拥有展开、选中和菜单状态；文件事实及保存顺序由编辑页持有。 */
export function SkillFileTree(props: Props): JSX.Element {
  const { t } = useI18n();
  const [expanded, set_expanded] = useState<Set<string>>(new Set());
  const [selected, set_selected] = useState<string | null>(null);
  const [input, set_input] = useState<InputAction | null>(null);
  const [name, set_name] = useState("");
  const [action, set_action] = useState<{ operation: "move" | "delete"; path: string } | null>(
    null,
  );
  const [destination, set_destination] = useState("");
  useEffect(() => {
    const parts = props.path.split("/");
    set_expanded(
      (previous) =>
        new Set([
          ...previous,
          ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/")),
        ]),
    );
    set_selected(props.path);
  }, [props.path]);
  const selection = props.entries.find((entry) => entry.path === (selected ?? props.path));
  const new_parent =
    selection?.kind === "directory" ? selection.path : parent_path(selection?.path ?? "");
  const actions: EntryAction[] = ["rename", "move", "delete"];
  /** 将行菜单选择转换为名称输入或确认操作。 */
  function start(operation: EntryAction, entry: AgentSkillFileEntry) {
    if (operation === "rename") {
      set_input({ operation, path: entry.path, parent: parent_path(entry.path) });
      set_name(entry.path.split("/").at(-1) ?? "");
    } else {
      set_destination("");
      set_action({ operation, path: entry.path });
    }
  }
  /** 在选中目录或当前文件所在目录开始创建条目。 */
  function create(operation: "create_file" | "create_directory") {
    set_expanded((previous) => new Set([...previous, new_parent]));
    set_input({ operation, path: "", parent: new_parent });
    set_name("");
  }
  /** 提交名称后等待后端结果，失败时保留输入。 */
  async function submit() {
    if (!input || !name.trim() || /[/\\]/.test(name) || props.busy || props.readonly) return;
    const target = join_path(input.parent, name);
    if (input.operation === "rename" && target === input.path) {
      set_input(null);
      return;
    }
    const change: AgentSkillFileChange =
      input.operation === "rename"
        ? { operation: "move", path: input.path, destination: target }
        : { operation: input.operation, path: target };
    if (await props.on_change(change)) {
      set_input(null);
      set_selected(target);
    }
  }
  const input_row = input ? (
    <form
      className="skill-tree__input"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        autoFocus
        aria-label={t(`skills_page.editor.${input.operation}`)}
        value={name}
        disabled={props.busy || props.readonly}
        onChange={(event) => set_name(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") set_input(null);
        }}
      />
      <AppButton
        size="sm"
        type="submit"
        disabled={props.busy || props.readonly || !name.trim() || /[/\\]/.test(name)}
      >
        {t("app.action.confirm")}
      </AppButton>
      <AppButton
        size="sm"
        variant="ghost"
        type="button"
        disabled={props.busy}
        onClick={() => set_input(null)}
      >
        {t("app.action.cancel")}
      </AppButton>
    </form>
  ) : null;
  /** 只展开可见分支，同一条目共用右键与更多菜单动作。 */
  function branch(parent: string): JSX.Element {
    return (
      <ul className="skill-tree__branch">
        {input && input.operation !== "rename" && input.parent === parent && <li>{input_row}</li>}
        {props.entries
          .filter((entry) => parent_path(entry.path) === parent)
          .map((entry) => {
            const directory = entry.kind === "directory";
            const open = expanded.has(entry.path);
            const editable = !props.readonly && entry.path !== AGENT_SKILL_MAIN_FILE;
            const row = (
              <div
                className="skill-tree__row"
                data-selected={(selected ?? props.path) === entry.path || undefined}
              >
                <button
                  type="button"
                  className="skill-tree__select"
                  disabled={props.busy}
                  aria-expanded={directory ? open : undefined}
                  title={entry.path}
                  onClick={() => {
                    if (directory) {
                      set_selected(entry.path);
                      set_expanded((previous) => {
                        const next = new Set(previous);
                        if (open) next.delete(entry.path);
                        else next.add(entry.path);
                        return next;
                      });
                    } else
                      void props.on_open(entry.path).then((ok) => {
                        if (ok) set_selected(entry.path);
                      });
                  }}
                >
                  {directory ? (
                    open ? (
                      <ChevronDown />
                    ) : (
                      <ChevronRight />
                    )
                  ) : (
                    <span className="skill-tree__spacer" />
                  )}
                  {directory ? <Folder /> : <File />}
                  <span>{entry.path.split("/").at(-1)}</span>
                </button>
                {editable && (
                  <AppDropdownMenu>
                    <AppDropdownMenuTrigger
                      render={
                        <AppButton
                          variant="ghost"
                          size="icon-sm"
                          disabled={props.busy}
                          className="skill-tree__actions"
                          aria-label={t("skills_page.editor.actions")}
                          title={t("skills_page.editor.actions")}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </AppDropdownMenuTrigger>
                    <AppDropdownMenuContent align="end">
                      {actions.map((operation) => (
                        <AppDropdownMenuItem
                          key={operation}
                          variant={operation === "delete" ? "destructive" : "default"}
                          onClick={() => start(operation, entry)}
                        >
                          {t(`skills_page.editor.${operation}`)}
                        </AppDropdownMenuItem>
                      ))}
                    </AppDropdownMenuContent>
                  </AppDropdownMenu>
                )}
              </div>
            );
            return (
              <li key={entry.path}>
                {input?.operation === "rename" && input.path === entry.path ? (
                  input_row
                ) : editable ? (
                  <AppContextMenu>
                    <AppContextMenuTrigger render={<div />}>{row}</AppContextMenuTrigger>
                    <AppContextMenuContent>
                      {actions.map((operation) => (
                        <AppContextMenuItem
                          key={operation}
                          disabled={props.busy}
                          onClick={() => start(operation, entry)}
                        >
                          {t(`skills_page.editor.${operation}`)}
                        </AppContextMenuItem>
                      ))}
                    </AppContextMenuContent>
                  </AppContextMenu>
                ) : (
                  row
                )}
                {directory && open && branch(entry.path)}
              </li>
            );
          })}
      </ul>
    );
  }
  return (
    <>
      <div className="skill-tree__toolbar">
        <span className="skill-tree__title">{t("skills_page.editor.files")}</span>
        {!props.readonly &&
          (["create_file", "create_directory"] as const).map((operation) => (
            <Tooltip key={operation}>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <AppButton
                  variant="ghost"
                  size="icon-sm"
                  disabled={props.busy}
                  aria-label={t(`skills_page.editor.${operation}`)}
                  onClick={() => create(operation)}
                >
                  {operation === "create_file" ? <FilePlus2 /> : <FolderPlus />}
                </AppButton>
              </TooltipTrigger>
              <TooltipContent>{t(`skills_page.editor.${operation}`)}</TooltipContent>
            </Tooltip>
          ))}
      </div>
      <nav className="skill-tree__scroll" aria-label={t("skills_page.editor.files")}>
        {branch("")}
      </nav>
      <AppActionDialog
        open={action?.operation === "delete"}
        title={t("skills_page.editor.delete")}
        description={t("skills_page.editor.delete_confirm", { PATH: action?.path ?? "" })}
        submitting={props.busy}
        onClose={() => set_action(null)}
        primaryAction={{
          label: t("skills_page.editor.delete"),
          destructive: true,
          disabled: props.readonly,
          onSelect: async () => {
            if (
              !props.readonly &&
              action &&
              (await props.on_change({ operation: "delete", path: action.path }))
            ) {
              set_action(null);
              set_selected(null);
            }
          },
        }}
      />
      <AppPageDialog
        open={action?.operation === "move"}
        title={t("skills_page.editor.move")}
        size="sm"
        onClose={() => {
          if (!props.busy) set_action(null);
        }}
        footer={
          <AppButton
            disabled={props.busy || props.readonly}
            onClick={() => {
              if (action)
                void props
                  .on_change({
                    operation: "move",
                    path: action.path,
                    destination: join_path(destination, action.path.split("/").at(-1) ?? ""),
                  })
                  .then((ok) => {
                    if (ok) {
                      set_action(null);
                      set_selected(null);
                      set_expanded((previous) => new Set([...previous, destination]));
                    }
                  });
            }}
          >
            {t("skills_page.editor.move")}
          </AppButton>
        }
      >
        <label className="skill-tree__destination">
          {t("skills_page.editor.destination")}
          <select
            value={destination}
            disabled={props.busy || props.readonly}
            onChange={(event) => set_destination(event.target.value)}
          >
            <option value="">/</option>
            {props.entries
              .filter(
                (entry) =>
                  entry.kind === "directory" &&
                  entry.path !== action?.path &&
                  !entry.path.startsWith(`${action?.path}/`),
              )
              .map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.path}
                </option>
              ))}
          </select>
        </label>
      </AppPageDialog>
    </>
  );
}
