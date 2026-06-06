import { useRef } from "react";

import type { ProjectChangeSignal } from "@frontend/app/state/desktop-state-context";
import type { ProjectStage } from "@frontend/app/state/desktop-project-change-types";

/**
 * 判断项目变更是否命中调用方关心的 section，调用方无需关心 section 去重细节。
 */
export function hasProjectChangeSections(
  signal: Pick<ProjectChangeSignal, "updated_sections">,
  sections: readonly ProjectStage[],
): boolean {
  const section_set = new Set(sections);
  return signal.updated_sections.some((section) => section_set.has(section));
}

/**
 * 把项目变更信号收窄成可放进 effect 依赖数组的相关变更序号。
 */
export function resolveProjectChangeSeqForSections(
  signal: ProjectChangeSignal,
  sections: readonly ProjectStage[],
): number | null {
  if (signal.seq === 0) {
    return null;
  }

  return hasProjectChangeSections(signal, sections) ? signal.seq : null;
}

/**
 * 页面 hook 保留最近一次相关 seq，避免无关 section 把依赖值推进成 null 后触发重读。
 */
export function useProjectChangeSeqForSections(
  signal: ProjectChangeSignal,
  sections: readonly ProjectStage[],
): number | null {
  // 只有命中目标 section 才刷新 ref，保持 effect 依赖值对无关事件稳定。
  const stable_seq_ref = useRef<number | null>(null);
  const resolved_seq = resolveProjectChangeSeqForSections(signal, sections);
  if (resolved_seq !== null) {
    stable_seq_ref.current = resolved_seq;
  }

  return stable_seq_ref.current;
}
