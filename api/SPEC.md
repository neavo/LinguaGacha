# API SPEC

## 1. 范围

本文档描述第一阶段已经落地的本地 Core API 契约，以及第二阶段 `Quality` / `Proofreading` 分离后已经稳定的 HTTP、SSE 与 UI 边界。

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

## 7. Quality 接口

### 7.1 质量规则

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/quality/rules/snapshot` | `{"rule_type": "glossary"}` | `{"snapshot": {...}}` |
| `POST` | `/api/quality/rules/update-meta` | `{"rule_type": "glossary", "expected_revision": 2, "meta": {"enabled": false}}` | `{"snapshot": {...}}` |
| `POST` | `/api/quality/rules/save-entries` | `{"rule_type": "glossary", "expected_revision": 2, "entries": [{...}]}` | `{"snapshot": {...}}` |
| `POST` | `/api/quality/rules/import` | `{"rule_type": "glossary", "expected_revision": 2, "path": "..."}` | `{"entries": [{...}]}` |
| `POST` | `/api/quality/rules/export` | `{"rule_type": "glossary", "path": "...", "entries": [{...}]}` | `{"path": "..."}` |
| `POST` | `/api/quality/rules/presets` | `{"preset_dir_name": "glossary"}` | `{"builtin_presets": [{...}], "user_presets": [{...}]}` |
| `POST` | `/api/quality/rules/presets/read` | `{"preset_dir_name": "glossary", "virtual_id": "builtin:base.json"}` | `{"entries": [{...}]}` |
| `POST` | `/api/quality/rules/presets/save` | `{"preset_dir_name": "glossary", "name": "...", "entries": [{...}]}` | `{"item": {...}}` |
| `POST` | `/api/quality/rules/presets/rename` | `{"preset_dir_name": "glossary", "virtual_id": "user:mine.json", "new_name": "..."}` | `{"item": {...}}` |
| `POST` | `/api/quality/rules/presets/delete` | `{"preset_dir_name": "glossary", "virtual_id": "user:mine.json"}` | `{"path": "..."}` |
| `POST` | `/api/quality/rules/query-proofreading` | `{"rule_type": "glossary", "entry": {"src": "勇者", "regex": false}}` | `{"query": {"keyword": "勇者", "is_regex": false}}` |
| `POST` | `/api/quality/rules/statistics` | `{"rules": [{...}], "relation_candidates": [{...}]}` | `{"statistics": {...}}` |

`snapshot` 当前包含以下稳定字段：

```json
{
  "rule_type": "glossary",
  "revision": 2,
  "meta": {
    "enabled": true
  },
  "statistics": {
    "available": false,
    "results": {}
  },
  "entries": [
    {
      "entry_id": "glossary:0",
      "src": "勇者",
      "dst": "Hero",
      "info": "",
      "regex": false,
      "case_sensitive": false
    }
  ]
}
```

其中：

- `rule_type` 当前稳定值包括 `glossary`、`text_preserve`、`text_replacement`
- `meta.enabled` 表示该规则集是否启用
- `statistics.results` 的值按规则 key 返回 `matched_item_count` 与 `subset_parents`
- `item` / `builtin_presets` / `user_presets` 当前稳定字段为 `name`、`virtual_id`、`path`、`type`

### 7.2 自定义提示词

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/quality/prompts/snapshot` | `{"task_type": "translation" \| "analysis"}` | `{"prompt": {...}}` |
| `POST` | `/api/quality/prompts/template` | `{"task_type": "translation" \| "analysis"}` | `{"template": {"default_text": "...", "prefix_text": "...", "suffix_text": "..."}}` |
| `POST` | `/api/quality/prompts/save` | `{"task_type": "translation", "expected_revision": 1, "text": "...", "enabled": true}` | `{"prompt": {...}}` |
| `POST` | `/api/quality/prompts/import` | `{"task_type": "analysis", "path": "...", "expected_revision": 1, "enabled": true}` | `{"prompt": {...}}` |
| `POST` | `/api/quality/prompts/export` | `{"task_type": "translation", "path": "..."}` | `{"path": "..."}` |
| `POST` | `/api/quality/prompts/presets` | `{"task_type": "translation" \| "analysis"}` | `{"builtin_presets": [{...}], "user_presets": [{...}]}` |
| `POST` | `/api/quality/prompts/presets/read` | `{"task_type": "translation", "virtual_id": "builtin:default.txt"}` | `{"text": "..."}` |
| `POST` | `/api/quality/prompts/presets/save` | `{"task_type": "translation", "name": "...", "text": "..."}` | `{"path": "..."}` |
| `POST` | `/api/quality/prompts/presets/rename` | `{"task_type": "translation", "virtual_id": "user:mine.txt", "new_name": "..."}` | `{"item": {...}}` |
| `POST` | `/api/quality/prompts/presets/delete` | `{"task_type": "translation", "virtual_id": "user:mine.txt"}` | `{"path": "..."}` |

