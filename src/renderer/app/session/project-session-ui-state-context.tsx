import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";

// ProjectSessionUiStateKey 是 session UI 状态的命名空间，避免不同页面互相覆盖轻量状态。
export type ProjectSessionUiStateKey =
  | "proofreading"
  | "quality:glossary"
  | "quality:text_preserve"
  | "quality:pre_replacement"
  | "quality:post_replacement";

// ProjectSessionTableUiState 只保存可跨路由恢复的表格交互状态，不承载项目事实。
export type ProjectSessionTableUiState<FilterState, SortState> = {
  filter_state: FilterState;
  sort_state: SortState;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
};

// ProjectSessionTableSelectionState 是表格选区写入的最小状态包，供失败回滚复用。
export type ProjectSessionTableSelectionState = Pick<
  ProjectSessionTableUiState<unknown, unknown>,
  "selected_row_ids" | "active_row_id" | "anchor_row_id"
>;

// ProjectSessionTableUiStateOptions 把页面特有的默认值、克隆和归一化规则交给调用方。
type ProjectSessionTableUiStateOptions<FilterState, SortState> = {
  key: ProjectSessionUiStateKey;
  create_default_filter_state: () => FilterState;
  create_default_sort_state: () => SortState;
  clone_filter_state: (filter_state: FilterState) => FilterState;
  normalize_sort_state: (sort_state: SortState) => SortState;
};

// ProjectSessionTableUiStateUpdateOptions 允许页面在项目切换等场景更新快照但不写回旧 session。
type ProjectSessionTableUiStateUpdateOptions = {
  persist?: boolean;
};

// ProjectSessionTableUiStateController 是页面状态 hook 与 session UI 状态之间的唯一表格适配器。
export type ProjectSessionTableUiStateController<FilterState, SortState> = {
  initial_ui_state: ProjectSessionTableUiState<FilterState, SortState> | null;
  filter_state: FilterState;
  sort_state: SortState;
  selected_row_ids: string[];
  active_row_id: string | null;
  anchor_row_id: string | null;
  restore_scroll_row_id: string | null;
  filter_state_ref: MutableRefObject<FilterState>;
  sort_state_ref: MutableRefObject<SortState>;
  selected_row_ids_ref: MutableRefObject<string[]>;
  active_row_id_ref: MutableRefObject<string | null>;
  anchor_row_id_ref: MutableRefObject<string | null>;
  set_filter_state: (
    filter_state: FilterState,
    options?: ProjectSessionTableUiStateUpdateOptions,
  ) => void;
  set_sort_state: (
    sort_state: SortState,
    options?: ProjectSessionTableUiStateUpdateOptions,
  ) => void;
  set_selection_state: (
    selection_state: ProjectSessionTableSelectionState,
    options?: ProjectSessionTableUiStateUpdateOptions,
  ) => void;
  clear_selection_state: (options?: ProjectSessionTableUiStateUpdateOptions) => void;
  restore_selection_state: (
    selection_state: ProjectSessionTableSelectionState,
    options?: ProjectSessionTableUiStateUpdateOptions,
  ) => void;
  reset_table_state: (options?: ProjectSessionTableUiStateUpdateOptions) => void;
  write_page_ui_state: (
    patch?: Partial<ProjectSessionTableUiState<FilterState, SortState>>,
  ) => void;
};

// resolve_project_session_table_restore_scroll_row_id 保持多选恢复时使用首个选中行的稳定锚点。
export function resolve_project_session_table_restore_scroll_row_id(
  ui_state: Pick<
    ProjectSessionTableUiState<unknown, unknown>,
    "selected_row_ids" | "active_row_id" | "anchor_row_id"
  > | null,
): string | null {
  if (ui_state === null) {
    return null;
  }

  if (ui_state.selected_row_ids.length > 1) {
    return ui_state.selected_row_ids[0] ?? ui_state.active_row_id;
  }

  return ui_state.selected_row_ids[0] ?? ui_state.active_row_id ?? ui_state.anchor_row_id;
}

