import { PersonalityEditor } from "./personality-editor";
import { Badge } from "@frontend/shadcn/badge";
import { type JSX, useEffect, useRef, useState, type Ref } from "react";
import type {
  AgentSkillEntry,
  AgentSkillIdentity,
  AgentSkillSource,
  AgentSkillsSnapshot,
} from "@shared/agent-skills";
import { DragDropProvider } from "@dnd-kit/react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { useReorder } from "@frontend/widgets/interactions/use-reorder";
import {
  SORTABLE_OPTIONS,
  SORTABLE_PROVIDER_OPTIONS,
} from "@frontend/widgets/interactions/sortable";
import { useSortable } from "@dnd-kit/react/sortable";
import { CircleHelp, GripVertical } from "lucide-react";
import { Card } from "@frontend/shadcn/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@frontend/shadcn/tooltip";
import { useAppNavigation } from "@frontend/app/navigation/navigation-context";
import { AppActionDialog } from "@frontend/widgets/app-alert-dialog";
import { AppButton } from "@frontend/widgets/app-button";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useDesktopState, useRuntimeSnapshot } from "@frontend/app/state/use-desktop-state";
import "./skills-page.css";
import { SkillEditor } from "./skill-editor";

type SkillsPageEntry = { kind: "personality" } | { kind: "skill"; skill: AgentSkillIdentity };

/** 按来源展示技能，用户排序由页面统一提交。 */
export function SkillsPage(): JSX.Element {
  const [selected, set_selected] = useState<SkillsPageEntry | null>(null);
  return (
    <>
      <div className="skills-page__list" hidden={selected !== null}>
        <SkillsList
          on_open={(skill) => set_selected({ kind: "skill", skill })}
          on_personality={() => set_selected({ kind: "personality" })}
          active={selected === null}
        />
      </div>
      {selected?.kind === "skill" && (
        <SkillEditor skill={selected.skill} on_back={() => set_selected(null)} />
      )}
      {selected?.kind === "personality" && <PersonalityEditor on_back={() => set_selected(null)} />}
    </>
  );
}

/** 列表保留挂载状态以恢复滚动，详情关闭后重新读取技能事实。 */
function SkillsList({
  on_personality,
  on_open,
  active,
}: {
  on_open: (skill: AgentSkillIdentity) => void;
  active: boolean;
  on_personality: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const state = useSkillsPageState(active);
  const { navigate_to_agent } = useAppNavigation();
  const [help_open, set_help_open] = useState(false);
  const locked = useRuntimeSnapshot().owner === "agent";
  const builtin = state.snapshot.skills.filter((skill) => skill.source === "builtin");
  const user = state.snapshot.skills.filter((skill) => skill.source === "user");
  const reorder = useReorder({
    ids: user.map((skill) => skill.name),
    disabled: state.pending || locked,
    on_reorder: state.reorder,
  });
  const by_name = new Map(user.map((skill) => [skill.name, skill]));
  const pending = state.pending || reorder.pending;

  if (state.status !== "ready")
    return (
      <div className="skills-page page-shell page-shell--full">
        <AppContentState
          status={state.status}
          message={t(
            state.status === "error" ? "skills_page.feedback.load_failed" : "app.action.loading",
          )}
          on_retry={state.retry}
        />
      </div>
    );

  return (
    <div className="skills-page page-shell page-shell--full">
      <section className="skills-page__group" aria-label={t("skills_page.builtin")}>
        <h2>{t("skills_page.builtin")}</h2>
        <Card className="skills-page__card">
          <button
            type="button"
            className="skills-page__open"
            aria-label="personality"
            disabled={pending}
            onClick={on_personality}
          />
          <SkillHandle disabled />
          <h3 className="skills-page__heading">
            <span>personality</span>
          </h3>
          <p className="skills-page__description">{t("skills_page.personality_description")}</p>
        </Card>
        {builtin.map((skill) => (
          <SkillCard
            key={skill.name}
            skill={skill}
            pending={pending}
            locked={locked}
            on_enabled={state.set_enabled}
            on_open={on_open}
          />
        ))}
      </section>
      <section className="skills-page__group" aria-label={t("skills_page.user")}>
        <div className="skills-page__group-header">
          <h2>{t("skills_page.user")}</h2>
          <Tooltip>
            <TooltipTrigger
              render={
                <AppButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("skills_page.install.title")}
                  onClick={() => set_help_open(true)}
                >
                  <CircleHelp aria-hidden="true" />
                </AppButton>
              }
            />
            <TooltipContent>{t("skills_page.install.title")}</TooltipContent>
          </Tooltip>
        </div>
        <DragDropProvider {...SORTABLE_PROVIDER_OPTIONS} {...reorder.events}>
          {reorder.ordered_ids.map((name, index) => (
            <SortableSkillCard
              key={name}
              skill={by_name.get(name)!}
              index={index}
              pending={pending}
              locked={locked}
              on_enabled={state.set_enabled}
              on_open={on_open}
            />
          ))}
        </DragDropProvider>
        {user.length === 0 && (
          <Card render={<p />} className="skills-page__empty">
            {t("skills_page.empty")}
          </Card>
        )}
      </section>
      <AppActionDialog
        open={help_open}
        title={t("skills_page.install.title")}
        description={t("skills_page.install.description")}
        onClose={() => set_help_open(false)}
        primaryAction={{
          label: t("app.action.go_to_agent"),
          onSelect: () => {
            const placeholder = t("skills_page.install.placeholder");
            const text = t("skills_page.install.request", { LINK: placeholder });
            const from = text.indexOf(placeholder); // 从当前语言的完整正文定位选区。
            set_help_open(false);
            navigate_to_agent({
              text,
              mode: "replace",
              selection: { from, to: from + placeholder.length },
            });
          },
        }}
      />
    </div>
  );
}

