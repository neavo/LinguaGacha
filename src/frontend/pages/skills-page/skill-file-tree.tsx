import { AGENT_SKILL_MAIN_FILE } from "@shared/agent-skills";
import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus2,
  Folder,
  FolderPlus,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppButton } from "@frontend/widgets/app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { SkillEntryNameDialog } from "./skill-entry-name-dialog";
import type { AgentSkillFileChange, AgentSkillFileEntry } from "@shared/agent-skills";

type Props = {
  entries: AgentSkillFileEntry[];
  path: string;
  readonly: boolean;
  busy: boolean;
  on_open: (path: string) => Promise<boolean>;
  on_change: (change: AgentSkillFileChange) => Promise<boolean>;
};
type EntryAction = "rename" | "delete";
type InputAction = {
  operation: "create_file" | "create_directory" | "rename";
  path: string;
  parent: string;
};
/** 包根目录用空字符串表示，保持文件命令的相对路径约定。 */
const parent_path = (value: string) => value.slice(0, Math.max(0, value.lastIndexOf("/")));
/** 在选中的父目录下组合新名称。 */
const join_path = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

/** 文件树持有导航、名称弹窗与拖拽状态。编辑页管理文件事实及保存顺序。 */
export function SkillFileTree(props: Props): JSX.Element {
  const { t } = useI18n();
  const [expanded, set_expanded] = useState<Set<string>>(new Set());
  const [selected, set_selected] = useState<string | null>(null); // 空路径选中根目录，null 跟随当前文件。
  const [input, set_input] = useState<InputAction | null>(null);
  const [deleting, set_deleting] = useState<AgentSkillFileEntry | null>(null);
  const [cut, set_cut] = useState<string | null>(null); // 剪切只记录来源，粘贴成功后才清除。
  const [dragging, set_dragging] = useState<string | null>(null); // 原生拖拽来源同时控制条目提示显隐。
  const [drop_target, set_drop_target] = useState<string | null>(null);
  const disabled = props.busy || props.readonly;
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
  const actions: EntryAction[] = ["rename", "delete"];
  /** 将行按钮转换为名称输入或删除确认。 */
  function start(operation: EntryAction, entry: AgentSkillFileEntry) {
    if (operation === "rename") {
      set_input({ operation, path: entry.path, parent: parent_path(entry.path) });
    } else {
      set_deleting(entry);
    }
  }
  /** 在选中目录或当前文件所在目录开始创建条目。 */
  function create(operation: "create_file" | "create_directory") {
    set_expanded((previous) => new Set([...previous, new_parent]));
    set_input({ operation, path: "", parent: new_parent });
  }
  /** 文件命令成功后迁移本地导航路径，磁盘事实始终由父组件刷新。 */
  async function change(command: AgentSkillFileChange): Promise<boolean> {
    if (!(await props.on_change(command))) return false;
    if (command.operation === "move") {
      // 目录移动同时迁移后代的展开路径。
      const migrate = (path: string) =>
        path === command.path || path.startsWith(`${command.path}/`)
          ? command.destination + path.slice(command.path.length)
          : path;
      set_expanded(
        (previous) => new Set([...previous].map(migrate).concat(parent_path(command.destination))),
      );
      set_selected(command.destination);
    } else if (command.operation !== "delete") {
      set_selected(command.path);
    }
    set_cut(null);
    return true;
  }
  /** 拖拽和键盘粘贴使用相同的目标规则与移动入口。 */
  function can_move(source: string | null, parent: string): source is string {
    return (
      !disabled &&
      source !== null &&
      source !== AGENT_SKILL_MAIN_FILE &&
      props.entries.some((entry) => entry.path === source) &&
      (parent === "" ||
        props.entries.some((entry) => entry.path === parent && entry.kind === "directory")) &&
      parent !== parent_path(source) &&
      parent !== source &&
      !parent.startsWith(`${source}/`)
    );
  }
  /** 将来源名称放到目标目录，由统一文件命令更新导航。 */
  async function move(source: string | null, parent: string) {
    if (can_move(source, parent))
      await change({
        operation: "move",
        path: source,
        destination: join_path(parent, source.split("/").at(-1)!),
      });
  }
  /** 整行接收目录投放，落点高亮与提交共用目标校验。 */
  function drop_events(parent: string) {
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        if (!can_move(dragging, parent)) {
          event.dataTransfer.dropEffect = "none";
          set_drop_target(null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        set_drop_target(parent);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          set_drop_target(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const source = dragging;
        set_dragging(null);
        set_drop_target(null);
        void move(source, parent);
      },
    };
  }
  /** 文件树接收剪切、粘贴和取消，名称弹窗在此容器外处理输入。 */
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    if (event.key === "Escape") set_cut(null);
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() === "x" && selection && selection.path !== AGENT_SKILL_MAIN_FILE) {
      event.preventDefault();
      set_cut(selection.path);
    }
    if (event.key.toLowerCase() === "v" && cut) {
      event.preventDefault();
      void move(cut, new_parent);
    }
  }
  /** 根目录是页面导航入口，使用与真实条目相同的行结构和投放区域。 */
  function row(entry: AgentSkillFileEntry): JSX.Element {
    const root = entry.path === "";
    const directory = entry.kind === "directory";
    const open = root || expanded.has(entry.path);
    const editable = !root && !props.readonly && entry.path !== AGENT_SKILL_MAIN_FILE;
    const label = root ? "/" : entry.path.split("/").at(-1)!;
    return (
      <div
        className="skill-tree__row"
        data-selected={(selected ?? props.path) === entry.path || undefined}
        data-cut={cut === entry.path || undefined}
        data-drop-target={drop_target === entry.path || undefined}
        {...(directory ? drop_events(entry.path) : {})}
      >
        <Tooltip disabled={dragging !== null}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="skill-tree__select"
                data-root={root || undefined}
                disabled={props.busy}
                aria-expanded={directory && !root ? open : undefined}
                draggable={editable && !disabled}
                onFocus={() => set_selected(entry.path)}
                onDragStart={(event) => {
                  if (!editable || disabled) {
                    event.preventDefault();
                    return;
                  }
                  set_dragging(entry.path);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", entry.path);
                }}
                onDragEnd={() => {
                  set_dragging(null);
                  set_drop_target(null);
                }}
                onClick={() => {
                  if (root) set_selected("");
                  else if (directory) {
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
                {directory && !root ? (
                  open ? (
                    <ChevronDown />
                  ) : (
                    <ChevronRight />
                  )
                ) : root ? null : (
                  <span className="skill-tree__spacer" />
                )}
                {root ? <FolderOpen /> : directory ? <Folder /> : <File />}
                <span>{label}</span>
              </button>
            }
          />
          <TooltipContent>{`/${entry.path}`}</TooltipContent>
        </Tooltip>
        {editable && (
          <div className="skill-tree__actions">
            {actions.map((operation) => (
              <Tooltip key={operation}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="skill-tree__action"
                      aria-label={t(`skills_page.editor.${operation}`)}
                      disabled={props.busy}
                      onClick={() => start(operation, entry)}
                    >
                      {operation === "rename" ? (
                        <Pencil aria-hidden="true" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                    </button>
                  }
                />
                <TooltipContent>{t(`skills_page.editor.${operation}`)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    );
  }
  /** 递归只负责遍历可见目录，条目外观与交互由同一个行入口负责。 */
  function branch(parent: string): JSX.Element {
    return (
      <ul className="skill-tree__branch">
        {props.entries
          .filter((entry) => parent_path(entry.path) === parent)
          .map((entry) => (
            <li key={entry.path}>
              {row(entry)}
              {entry.kind === "directory" && expanded.has(entry.path) && branch(entry.path)}
            </li>
          ))}
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
      <nav
        className="skill-tree__scroll"
        aria-label={t("skills_page.editor.files")}
        onKeyDown={keyboard}
      >
        {row({ path: "", kind: "directory" })}
        <div className="skill-tree__children">{branch("")}</div>
      </nav>
      <AppActionDialog
        open={deleting !== null}
        title={t("skills_page.editor.delete")}
        description={t(
          deleting?.kind === "directory"
            ? "skills_page.editor.delete_directory_confirm"
            : "skills_page.editor.delete_file_confirm",
        )}
        submitting={props.busy}
        onClose={() => set_deleting(null)}
        primaryAction={{
          label: t("skills_page.editor.delete"),
          destructive: true,
          disabled: props.readonly,
          onSelect: async () => {
            if (
              !props.readonly &&
              deleting &&
              (await change({ operation: "delete", path: deleting.path }))
            ) {
              set_deleting(null);
              set_selected(null);
            }
          },
        }}
      />
      {input && (
        <SkillEntryNameDialog
          operation={input.operation}
          initial_name={input.path.split("/").at(-1) ?? ""}
          busy={props.busy}
          readonly={props.readonly}
          on_close={() => set_input(null)}
          on_submit={async (name) => {
            const target = join_path(input.parent, name);
            if (input.operation === "rename" && target === input.path) return true;
            return await change(
              input.operation === "rename"
                ? { operation: "move", path: input.path, destination: target }
                : { operation: input.operation, path: target },
            );
          }}
        />
      )}
    </>
  );
}
