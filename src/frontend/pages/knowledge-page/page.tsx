import { type JSX, useEffect, useRef, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import type {
  AgentSkillEntry,
  AgentSkillIdentity,
  AgentSkillSource,
  AgentSkillsSnapshot,
} from "@shared/agent-skills";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import { Card } from "@frontend/shadcn/card";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { useReorder } from "@frontend/widgets/interactions/use-reorder";
import {
  SORTABLE_OPTIONS,
  SORTABLE_PROVIDER_OPTIONS,
} from "@frontend/widgets/interactions/sortable";
import {
  type DocumentListGroupHelp,
  DocumentListGroup,
  DocumentListRow,
  type DocumentListRowProps,
} from "./document-list";
import { PersonalityEditor } from "./personality-editor";
import { ProjectKnowledgeEditor, ProjectKnowledgeGroup } from "./project-knowledge";
import { SkillEditor } from "./skill-editor";
import "./knowledge-page.css";

type KnowledgePageEntry =
  | { kind: "personality" }
  | { kind: "skill"; skill: AgentSkillIdentity }
  | { kind: "project_knowledge"; path: string };

/** 两类新增内容都交给 AGENT，指南文案按分组区分。 */
type AgentGuide = "install" | "knowledge_create";

/** 技能与工程知识共用列表和编辑器外壳，各分组自行读取数据并决定锁定条件。 */
export function KnowledgePage(): JSX.Element {
  const [selected, set_selected] = useState<KnowledgePageEntry | null>(null);
  const back = () => set_selected(null);
  return (
    <>
      <div className="knowledge-page__list" hidden={selected !== null}>
        <KnowledgeList active={selected === null} on_open={set_selected} />
      </div>
      {selected?.kind === "personality" && <PersonalityEditor on_back={back} />}
      {selected?.kind === "skill" && <SkillEditor skill={selected.skill} on_back={back} />}
      {selected?.kind === "project_knowledge" && (
        <ProjectKnowledgeEditor path={selected.path} on_back={back} />
      )}
    </>
  );
}

/** 列表保留挂载状态以恢复滚动，详情关闭后各分组重新读取事实。 */
function KnowledgeList({
  active,
  on_open,
}: {
  active: boolean;
  on_open: (entry: KnowledgePageEntry) => void;
}): JSX.Element {
  const { t, locale } = useI18n();
  const state = useSkillsState(active);
  const { navigate_to_agent } = useAppNavigation();
  const [guide, set_guide] = useState<AgentGuide>("install"); // 关闭动画期间保留最后一次的文案。
  const [guide_open, set_guide_open] = useState(false);
  const locked = useRuntimeSnapshot().owner === "agent"; // 技能存于应用目录，只与 AGENT 互斥。
  const builtin = state.snapshot.skills.filter((skill) => skill.source === "builtin");
  const user = state.snapshot.skills.filter((skill) => skill.source === "user");
  const reorder = useReorder({
    ids: user.map((skill) => skill.name),
    disabled: state.pending || locked,
    on_reorder: state.reorder,
  });
  const by_name = new Map(user.map((skill) => [skill.name, skill]));
  const pending = state.pending || reorder.pending;

  /** 分组只提供对应的 AGENT 引导，弹窗共用关闭动画状态。 */
  function guide_help(next: AgentGuide): DocumentListGroupHelp {
    return {
      label: t(`knowledge_page.${next}.title`),
      on_click: () => {
        set_guide(next);
        set_guide_open(true);
      },
    };
  }

  /** 两个来源的技能共用打开与开关规则，用户分组另外绑定排序。 */
  function skill_row(skill: AgentSkillEntry): DocumentListRowProps {
    return {
      name: skill.name,
      description: skill.displayDescriptions[locale],
      readonly_label: skill.source === "builtin" ? t("knowledge_page.readonly") : undefined,
      open_disabled: pending,
      on_open: () => on_open({ kind: "skill", skill: { source: skill.source, name: skill.name } }),
      action: (
        <BooleanSegmentedToggle
          aria_label={skill.name}
          value={skill.enabled}
          disabled={pending || locked}
          on_value_change={(enabled) => {
            if (enabled !== skill.enabled)
              void state.set_enabled(skill.source, skill.name, enabled);
          }}
        />
      ),
    };
  }

  return (
    <div
      className="knowledge-page page-shell page-shell--full"
      aria-busy={state.status === "loading"}
    >
      <DocumentListGroup title={t("knowledge_page.builtin")}>
        <Card render={<ul />} className="document-list__rows">
          <DocumentListRow
            name="personality"
            description={t("knowledge_page.personality_description")}
            open_disabled={pending || state.status !== "ready"}
            on_open={() => on_open({ kind: "personality" })}
          />
          {builtin.map((skill) => (
            <DocumentListRow key={skill.name} {...skill_row(skill)} />
          ))}
        </Card>
      </DocumentListGroup>
      <DocumentListGroup
        title={t("knowledge_page.user")}
        help={guide_help("install")}
        empty={
          state.status === "ready" && user.length === 0 ? t("knowledge_page.empty.user") : undefined
        }
      >
        {reorder.ordered_ids.length > 0 && (
          <DragDropProvider {...SORTABLE_PROVIDER_OPTIONS} {...reorder.events}>
            <Card render={<ul />} className="document-list__rows">
              {reorder.ordered_ids.map((name, index) => (
                <SortableSkillRow
                  key={name}
                  {...skill_row(by_name.get(name)!)}
                  index={index}
                  sort_disabled={pending || locked}
                />
              ))}
            </Card>
          </DragDropProvider>
        )}
      </DocumentListGroup>
      <ProjectKnowledgeGroup
        active={active}
        help={guide_help("knowledge_create")}
        on_open={(path) => on_open({ kind: "project_knowledge", path })}
      />
      <AppActionDialog
        open={guide_open}
        description={t(`knowledge_page.${guide}.description`)}
        onClose={() => set_guide_open(false)}
        primaryAction={{
          label: t("app.action.handle_with_agent"),
          onSelect: () => {
            const placeholder = t(`knowledge_page.${guide}.placeholder`);
            const text = t(`knowledge_page.${guide}.request`, { PLACEHOLDER: placeholder });
            const from = text.indexOf(placeholder); // 从当前语言的完整正文定位选区。
            set_guide_open(false);
            navigate_to_agent({
              text,
              selection: { from, to: from + placeholder.length },
            });
          },
        }}
      />
      {state.status === "error" && <AppContentState status="error" />}
    </div>
  );
}

/** 将共享排序行为绑定到用户技能行。 */
function SortableSkillRow({
  index,
  sort_disabled,
  ...props
}: DocumentListRowProps & { index: number; sort_disabled: boolean }): JSX.Element {
  const { ref, handleRef, isDragSource } = useSortable({
    ...SORTABLE_OPTIONS,
    id: props.name,
    index,
    disabled: sort_disabled,
  });
  return (
    <DocumentListRow
      {...props}
      sort={{
        row_ref: ref,
        handle_ref: handleRef,
        dragging: isDragSource,
        disabled: sort_disabled,
      }}
    />
  );
}

/** 页面持有技能管理快照，当前可用技能由后端同步到对话。 */
function useSkillsState(active: boolean) {
  const { settings_snapshot } = useDesktopState();
  const { t } = useI18n();
  const [snapshot, set_snapshot] = useState<AgentSkillsSnapshot>({ skills: [] });
  const [status, set_status] = useState<"loading" | "ready" | "error">("loading");
  const [pending, set_pending] = useState(false);
  const saving = useRef(false); // 同步拦截同一帧内的重复提交。
  const mounted = useRef(false); // 离开页面后停止发布命令反馈。
  const reading = useRef<AbortController | null>(null); // 保存开始时取消旧读取。

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reading.current?.abort();
    };
  }, []);

  useEffect(() => {
    // 本页保存由命令回包更新快照；通知只为其它设置变更触发读取。
    if (saving.current || !active) return;
    const controller = new AbortController();
    reading.current = controller;
    void api_fetch<AgentSkillsSnapshot>("/api/skills/snapshot", {}, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        set_snapshot(next);
        set_status("ready");
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        set_status((previous) => (previous === "ready" ? "ready" : "error"));
        push_error_toast(t("app.feedback.load_failed"), error);
      },
    );
    return () => {
      controller.abort();
    };
  }, [settings_snapshot, active, t]);

  /** 以服务端回包更新页面，提交失败时保留上次成功快照。 */
  async function save(path: string, body: Record<string, unknown>): Promise<void> {
    if (saving.current || !active) return;
    saving.current = true;
    reading.current?.abort();
    set_pending(true);
    try {
      const next = await api_fetch<AgentSkillsSnapshot>(path, body);
      if (!mounted.current) return;
      set_snapshot(next);
      set_status("ready");
    } catch (error) {
      if (mounted.current) push_error_toast(t("app.feedback.save_failed"), error);
    } finally {
      saving.current = false;
      if (mounted.current) set_pending(false);
    }
  }

  return {
    snapshot,
    status,
    pending,
    set_enabled: (source: AgentSkillSource, name: string, enabled: boolean) =>
      save("/api/skills/enabled", { source, name, enabled }),
    reorder: (names: string[]) => save("/api/skills/reorder", { names }),
  };
}