type SkillCardProps = {
  on_open: (skill: AgentSkillIdentity) => void;
  skill: AgentSkillEntry;
  pending: boolean;
  locked: boolean;
  on_enabled: (source: AgentSkillSource, name: string, enabled: boolean) => Promise<void>;
  card_ref?: Ref<HTMLDivElement>;
  handle_ref?: Ref<HTMLButtonElement> | undefined;
  dragging?: boolean;
};

/** 两个来源共用卡片，用户技能由外层绑定拖拽。 */
function SkillCard(props: SkillCardProps): JSX.Element {
  const { t, locale } = useI18n();
  const skill = props.skill;
  const description = skill.displayDescriptions[locale];
  const drag_disabled = props.pending || props.locked || skill.source === "builtin";
  return (
    <Card
      ref={props.card_ref}
      className="skills-page__card"
      data-dragging={props.dragging || undefined}
    >
      {/* 独立按钮覆盖条目；把手和开关位于上层，点击与拖动无需阻止事件冒泡。 */}
      <button
        type="button"
        className="skills-page__open"
        aria-label={skill.name}
        disabled={props.pending || props.dragging}
        onClick={() => props.on_open({ source: skill.source, name: skill.name })}
      />
      <SkillHandle disabled={drag_disabled} handle_ref={props.handle_ref} />
      <h3 className="skills-page__heading">
        <span>{skill.name}</span>
        {skill.source === "builtin" && <Badge tone="neutral">{t("skills_page.readonly")}</Badge>}
      </h3>
      <div className="skills-page__actions">
        <BooleanSegmentedToggle
          aria_label={skill.name}
          value={skill.enabled}
          disabled={props.pending || props.locked}
          on_value_change={(enabled) => {
            if (enabled !== skill.enabled) void props.on_enabled(skill.source, skill.name, enabled);
          }}
        />
      </div>
      <p className="skills-page__description">{description}</p>
    </Card>
  );
}

/** 内置与用户技能共用把手外观，只有用户条目绑定排序。 */
function SkillHandle({
  disabled,
  handle_ref,
}: {
  disabled: boolean;
  handle_ref?: Ref<HTMLButtonElement> | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const drag_label = t(disabled ? "app.drag.disabled" : "app.drag.enabled");
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="skills-page__handle-slot" />}>
        <AppButton
          ref={handle_ref}
          variant="ghost"
          size="icon-sm"
          className="skills-page__handle"
          disabled={disabled}
          aria-label={drag_label}
        >
          <GripVertical />
        </AppButton>
      </TooltipTrigger>
      <TooltipContent>{drag_label}</TooltipContent>
    </Tooltip>
  );
}

/** 将共享排序行为绑定到用户技能卡片。 */
function SortableSkillCard(props: SkillCardProps & { index: number }): JSX.Element {
  const { ref, handleRef, isDragSource } = useSortable({
    ...SORTABLE_OPTIONS,
    id: props.skill.name,
    index: props.index,
    disabled: props.pending || props.locked,
  });
  return <SkillCard {...props} card_ref={ref} handle_ref={handleRef} dragging={isDragSource} />;
}

/** 页面持有管理快照，当前可用技能由后端同步到对话。 */
function useSkillsPageState(active: boolean) {
  const { settings_snapshot } = useDesktopState();
  const { t } = useI18n();
  const [snapshot, set_snapshot] = useState<AgentSkillsSnapshot>({ skills: [] });
  const [status, set_status] = useState<"loading" | "ready" | "error">("loading");
  const [pending, set_pending] = useState(false);
  const [refresh, set_refresh] = useState(0);
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
      () => {
        if (!controller.signal.aborted) set_status("error");
      },
    );
    return () => {
      controller.abort();
    };
  }, [settings_snapshot, refresh, active]);

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
      if (mounted.current)
        push_toast(
          "error",
          resolve_visible_error_message(error, t, t("skills_page.feedback.save_failed")),
        );
    } finally {
      saving.current = false;
      if (mounted.current) set_pending(false);
    }
  }

  return {
    snapshot,
    status,
    pending,
    retry: () => {
      set_status("loading");
      set_refresh((value) => value + 1);
    },
    set_enabled: (source: AgentSkillSource, name: string, enabled: boolean) =>
      save("/api/skills/enabled", { source, name, enabled }),
    reorder: (names: string[]) => save("/api/skills/reorder", { names }),
  };
}