// clone_project_session_table_ui_state 在读取 session 快照时切断可变引用，避免页面间共享数组对象。
function clone_project_session_table_ui_state<FilterState, SortState>(
  ui_state: ProjectSessionTableUiState<FilterState, SortState>,
  options: Pick<
    ProjectSessionTableUiStateOptions<FilterState, SortState>,
    "clone_filter_state" | "normalize_sort_state"
  >,
): ProjectSessionTableUiState<FilterState, SortState> {
  return {
    filter_state: options.clone_filter_state(ui_state.filter_state),
    sort_state: options.normalize_sort_state(ui_state.sort_state),
    selected_row_ids: [...ui_state.selected_row_ids],
    active_row_id: ui_state.active_row_id,
    anchor_row_id: ui_state.anchor_row_id,
  };
}

// ProjectSessionUiStateContextValue 是当前项目 session 内页面 UI 状态的最小读写契约。
type ProjectSessionUiStateContextValue = {
  get_page_ui_state: <UiState>(key: ProjectSessionUiStateKey) => UiState | null;
  set_page_ui_state: <UiState>(key: ProjectSessionUiStateKey, ui_state: UiState) => void;
  update_page_ui_state: <UiState>(
    key: ProjectSessionUiStateKey,
    updater: (previous_ui_state: UiState | null) => UiState | null,
  ) => void;
  clear_page_ui_state: (key: ProjectSessionUiStateKey) => void;
};

// ProjectSessionUiStateContext 不给默认假实现，缺少 Provider 时必须立即暴露接入错误。
const ProjectSessionUiStateContext = createContext<ProjectSessionUiStateContextValue | null>(null);

