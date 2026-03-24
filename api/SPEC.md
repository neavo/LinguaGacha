# API SPEC

## 1. 范围

本文档描述第一阶段已经落地的本地 Core API 契约。

- 运行方式：UI 模式下由 `app.py` 启动 `ServerBootstrap`，在同一进程内开启本地 HTTP 服务线程
- CLI 模式：不启动本地 API 服务
- 调用风格：除事件流与健康检查外，统一使用 `POST + JSON body`
- 统一响应：`{"ok": true, "data": {...}}`
- 客户端边界：`api.Client` 在收到 HTTP JSON 后，会立即反序列化为 `model/Api/` 下的冻结对象；`ApiStateStore` 只缓存对象，不再缓存 `dict`

## 2. 基础接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/events/stream` | SSE 事件流 |

## 3. 工程接口

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/project/load` | `{"path": "..."}` | `{"project": {"path": "...", "loaded": true}}` |
| `POST` | `/api/project/create` | `{"source_path": "...", "output_path": "..."}` | `{"project": {...}}` |
| `POST` | `/api/project/snapshot` | `{}` | `{"project": {"path": "...", "loaded": bool}}` |
| `POST` | `/api/project/unload` | `{}` | `{"project": {"path": "", "loaded": false}}` |
| `POST` | `/api/project/extensions` | `{}` | `{"extensions": [".txt", ".json"]}` |
| `POST` | `/api/project/source-files` | `{"path": "..."}` | `{"source_files": ["..."]}` |
| `POST` | `/api/project/preview` | `{"path": "..."}` | `{"preview": {...}}` |

## 4. 任务接口

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/tasks/start-translation` | `{"mode": "NEW" \| "CONTINUE"}` | `{"accepted": true, "task": {...}}` |
| `POST` | `/api/tasks/stop-translation` | `{}` | `{"accepted": true, "task": {...}}` |
| `POST` | `/api/tasks/start-analysis` | `{"mode": "NEW" \| "CONTINUE" \| "RESET"}` | `{"accepted": true, "task": {...}}` |
| `POST` | `/api/tasks/stop-analysis` | `{}` | `{"accepted": true, "task": {...}}` |
| `POST` | `/api/tasks/snapshot` | `{}` 或 `{"task_type": "translation" \| "analysis"}` | `{"task": {...}}` |

`task` 快照当前包含以下稳定字段：

```json
{
  "task_type": "translation",
  "status": "IDLE",
  "busy": false,
  "request_in_flight_count": 0,
  "line": 0,
  "total_line": 0,
  "processed_line": 0,
  "error_line": 0,
  "total_tokens": 0,
  "total_output_tokens": 0,
  "total_input_tokens": 0,
  "time": 0.0,
  "start_time": 0.0
}
```

分析任务在可用时会额外返回 `analysis_candidate_count`。

## 5. 工作台接口

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/workbench/snapshot` | `{}` | `{"snapshot": {...}}` |
| `POST` | `/api/workbench/add-file` | `{"path": "..."}` | `{"accepted": true}` |
| `POST` | `/api/workbench/replace-file` | `{"rel_path": "...", "path": "..."}` | `{"accepted": true}` |
| `POST` | `/api/workbench/reset-file` | `{"rel_path": "..."}` | `{"accepted": true}` |
| `POST` | `/api/workbench/delete-file` | `{"rel_path": "..."}` | `{"accepted": true}` |
| `POST` | `/api/workbench/extensions` | `{}` | `{"extensions": [".txt", ".json"]}` |

`snapshot` 当前包含：

```json
{
  "file_count": 1,
  "total_items": 2,
  "translated": 1,
  "translated_in_past": 0,
  "untranslated": 1,
  "file_op_running": false,
  "entries": [
    {
      "rel_path": "script/a.txt",
      "item_count": 2,
      "file_type": "TXT"
    }
  ]
}
```

## 6. 设置接口

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/settings/app` | `{}` | `{"settings": {...}}` |
| `POST` | `/api/settings/update` | 任意允许的局部字段 | `{"settings": {...}}` |
| `POST` | `/api/settings/recent-projects/add` | `{"path": "...", "name": "..."}` | `{"settings": {...}}` |
| `POST` | `/api/settings/recent-projects/remove` | `{"path": "..."}` | `{"settings": {...}}` |

