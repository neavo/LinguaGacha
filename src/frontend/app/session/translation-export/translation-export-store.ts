export type TranslationExportReadyState = {
  phase: "ready";
  step: "warnings" | "files";
  warning_count: number;
  has_agent_files: boolean;
  has_supported_files: boolean;
  files_revision: number;
};

export type TranslationExportState =
  | { phase: "closed" }
  | { phase: "checking" }
  | TranslationExportReadyState
  | { phase: "check-failed" }
  | { phase: "exporting"; previous: TranslationExportReadyState };

/** 工程工作区卸载时，预检与导出继续更新各自工程的状态。 */
export function createTranslationExportStore() {
  let state: TranslationExportState = { phase: "closed" };
  let request_id = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applySnapshot: (next: TranslationExportState) => {
      state = next;
      for (const listener of listeners) listener();
    },
    nextRequest: () => ++request_id,
    isCurrent: (id: number) => id === request_id,
  };
}
