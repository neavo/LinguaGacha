import { createBatchTaskSnapshotStore } from "./batch-task-snapshot-store";
import { createBatchTranslationSnapshotStore } from "./batch-translation-snapshot-store";
import { createProjectChangeSignalStore } from "./project-change-signal-store";
import {
  type JSX,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api_fetch, api_get } from "@frontend/app/desktop/desktop-api";
import { subscribe_desktop_events } from "@frontend/app/desktop/desktop-events";
import { push_error_toast, push_toast } from "@frontend/app/feedback/desktop-toast";
import { create_text_resolver } from "@shared/i18n";
import {
  resolve_app_locale,
  resolve_system_app_language,
  type AppLanguage,
} from "@domain/app-language";
import { is_json_record } from "@domain/json";
import { normalize_setting_snapshot } from "@domain/setting";
import type { BatchTranslationSnapshot } from "@domain/batch-translation";
import { MODEL_AUTH_CHANGED_EVENT_TOPIC, type ChatGPTAuthSnapshot } from "@shared/model-auth";
import { MODEL_CATALOG_UPDATED_EVENT_TOPIC } from "@shared/model-catalog";
import { PROJECT_DATA_SECTIONS, PROJECT_CHANGE_EVENT_TOPIC } from "@shared/project-event";
import { RUNTIME_ACTIVITY_EVENT_TOPIC } from "@shared/runtime-activity";
import { apply_model_catalog_revision } from "./model-catalog-store";
import { apply_model_auth_snapshot } from "./model-auth-store";
import { normalize_project_change_event } from "./desktop-project-change-normalizer";
import { normalize_section_revisions } from "./desktop-event-payload";
import { useDesktopRecovery } from "./desktop-recovery";
import { useProjectWriteCommitter, type ProjectWriteResult } from "./desktop-project-write";
import { createRuntimeActivityStore } from "./runtime-activity-store";
import { type ProjectStore, ProjectStoreRegistry } from "./project-store-registry";
import {
  DesktopStateContext,
  DesktopStateStoresContext,
  type ProjectSnapshot,
  type SettingsSnapshotPayload,
} from "./desktop-state-context";

const EMPTY_PROJECT: ProjectSnapshot = { path: "", loaded: false, file_count: 0, languages: null };