`settings` 快照当前覆盖第一阶段页面需要的字段：

- `theme`
- `app_language`
- `expert_mode`
- `proxy_url`
- `proxy_enable`
- `scale_factor`
- `source_language`
- `target_language`
- `project_save_mode`
- `project_fixed_path`
- `output_folder_open_on_finish`
- `request_timeout`
- `preceding_lines_threshold`
- `clean_ruby`
- `deduplication_in_trans`
- `deduplication_in_bilingual`
- `check_kana_residue`
- `check_hangeul_residue`
- `check_similarity`
- `write_translated_name_fields_to_file`
- `auto_process_prefix_suffix_preserved_text`
- `recent_projects`

## 7. SSE Topic

当前对外暴露以下 topic：

| topic | 说明 |
| --- | --- |
| `project.changed` | 工程加载态变化 |
| `task.status_changed` | 翻译/分析任务状态变化 |
| `task.progress_changed` | 翻译/分析任务进度变化 |
| `workbench.snapshot_changed` | 工作台快照变化 |
| `settings.changed` | 设置更新通知 |

统一事件包格式：

```json
{
  "event_id": "evt_1",
  "topic": "task.progress_changed",
  "timestamp": "2026-03-24T12:34:56+08:00",
  "payload": {
    "task_type": "translation"
  }
}
```

## 8. 客户端对象边界

本地 HTTP API 仍然以 JSON / `dict` 作为边界协议，但客户端内部已经统一切换到对象化响应。

### 8.1 模型目录

客户端内部新增以下冻结对象：

- `model/Api/SettingsModels.py`
  - `AppSettingsSnapshot`
  - `RecentProjectEntry`
- `model/Api/ProjectModels.py`
  - `ProjectSnapshot`
  - `ProjectPreview`
- `model/Api/WorkbenchModels.py`
  - `WorkbenchSnapshot`
  - `WorkbenchFileEntry`
- `model/Api/TaskModels.py`
  - `TaskSnapshot`
  - `TaskStatusUpdate`
  - `TaskProgressUpdate`

### 8.2 客户端返回值约定

- `SettingsApiClient` 对外返回 `AppSettingsSnapshot`
- `ProjectApiClient` 对外返回 `ProjectSnapshot` / `ProjectPreview`
- `WorkbenchApiClient` 对外返回 `WorkbenchSnapshot`
- `TaskApiClient` 对外返回 `TaskSnapshot`

### 8.3 状态仓库约定

- `ApiStateStore.project_snapshot` 只缓存 `ProjectSnapshot`
- `ApiStateStore.task_snapshot` 只缓存 `TaskSnapshot`
- SSE 增量事件进入 `ApiStateStore` 后，会先解码为 `TaskStatusUpdate` / `TaskProgressUpdate` 再合并
- 页面层不得再直接依赖 `response.get(...)`、`snapshot.get(...)` 读取 API 响应

## 9. UI 边界

以下页面已要求只通过 `api.Client` 与 `ApiStateStore` 访问 Core：

- `frontend/AppFluentWindow.py`
- `frontend/ProjectPage.py`
- `frontend/Translation/TranslationPage.py`
- `frontend/Analysis/AnalysisPage.py`
- `frontend/Workbench/WorkbenchPage.py`
- `frontend/AppSettingsPage.py`
- `frontend/Setting/BasicSettingsPage.py`
- `frontend/Setting/ExpertSettingsPage.py`

这些页面不得再直接导入：

- `module.Data.DataManager`
- `module.Engine.Engine`
- `base.EventManager`
- `module.Config`
