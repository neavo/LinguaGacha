import { useEffect, useRef, useState, type Ref } from "react";
import type { AgentSkillEntry, AgentSkillSource, AgentSkillsSnapshot } from "@shared/agent-skills";
import { DragDropProvider } from "@dnd-kit/react";
import { useI18n } from "@frontend/app/locale/locale-context";
import { AppContentState } from "@frontend/widgets/app-content-state";
import { useReorder } from "@frontend/widgets/interactions/use-reorder";
import {
  SORTABLE_OPTIONS,
  SORTABLE_PROVIDER_OPTIONS,
} from "@frontend/widgets/interactions/sortable";
import { useSortable } from "@dnd-kit/react/sortable";
import { GripVertical, Settings } from "lucide-react";
import { Card } from "@frontend/shadcn/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import { BooleanSegmentedToggle } from "@frontend/widgets/boolean-segmented-toggle";
import { api_fetch } from "@frontend/app/desktop/desktop-api";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import "./skills-page.css";

/** 按来源展示技能，用户排序由页面统一提交。 */
export function SkillsPage(): JSX.Element {
  const { t } = useI18n();
  const state = useSkillsPageState();
  const builtin = state.snapshot.skills.filter((skill) => skill.source === "builtin");
  const user = state.snapshot.skills.filter((skill) => skill.source === "user");
  const reorder = useReorder({
    ids: user.map((skill) => skill.name),
    disabled: state.pending,
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
        {builtin.map((skill) => (
          <SkillCard
            key={skill.name}
            skill={skill}
            pending={pending}
            on_enabled={state.set_enabled}
          />
        ))}
        {builtin.length === 0 && <p className="skills-page__empty">{t("skills_page.empty")}</p>}
      </section>
      <section className="skills-page__group" aria-label={t("skills_page.user")}>
        <h2>{t("skills_page.user")}</h2>
        <DragDropProvider {...SORTABLE_PROVIDER_OPTIONS} {...reorder.events}>
          {reorder.ordered_ids.map((name, index) => (
            <SortableSkillCard
              key={name}
              skill={by_name.get(name)!}
              index={index}
              pending={pending}
              on_enabled={state.set_enabled}
            />
          ))}
        </DragDropProvider>
        {user.length === 0 && <p className="skills-page__empty">{t("skills_page.empty")}</p>}
      </section>
    </div>
  );
}

type SkillCardProps = {
  skill: AgentSkillEntry;
  pending: boolean;
  on_enabled: (source: AgentSkillSource, name: string, enabled: boolean) => Promise<void>;
  card_ref?: Ref<HTMLDivElement>;
  handle_ref?: Ref<HTMLButtonElement>;
  dragging?: boolean;
};

/** 两个来源共用卡片，用户技能由外层绑定拖拽。 */
function SkillCard(props: SkillCardProps): JSX.Element {
  const { t, locale } = useI18n();
  const skill = props.skill;
  const description = skill.displayDescriptions[locale];
  const drag_disabled = props.pending || skill.source === "builtin";
  const drag_label = t(drag_disabled ? "app.drag.disabled" : "app.drag.enabled");
  return (
    <Card
      ref={props.card_ref}
      className="skills-page__card"
      data-dragging={props.dragging || undefined}
    >
      <Tooltip>
        <TooltipTrigger render={<span className="skills-page__handle-slot" />}>
          <AppButton
            ref={props.handle_ref}
            variant="ghost"
            size="icon-sm"
            className="skills-page__handle"
            disabled={drag_disabled}
            aria-label={drag_label}
          >
            <GripVertical />
          </AppButton>
        </TooltipTrigger>
        <TooltipContent>{drag_label}</TooltipContent>
      </Tooltip>
      <h3 className="skills-page__heading">{skill.name}</h3>
      <div className="skills-page__actions">
        <BooleanSegmentedToggle
          aria_label={skill.name}
          value={skill.enabled}
          disabled={props.pending}
          on_value_change={(enabled) => {
            if (enabled !== skill.enabled) void props.on_enabled(skill.source, skill.name, enabled);
          }}
        />
        <AppButton
          variant="ghost"
          size="icon-sm"
          disabled
          aria-label={t("skills_page.settings")}
          title={t("skills_page.settings")}
        >
          <Settings />
        </AppButton>
      </div>
      <p className="skills-page__description">{description}</p>
    </Card>
  );
}

/** 将共享排序行为绑定到用户技能卡片。 */
function SortableSkillCard(props: SkillCardProps & { index: number }): JSX.Element {
  const { ref, handleRef, isDragSource } = useSortable({
    ...SORTABLE_OPTIONS,
    id: props.skill.name,
    index: props.index,
    disabled: props.pending,
  });
  return <SkillCard {...props} card_ref={ref} handle_ref={handleRef} dragging={isDragSource} />;
}

/** 页面保存管理快照，Agent 在新对话时加载可用技能。 */
function useSkillsPageState() {
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
    if (saving.current) return;
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
  }, [settings_snapshot, refresh]);

  /** 以服务端回包更新页面，提交失败时保留上次成功快照。 */
  async function save(path: string, body: Record<string, unknown>): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    reading.current?.abort();
    set_pending(true);
    try {
      const next = await api_fetch<AgentSkillsSnapshot>(path, body);
      if (!mounted.current) return;
      set_snapshot(next);
      set_status("ready");
      push_toast("success", t("skills_page.feedback.next_conversation"));
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
