import { type JSX, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useDesktopState } from "@frontend/app/state/use-desktop-state";
import type { ProjectSessionUiStateKey } from "@frontend/app/session/project-session-ui-state-context";
import {
  type ProjectSessionUiStateContextValue,
  ProjectSessionUiStateContext,
} from "./project-session-ui-state-context";

// 只保存当前项目 session 内的轻量 UI 状态，不参与缓存 barrier。
export function ProjectSessionUiStateProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot } = useDesktopState();
  // 用内存 Map 保存当前项目的 UI 状态，项目身份变化时整体清空。
  const ui_state_by_key_ref = useRef<Map<ProjectSessionUiStateKey, unknown>>(new Map());
  const active_project_path = project_snapshot.loaded ? project_snapshot.path : "";
  // 让 Provider 在 render 阶段同步切断旧项目状态，避免子组件首帧读旧值。
  const previous_project_path_ref = useRef(active_project_path);

  if (previous_project_path_ref.current !== active_project_path) {
    previous_project_path_ref.current = active_project_path;
    ui_state_by_key_ref.current.clear();
  }

  // 按页面 key 读取快照，未知页面统一返回 null。
  const get_page_ui_state = useCallback(
    <UiState,>(key: ProjectSessionUiStateKey): UiState | null => {
      return (ui_state_by_key_ref.current.get(key) as UiState | undefined) ?? null;
    },
    [],
  );

  // 用完整快照覆盖旧值，避免调用点拼接局部状态。
  const set_page_ui_state = useCallback(
    <UiState,>(key: ProjectSessionUiStateKey, ui_state: UiState): void => {
      ui_state_by_key_ref.current.set(key, ui_state);
    },
    [],
  );

  // 支持原子读改写，updater 返回 null 时删除当前页面状态。
  const update_page_ui_state = useCallback(
    <UiState,>(
      key: ProjectSessionUiStateKey,
      updater: (previous_ui_state: UiState | null) => UiState | null,
    ): void => {
      const previous_ui_state =
        (ui_state_by_key_ref.current.get(key) as UiState | undefined) ?? null;
      const next_ui_state = updater(previous_ui_state);
      if (next_ui_state === null) {
        ui_state_by_key_ref.current.delete(key);
        return;
      }

      ui_state_by_key_ref.current.set(key, next_ui_state);
    },
    [],
  );

  // 只清指定页面，保留同项目内其它页面的轻量 UI 状态。
  const clear_page_ui_state = useCallback((key: ProjectSessionUiStateKey): void => {
    ui_state_by_key_ref.current.delete(key);
  }, []);

  // 固定公开方法身份，降低 Provider 子树无意义重渲染。
  const context_value = useMemo<ProjectSessionUiStateContextValue>(() => {
    return {
      clear_page_ui_state,
      get_page_ui_state,
      set_page_ui_state,
      update_page_ui_state,
    };
  }, [clear_page_ui_state, get_page_ui_state, set_page_ui_state, update_page_ui_state]);

  return (
    <ProjectSessionUiStateContext.Provider value={context_value}>
      {props.children}
    </ProjectSessionUiStateContext.Provider>
  );
}