`prompt` 当前包含以下稳定字段：

```json
{
  "task_type": "translation",
  "revision": 1,
  "meta": {
    "enabled": true
  },
  "text": "请翻译以下内容。"
}
```

## 8. Proofreading 接口

| 方法 | 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| `POST` | `/api/proofreading/snapshot` | `{}` 或 `{"lg_path": "..."}` | `{"snapshot": {...}}` |
| `POST` | `/api/proofreading/filter` | `{"filters": {...}}`、`{"filter_options": {...}}` 或包含扁平筛选字段的请求体 | `{"snapshot": {...}}` |
| `POST` | `/api/proofreading/search` | `{"keyword": "...", "is_regex": false}`，并可附带筛选字段 | `{"search_result": {...}}` |
| `POST` | `/api/proofreading/save-item` | `{"item": {...}, "new_dst": "...", "expected_revision": 7}` | `{"result": {...}}` |
| `POST` | `/api/proofreading/save-all` | `{"items": [{...}], "expected_revision": 7}` | `{"result": {...}}` |
| `POST` | `/api/proofreading/replace-all` | `{"items": [{...}], "search_text": "...", "replace_text": "...", "is_regex": false, "expected_revision": 7}` | `{"result": {...}}` |
| `POST` | `/api/proofreading/recheck-item` | `{"item": {...}}` | `{"result": {...}}` |
| `POST` | `/api/proofreading/retranslate-items` | `{"items": [{...}], "expected_revision": 7}` | `{"result": {...}}` |

`snapshot` 当前包含以下稳定字段：

```json
{
  "revision": 7,
  "project_id": "demo/project.lg",
  "readonly": false,
  "summary": {
    "total_items": 2,
    "filtered_items": 2,
    "warning_items": 1
  },
  "filters": {
    "warning_types": [
      "GLOSSARY"
    ],
    "statuses": [
      "NONE",
      "PROCESSED"
    ],
    "file_paths": [
      "script/a.txt"
    ],
    "glossary_terms": [
      [
        "勇者",
        "Hero"
      ]
    ]
  },
  "items": [
    {
      "item_id": 1,
      "file_path": "script/a.txt",
      "row_number": 12,
      "src": "勇者が来た",
      "dst": "Hero arrived",
      "status": "PROCESSED",
      "warnings": [
        "GLOSSARY"
      ],
      "failed_glossary_terms": [
        [
          "勇者",
          "Hero"
        ]
      ]
    }
  ]
}
```

`search_result` 当前包含：

```json
{
  "keyword": "勇者",
  "is_regex": false,
  "matched_item_ids": [
    1
  ]
}
```

`result` 当前包含：