/** 全局状态和工程注册表共用一次连接，工程事件永远发给原工程。 */
export function DesktopStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [empty] = useState(() => ({
    batch_task: createBatchTaskSnapshotStore(),
    batch_translation: createBatchTranslationSnapshotStore(),
    projectChange: createProjectChangeSignalStore(),
  }));
  const [runtime] = useState(createRuntimeActivityStore);
  const [status, set_status] = useState<"loading" | "ready" | "error">("loading");
  const [settings, set_settings] = useState(() =>
    normalize_setting_snapshot({
      app_language: resolve_system_app_language(window.navigator.languages),
    }),
  );
  const app_language = useRef(settings.app_language);
  app_language.current = settings.app_language;
  const [registry] = useState(
    () =>
      new ProjectStoreRegistry((error, kind) => {
        const t = create_text_resolver(resolve_app_locale(app_language.current));
        push_error_toast(
          t(kind === "restore" ? "agent_page.error.restore" : "agent_page.error.decision"),
          error,
        );
      }),
  );
  const [active_id, set_active_id] = useState<string>();
  const [, set_version] = useState(0);
  const [language_updating, set_language_updating] = useState(false);
  const initial_request = useRef(0);
  const projects_request = useRef(0);
  useEffect(
    () => () => {
      projects_request.current++;
      registry.dispose();
    },
    [registry],
  );
  const notify = useCallback(() => set_version((version) => version + 1), []);
  const store = active_id === undefined ? undefined : registry.get(active_id);
  const project_snapshot = store?.snapshot ?? EMPTY_PROJECT;

  const apply_settings_snapshot = useCallback((payload: SettingsSnapshotPayload) => {
    const next = normalize_setting_snapshot(payload.settings);
    set_settings(next);
    return next;
  }, []);

  const refresh_settings = useCallback(
    async () =>
      apply_settings_snapshot(await api_fetch<SettingsSnapshotPayload>("/api/settings/app", {})),
    [apply_settings_snapshot],
  );

  const refresh_runtime = useCallback(async () => {
    const payload = await api_fetch<{ runtime?: unknown }>("/api/runtime/snapshot", {});
    runtime.applySnapshot(payload.runtime);
    return runtime.getSnapshot();
  }, [runtime]);

  const refresh_tasks = useCallback(
    async (project: ProjectStore): Promise<BatchTranslationSnapshot> => {
      const payload = await api_fetch<Record<string, unknown>>("/api/batch-task/snapshot", {
        projectId: project.snapshot.projectId,
      });
      project.update_task(payload);
      return project.batch_translation.getSnapshot();
    },
    [],
  );

  const refresh_projects = useCallback(async () => {
    const token = ++projects_request.current;
    const payload = await api_get<unknown>("/api/session/projects");
    if (token !== projects_request.current) return registry.values();
    registry.replace(payload);
    const projects = registry.values();
    set_active_id((current) =>
      current && registry.get(current) ? current : projects[0]?.snapshot.projectId,
    );
    notify();
    await Promise.all(projects.map(refresh_tasks));
    return projects;
  }, [registry, notify, refresh_tasks]);

  const select_project = useCallback(
    (projectId: string) => {
      if (registry.get(projectId)) set_active_id(projectId);
    },
    [registry],
  );

  const refresh_snapshot = useCallback(
    async (project: ProjectStore) => {
      const { projectId } = project.snapshot;
      const payload = await api_fetch("/api/session/project/snapshot", { projectId });
      if (registry.get(projectId) === project) {
        registry.update(payload);
        notify();
      }
      return project.snapshot;
    },
    [registry, notify],
  );

  const refresh_project_snapshot = useCallback(
    async () => (store ? refresh_snapshot(store) : EMPTY_PROJECT),
    [store, refresh_snapshot],
  );
  const refresh_batch_translation = useCallback(
    async () => (store ? refresh_tasks(store) : empty.batch_translation.getSnapshot()),
    [store, empty, refresh_tasks],
  );

  const refresh_manifest = useCallback(
    async (project: ProjectStore) => {
      const { projectId } = project.snapshot;
      const payload = await api_fetch<Record<string, unknown>>("/api/session/project/manifest", {
        projectId,
      });
      if (registry.get(projectId) !== project) return;
      registry.update(payload);
      project.publish_change({
        applied: true,
        source: "refresh_project_state",
        projectRevision: typeof payload.projectRevision === "number" ? payload.projectRevision : 0,
        sectionRevisions: normalize_section_revisions(payload.sectionRevisions) ?? {},
        updatedSections: [...PROJECT_DATA_SECTIONS],
        qualityStatisticsScope: "all",
      });
      notify();
    },
    [registry, notify],
  );

  const refresh_project_state = useCallback(async () => {
    if (store) await refresh_manifest(store);
  }, [store, refresh_manifest]);

  const recovery = useDesktopRecovery({
    project_loaded: project_snapshot.loaded,
    project_path: project_snapshot.path,
    refresh_project_state,
    refresh_batch_translation,
  });
  const { report_state_error } = recovery;

  const apply_changes = useCallback(
    async (result: ProjectWriteResult) => {
      const changed = new Set<ProjectStore>();
      for (const event of result.changes) {
        const project = registry.get(event.projectId);
        if (
          project?.apply_event(event) &&
          event.updatedSections.some((section) => section === "project" || section === "files")
        )
          changed.add(project);
      }
      await Promise.all([...changed].map(refresh_snapshot));
    },
    [refresh_snapshot, registry],
  );
  const commit_project_write = useProjectWriteCommitter({
    applyProjectWriteChanges: apply_changes,
    recovery,
  });

  const load_initial_state = useCallback(async () => {
    const token = ++initial_request.current;
    set_status("loading");
    try {
      await Promise.all([refresh_projects(), refresh_runtime(), refresh_settings()]);
      if (token === initial_request.current) set_status("ready");
    } catch (error) {
      if (token !== initial_request.current) return;
      report_state_error(error, {
        source: "state-recovery",
        context: { stage: "load_initial_state" },
      });
      set_status("error");
    }
  }, [refresh_projects, refresh_runtime, refresh_settings, report_state_error]);

  useEffect(() => {
    void load_initial_state();
    return () => {
      initial_request.current++;
    };
  }, [load_initial_state]);

  const report_stream_error = useEffectEvent((error: unknown) =>
    report_state_error(error, { source: "sse" }),
  );
  const catalog = useEffectEvent((payload: unknown) => {
    if (apply_model_catalog_revision(payload))
      push_toast(
        "success",
        create_text_resolver(resolve_app_locale(settings.app_language))(
          "app.model.catalog_updated",
        ),
      );
  });

  useEffect(() => {
    let opened = false;
    const dispatch =
      (apply: (payload: Record<string, unknown>) => void | Promise<void>) =>
      (payload: Record<string, unknown>) => {
        void Promise.resolve()
          .then(() => apply(payload))
          .catch(report_stream_error);
      };
    const unsubscribe = subscribe_desktop_events({
      onOpen: () => {
        void api_get("/api/models/catalog/snapshot")
          .then((payload) => catalog(payload))
          .catch(report_stream_error);
        void api_fetch<{ snapshot: ChatGPTAuthSnapshot }>("/api/models/auth/snapshot", {})
          .then(({ snapshot }) => apply_model_auth_snapshot(snapshot))
          .catch(report_stream_error);
        if (opened)
          void Promise.all([refresh_projects(), refresh_runtime(), refresh_settings()])
            .then(([projects]) => Promise.all(projects.map(refresh_manifest)))
            .catch(report_stream_error);
        opened = true;
      },
      events: {
        [PROJECT_CHANGE_EVENT_TOPIC]: dispatch(async (payload) => {
          const event = normalize_project_change_event(payload);
          if (event) await apply_changes({ accepted: true, changes: [event] });
          else if (typeof payload.projectId === "string") {
            const project = registry.get(payload.projectId);
            if (project) await refresh_manifest(project);
          }
        }),
        "batch_task.snapshot_changed": dispatch((payload) => {
          if (typeof payload.projectId === "string")
            registry.get(payload.projectId)?.update_task(payload);
        }),
        "settings.changed": dispatch((payload) => {
          if (is_json_record(payload.settings))
            apply_settings_snapshot(payload as SettingsSnapshotPayload);
          else return refresh_settings().then(() => {});
        }),
        [RUNTIME_ACTIVITY_EVENT_TOPIC]: dispatch((payload) =>
          runtime.applySnapshot(payload.runtime),
        ),
        [MODEL_AUTH_CHANGED_EVENT_TOPIC]: dispatch((payload) => {
          apply_model_auth_snapshot(payload.snapshot as ChatGPTAuthSnapshot);
        }),
        [MODEL_CATALOG_UPDATED_EVENT_TOPIC]: dispatch((payload) => catalog(payload)),
      },
    });
    return unsubscribe;
  }, [
    apply_changes,
    apply_settings_snapshot,
    refresh_manifest,
    refresh_projects,
    refresh_runtime,
    refresh_settings,
    registry,
    runtime,
  ]);

  async function update_app_language(language: AppLanguage) {
    set_language_updating(true);
    try {
      const result = await api_fetch<SettingsSnapshotPayload>("/api/settings/update", {
        app_language: language,
      });
      return apply_settings_snapshot(result);
    } finally {
      set_language_updating(false);
    }
  }

  return (
    <DesktopStateStoresContext.Provider value={{ ...(store ?? empty), runtime }}>
      <DesktopStateContext.Provider
        value={{
          initial_state_status: status,
          load_initial_state,
          settings_snapshot: settings,
          project_snapshot,
          project_session_status: store ? "ready" : "idle",
          is_app_language_updating: language_updating,
          apply_settings_snapshot,
          refresh_project_snapshot,
          refresh_project_state,
          commit_project_write,
          update_app_language,
          refresh_settings,
          refresh_batch_translation,
          refresh_runtime,
          open_projects: registry.values(),
          active_project: store,
          select_project,
          refresh_projects,
        }}
      >
        {children}
      </DesktopStateContext.Provider>
    </DesktopStateStoresContext.Provider>
  );
}