// ProjectSessionUiStateProvider 只保存当前项目 session 内的轻量 UI 状态，不参与缓存 barrier。
export function ProjectSessionUiStateProvider(props: { children: ReactNode }): JSX.Element {
  const { project_snapshot } = useDesktopRuntime();
  // ui_state_by_key_ref 用内存 Map 保存当前项目的 UI 状态，项目身份变化时整体清空。
  const ui_state_by_key_ref = useRef<Map<ProjectSessionUiStateKey, unknown>>(new Map());
  const active_project_path = project_snapshot.loaded ? project_snapshot.path : "";
  // previous_project_path_ref 让 Provider 在 render 阶段同步切断旧项目状态，避免子组件首帧读旧值。
  const previous_project_path_ref = useRef(active_project_path);

  if (previous_project_path_ref.current !== active_project_path) {
    previous_project_path_ref.current = active_project_path;
    ui_state_by_key_ref.current.clear();
  }

  // get_page_ui_state 按页面 key 读取快照，未知页面统一返回 null。
  const get_page_ui_state = useCallback(
    <UiState,>(key: ProjectSessionUiStateKey): UiState | null => {
      return (ui_state_by_key_ref.current.get(key) as UiState | undefined) ?? null;
    },
    [],
  );

  // set_page_ui_state 用完整快照覆盖旧值，避免调用点拼接局部状态。
  const set_page_ui_state = useCallback(
    <UiState,>(key: ProjectSessionUiStateKey, ui_state: UiState): void => {
      ui_state_by_key_ref.current.set(key, ui_state);
    },
    [],
  );

  // update_page_ui_state 支持原子读改写，updater 返回 null 时删除当前页面状态。
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

  // clear_page_ui_state 只清指定页面，保留同项目内其它页面的轻量 UI 状态。
  const clear_page_ui_state = useCallback((key: ProjectSessionUiStateKey): void => {
    ui_state_by_key_ref.current.delete(key);
  }, []);

  // context_value 固定公开方法身份，降低 Provider 子树无意义重渲染。
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

// useProjectSessionUiState 是页面访问 session UI 状态的唯一入口，避免直接接触内部 Map。
export function useProjectSessionUiState(): ProjectSessionUiStateContextValue {
  const context_value = useContext(ProjectSessionUiStateContext);

  if (context_value === null) {
    throw new Error("useProjectSessionUiState must be used inside ProjectSessionUiStateProvider.");
  }

  return context_value;
}

// useProjectSessionTableUiState 封装表格状态恢复、持久化和项目切换重置的共享规则。
export function useProjectSessionTableUiState<FilterState, SortState>(
  options: ProjectSessionTableUiStateOptions<FilterState, SortState>,
): ProjectSessionTableUiStateController<FilterState, SortState> {
  const {
    key,
    create_default_filter_state,
    create_default_sort_state,
    clone_filter_state,
    normalize_sort_state,
  } = options;
  const { get_page_ui_state, set_page_ui_state } = useProjectSessionUiState();
  // initial_ui_state_ref 只在首帧读取 session 快照，避免后续渲染把本页编辑中的状态覆盖掉。
  const initial_ui_state_ref = useRef<ProjectSessionTableUiState<FilterState, SortState> | null>(
    null,
  );
  const initial_ui_state_loaded_ref = useRef(false);

  if (!initial_ui_state_loaded_ref.current) {
    const stored_ui_state =
      get_page_ui_state<ProjectSessionTableUiState<FilterState, SortState>>(key);
    initial_ui_state_ref.current =
      stored_ui_state === null
        ? null
        : clone_project_session_table_ui_state(stored_ui_state, {
            clone_filter_state,
            normalize_sort_state,
          });
    initial_ui_state_loaded_ref.current = true;
  }

  const [filter_state, set_filter_state_snapshot] = useState<FilterState>(() => {
    return initial_ui_state_ref.current === null
      ? create_default_filter_state()
      : clone_filter_state(initial_ui_state_ref.current.filter_state);
  });
  const [sort_state, set_sort_state_snapshot] = useState<SortState>(() => {
    return initial_ui_state_ref.current === null
      ? create_default_sort_state()
      : normalize_sort_state(initial_ui_state_ref.current.sort_state);
  });
  const [selected_row_ids, set_selected_row_ids_snapshot] = useState<string[]>(() => {
    return initial_ui_state_ref.current?.selected_row_ids ?? [];
  });
  const [active_row_id, set_active_row_id_snapshot] = useState<string | null>(() => {
    return initial_ui_state_ref.current?.active_row_id ?? null;
  });
  const [anchor_row_id, set_anchor_row_id_snapshot] = useState<string | null>(() => {
    return initial_ui_state_ref.current?.anchor_row_id ?? null;
  });
  const [restore_scroll_row_id, set_restore_scroll_row_id_snapshot] = useState<string | null>(
    () => {
      return resolve_project_session_table_restore_scroll_row_id(initial_ui_state_ref.current);
    },
  );

  // 这些 ref 是 session 写回的同步事实源，解决 React state 异步批处理导致的旧快照问题。
  const filter_state_ref = useRef(filter_state);
  const sort_state_ref = useRef(sort_state);
  const selected_row_ids_ref = useRef(selected_row_ids);
  const active_row_id_ref = useRef(active_row_id);
  const anchor_row_id_ref = useRef(anchor_row_id);
  const restore_scroll_row_id_ref = useRef(restore_scroll_row_id);

  // set_restore_scroll_row_id 同步 ref 与 state，保证恢复滚动只在初始快照阶段生效。
  const set_restore_scroll_row_id = useCallback((next_row_id: string | null): void => {
    restore_scroll_row_id_ref.current = next_row_id;
    set_restore_scroll_row_id_snapshot(next_row_id);
  }, []);

  // write_page_ui_state 写入完整快照，避免 session 内留下半更新的筛选、排序或选区组合。
  const write_page_ui_state = useCallback(
    (patch: Partial<ProjectSessionTableUiState<FilterState, SortState>> = {}): void => {
      set_page_ui_state<ProjectSessionTableUiState<FilterState, SortState>>(key, {
        filter_state: clone_filter_state(patch.filter_state ?? filter_state_ref.current),
        sort_state: normalize_sort_state(patch.sort_state ?? sort_state_ref.current),
        selected_row_ids: [...(patch.selected_row_ids ?? selected_row_ids_ref.current)],
        active_row_id:
          patch.active_row_id === undefined ? active_row_id_ref.current : patch.active_row_id,
        anchor_row_id:
          patch.anchor_row_id === undefined ? anchor_row_id_ref.current : patch.anchor_row_id,
      });
    },
    [clone_filter_state, key, normalize_sort_state, set_page_ui_state],
  );

  // set_filter_state 同步 state/ref/session，保证筛选变更能跨路由恢复。
  const set_filter_state = useCallback(
    (
      next_filter_state: FilterState,
      update_options: ProjectSessionTableUiStateUpdateOptions = {},
    ): void => {
      const cloned_filter_state = clone_filter_state(next_filter_state);
      filter_state_ref.current = cloned_filter_state;
      set_filter_state_snapshot(cloned_filter_state);
      if (update_options.persist ?? true) {
        write_page_ui_state({ filter_state: cloned_filter_state });
      }
    },
    [clone_filter_state, write_page_ui_state],
  );

  // set_sort_state 先归一化再写入，避免无效列 id 在 session 内长期保留。
  const set_sort_state = useCallback(
    (
      next_sort_state: SortState,
      update_options: ProjectSessionTableUiStateUpdateOptions = {},
    ): void => {
      const normalized_sort_state = normalize_sort_state(next_sort_state);
      sort_state_ref.current = normalized_sort_state;
      set_sort_state_snapshot(normalized_sort_state);
      if (update_options.persist ?? true) {
        write_page_ui_state({ sort_state: normalized_sort_state });
      }
    },
    [normalize_sort_state, write_page_ui_state],
  );

  // set_selection_state 是所有选区变更入口，用户操作后会取消首帧恢复滚动目标。
  const set_selection_state = useCallback(
    (
      selection_state: ProjectSessionTableSelectionState,
      update_options: ProjectSessionTableUiStateUpdateOptions = {},
    ): void => {
      const next_selected_row_ids = [...selection_state.selected_row_ids];
      selected_row_ids_ref.current = next_selected_row_ids;
      active_row_id_ref.current = selection_state.active_row_id;
      anchor_row_id_ref.current = selection_state.anchor_row_id;
      set_restore_scroll_row_id(null);
      set_selected_row_ids_snapshot(next_selected_row_ids);
      set_active_row_id_snapshot(selection_state.active_row_id);
      set_anchor_row_id_snapshot(selection_state.anchor_row_id);
      if (update_options.persist ?? true) {
        write_page_ui_state({
          selected_row_ids: next_selected_row_ids,
          active_row_id: selection_state.active_row_id,
          anchor_row_id: selection_state.anchor_row_id,
        });
      }
    },
    [set_restore_scroll_row_id, write_page_ui_state],
  );

  // clear_selection_state 保持清选区与普通选区写入走同一套 session 同步逻辑。
  const clear_selection_state = useCallback(
    (update_options: ProjectSessionTableUiStateUpdateOptions = {}): void => {
      set_selection_state(
        {
          selected_row_ids: [],
          active_row_id: null,
          anchor_row_id: null,
        },
        update_options,
      );
    },
    [set_selection_state],
  );

  // restore_selection_state 给保存失败回滚使用，避免调用点重复维护三段选区字段。
  const restore_selection_state = useCallback(
    (
      selection_state: ProjectSessionTableSelectionState,
      update_options: ProjectSessionTableUiStateUpdateOptions = {},
    ): void => {
      set_selection_state(selection_state, update_options);
    },
    [set_selection_state],
  );

  // reset_table_state 用于项目身份切换，重置本地状态但可按场景跳过旧 session 写回。
  const reset_table_state = useCallback(
    (update_options: ProjectSessionTableUiStateUpdateOptions = {}): void => {
      const next_filter_state = clone_filter_state(create_default_filter_state());
      const next_sort_state = normalize_sort_state(create_default_sort_state());
      filter_state_ref.current = next_filter_state;
      sort_state_ref.current = next_sort_state;
      selected_row_ids_ref.current = [];
      active_row_id_ref.current = null;
      anchor_row_id_ref.current = null;
      set_restore_scroll_row_id(null);
      set_filter_state_snapshot(next_filter_state);
      set_sort_state_snapshot(next_sort_state);
      set_selected_row_ids_snapshot([]);
      set_active_row_id_snapshot(null);
      set_anchor_row_id_snapshot(null);
      if (update_options.persist ?? true) {
        write_page_ui_state({
          filter_state: next_filter_state,
          sort_state: next_sort_state,
          selected_row_ids: [],
          active_row_id: null,
          anchor_row_id: null,
        });
      }
    },
    [
      clone_filter_state,
      create_default_filter_state,
      create_default_sort_state,
      normalize_sort_state,
      set_restore_scroll_row_id,
      write_page_ui_state,
    ],
  );

  return {
    initial_ui_state: initial_ui_state_ref.current,
    filter_state,
    sort_state,
    selected_row_ids,
    active_row_id,
    anchor_row_id,
    restore_scroll_row_id,
    filter_state_ref,
    sort_state_ref,
    selected_row_ids_ref,
    active_row_id_ref,
    anchor_row_id_ref,
    set_filter_state,
    set_sort_state,
    set_selection_state,
    clear_selection_state,
    restore_selection_state,
    reset_table_state,
    write_page_ui_state,
  };
}