```json
{
  "revision": 9,
  "changed_item_ids": [
    1
  ],
  "items": [
    {
      "item_id": 1,
      "file_path": "script/a.txt",
      "row_number": 12,
      "src": "勇者が来た",
      "dst": "Heroine arrived refreshed",
      "status": "PROCESSED",
      "warnings": [
        "GLOSSARY"
      ],
      "failed_glossary_terms": [
        [
          "勇者",
          "Hero"
        ]
      ]
    }
  ],
  "summary": {
    "total_items": 2,
    "filtered_items": 2,
    "warning_items": 1
  }
}
```

## 9. 错误码与冲突约定

第二阶段 `Quality` / `Proofreading` 写入命令统一保留 `expected_revision` 字段，当前文档锁定以下错误码语义，避免后续实现与页面提示发生漂移：

| 错误码 | 说明 |
| --- | --- |
| `REVISION_CONFLICT` | 页面持有的规则/校对快照版本已过期，请重新拉取快照后再重试 |
| `not_found` | 请求的 HTTP 路径不存在；这是 `CoreApiServer` 当前统一保证的基础错误码 |

其中：

- `Quality` 的 `update-meta`、`save-entries`、`import`
- `Quality Prompt` 的 `save`、`import`
- `Proofreading` 的 `save-item`、`save-all`、`replace-all`、`retranslate-items`

都使用 `expected_revision` 作为并发写入保护字段。

统一错误响应格式：

```json
{
  "ok": false,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "proofreading snapshot is stale"
  }
}
```

## 10. SSE Topic

当前对外暴露以下 topic：

| topic | 说明 |
| --- | --- |
| `project.changed` | 工程加载态变化 |
| `task.status_changed` | 翻译/分析任务状态变化 |
| `task.progress_changed` | 翻译/分析任务进度变化 |
| `workbench.snapshot_changed` | 工作台快照变化 |
| `settings.changed` | 设置更新通知 |
| `proofreading.snapshot_invalidated` | 质量规则变化导致校对快照失效 |

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

`proofreading.snapshot_invalidated` 当前由 `QUALITY_RULE_UPDATE` 事件映射，稳定 payload 为：

```json
{
  "event_id": "evt_2",
  "topic": "proofreading.snapshot_invalidated",
  "timestamp": "2026-03-24T12:35:00+08:00",
  "payload": {
    "reason": "quality_rule_update",
    "rule_types": [
      "glossary"
    ],
    "meta_keys": []
  }
}
```

## 11. 客户端对象边界

本地 HTTP API 仍然以 JSON / `dict` 作为边界协议，但客户端内部已经统一切换到对象化响应。

服务端 `api/Application` 层负责把内部状态收口为 `api/Contract/*Payloads.py` 中的响应载荷对象，再经 `ApiResponse` 序列化为 JSON。

### 11.1 模型目录

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
- `model/Api/QualityRuleModels.py`
  - `QualityRuleSnapshot`
  - `QualityRuleEntry`
  - `QualityRuleStatisticsSnapshot`
  - `ProofreadingLookupQuery`
- `model/Api/PromptModels.py`
  - `CustomPromptSnapshot`
  - `PromptPresetEntry`
- `model/Api/ProofreadingModels.py`
  - `ProofreadingSnapshot`
  - `ProofreadingItemView`
  - `ProofreadingFilterOptionsSnapshot`
  - `ProofreadingSearchResult`
  - `ProofreadingMutationResult`

### 11.2 客户端返回值约定

- `SettingsApiClient` 对外返回 `AppSettingsSnapshot`
- `ProjectApiClient` 对外返回 `ProjectSnapshot` / `ProjectPreview`
- `WorkbenchApiClient` 对外返回 `WorkbenchSnapshot`
- `TaskApiClient` 对外返回 `TaskSnapshot`
- `ProjectPreview` 需要显式建模当前摘要字段：`path`、`name`、`source_language`、`target_language`、`file_count`、`created_at`、`updated_at`、`total_items`、`translated_items`、`progress`

第二阶段补充约定：

- `QualityRuleApiClient.get_rule_snapshot()` / `save_entries()` / `update_meta()` 返回 `QualityRuleSnapshot`
- `QualityRuleApiClient.query_proofreading()` 返回 `ProofreadingLookupQuery`
- `QualityRuleApiClient.build_rule_statistics()` 返回 `QualityRuleStatisticsSnapshot`
- `ProofreadingApiClient.get_snapshot()` / `filter_items()` 返回 `ProofreadingSnapshot`
- `ProofreadingApiClient.search()` 返回 `ProofreadingSearchResult`
- `ProofreadingApiClient.save_item()` / `save_all()` / `replace_all()` / `recheck_item()` / `retranslate_items()` 返回 `ProofreadingMutationResult`

### 11.2.1 服务端载荷命名约定

- `api/Contract` 中面向 HTTP `data` 载荷的对象统一使用 `*Payload` 命名，避免继续使用语义过泛的 `*Dto`
- 当前服务端载荷对象包括：
  - `ProjectSnapshotPayload`
  - `ProjectPreviewPayload`
  - `TaskSnapshotPayload`
  - `WorkbenchSnapshotPayload`
  - `WorkbenchFileEntryPayload`
  - `QualityRuleSnapshotPayload`
  - `ProofreadingLookupPayload`
  - `ProofreadingSnapshotPayload`
  - `ProofreadingSearchResultPayload`
  - `ProofreadingMutationResultPayload`

### 11.3 状态仓库约定

- `ApiStateStore.project_snapshot` 只缓存 `ProjectSnapshot`
- `ApiStateStore.task_snapshot` 只缓存 `TaskSnapshot`
- `ApiStateStore` 不缓存完整 `ProofreadingSnapshot`，只缓存 `proofreading_snapshot_invalidated` 过期标记
- SSE 增量事件进入 `ApiStateStore` 后，会先解码为 `TaskStatusUpdate` / `TaskProgressUpdate` 再合并
- 页面层不得再直接依赖 `response.get(...)`、`snapshot.get(...)` 读取 API 响应
- 页面层不得通过 `to_dict().get(...)`、`payload.get(...)` 回退为字典式读取对象字段

## 12. UI 边界

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

第二阶段补充边界声明如下：

- `frontend/Quality/CustomPromptPage.py`
- `frontend/Quality/GlossaryEditPanel.py`
- `frontend/Quality/GlossaryPage.py`
- `frontend/Quality/QualityRuleEditPanelBase.py`
- `frontend/Quality/QualityRuleIconHelper.py`
- `frontend/Quality/QualityRulePageBase.py`
- `frontend/Quality/QualityRulePresetManager.py`
- `frontend/Quality/TextPreserveEditPanel.py`
- `frontend/Quality/TextPreservePage.py`
- `frontend/Quality/TextReplacementEditPanel.py`
- `frontend/Quality/TextReplacementPage.py`
- `frontend/Proofreading/FilterDialog.py`
- `frontend/Proofreading/ProofreadingDomain.py`
- `frontend/Proofreading/ProofreadingEditPanel.py`
- `frontend/Proofreading/ProofreadingLabels.py`
- `frontend/Proofreading/ProofreadingLoadService.py`
- `frontend/Proofreading/ProofreadingPage.py`
- `frontend/Proofreading/ProofreadingStatusDelegate.py`
- `frontend/Proofreading/ProofreadingTableModel.py`
- `frontend/Proofreading/ProofreadingTableWidget.py`

这些第二阶段文件同样不得直接导入上述 Core 单例；此外：

- `frontend/Proofreading/ProofreadingLoadService.py` 与 `frontend/Proofreading/ProofreadingDomain.py` 不得直接导入 `module.ResultChecker.ResultChecker`
- `frontend/Quality/QualityRulePageBase.py` 不得直接导入 `module.QualityRule.QualityRuleIO`
- `frontend/Quality/QualityRulePresetManager.py` 不得直接导入 `module.QualityRulePathResolver`
