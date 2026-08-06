# LinguaGacha 产品 Agent 工程边界

本文统一承载产品 Agent 的公开会话协议、运行态所有权、模型会话、启动资源、skill 与工具、宿主能力和前端消费。共享 Gateway、项目事务、模型请求与前端运行态分别归 [`BACKEND.md`](BACKEND.md) 和 [`FRONTEND.md`](FRONTEND.md)，进程拓扑归 [`ARCHITECTURE.md`](ARCHITECTURE.md)；字段级 schema、局部算法和产品语义留在代码、测试与当前产品设计中。

## 1. 公开会话协议

- Agent 公开入口提供 snapshot、message、stop 与 reset；message 请求和公开 user 条目只携带规范化后的 `text` 字符串，会话状态只区分 `idle | running`，user / assistant / tool 条目各自携带 `running | success | error | stopped` 状态。
- 时间线由 snapshot 与 `agent.session_event` 通过同 id 完整条目覆盖和 `snapshot_seed` 共同恢复本次 reset 以来的内存历史，并只公开模型可见历史的估算 token；模型失败只写入对应条目和轮次，不发布第二套失败事件。公开条目不包含工具参数、供应商连续性元数据或脱敏思考。
- 工具 `running` 条目在执行体开始前发布；所有产品工具在统一注册边界先让出一次事件循环，为本地 SSE 首帧提供独立发送轮次。

## 2. 状态与生命周期

| 状态 | 拥有者 | 唯一入口 |
| --- | --- | --- |
| 公开状态、完整 UI 时间线、会话生命周期与启动期资源 | `AgentService` | Agent API、`agent.session_event` |
| 模型可见历史、工具循环、上下文压缩、中断与 settle | 内存 `AgentSession` | `AgentService` 调用 SDK 的 prompt、模型切换与关闭 API |

- Agent 运行时完全内存化。消息受理到 SDK 最终 settle 期间持续持有 [`RuntimeOperationGate`](BACKEND.md) 的运行 lease；stop 同步封口当前轮次仍运行的子条目和 user 条目、将公开会话切回 `idle`，再异步取消 SDK，lease 仍到最终 settle 才释放。
- 显式 reset 与 `ProjectSessionState.mark_loaded` / `clear` 会立即隔离公开会话并等待旧运行时清理；同一工程内的项目事实变化不重置公开时间线或模型历史，已失效运行时的迟到阶段不得改写条目、发布终态或启动模型请求。

## 3. 模型、资源与 skill

- Agent 与 OneShot 共用 [`BACKEND.md`](BACKEND.md) 定义的模型请求边界。每条 Agent 消息受理后、模型调用前统一重新解析 agent 用途选择和完整请求快照，并把当前 `agent.context_window`、`agent.max_output_tokens`、思考等级与压缩预留同步到既有 `AgentSession`；设置因此作用于同一对话的下一次模型操作，不重建或清空模型历史。模型页 generation 和 threshold 输入 / 输出 token 设置只作用于 OneShot。
- 启动期原子加载必需的 `resource/agent/system_prompt.md` 与 `resource/agent/session_seed.json`；会话种子由零个或多个顺序任意的 user / assistant 消息组成，文本裁剪后允许为空，按资源顺序进入每个新会话的模型历史但不进入公开时间线，任一资源缺失或结构无效都会阻止启动。
- coding-agent 的默认工具与项目资源发现全部关闭；产品 skill 只在启动期从内置与用户目录加载，坏 skill 只记录诊断，SDK 不发现项目 `AGENTS.md`、`.pi` 或其它运行期资源。`SKILL.md` 描述同时作为模型描述和 `i18n.json` UI 描述缺失时的回退；`visible: false` 只排除公开 snapshot，`disableModelInvocation` 只排除系统能力清单，二者都不改变启动期文件白名单。用户正文中的精确 `@skill(name)` 按首次出现顺序确定性注入已加载能力，重复项去重、未知 marker 与裸 `@name` 按普通文本处理；`@term(src)` 始终只是模型可读正文。`read_skill` 只读取启动期形成的 `SKILL.md` 与 references 白名单，不扫描会话历史建立第二套授权，UI 配置不进入模型上下文。

## 4. 产品工具与宿主能力

- 产品 JSON 工具统一由 `agent-tool` 生成同源的模型正文与 `details`；TypeBox Schema 独占结构、必填、枚举与集合约束，`AgentToolError` 只表达模型可修正的领域错误。受控 `AppError` 只投影稳定 `code` 与公开字段，未知执行异常对模型固定为 `{ "code": "tool_failed" }`，原始异常只进入本地化应用诊断。
- SDK 的 `tool_execution_start/end` 是完整持久化调用记录的唯一来源，覆盖参数校验失败、未知工具、成功和执行异常；start 保存完整输入，SDK 产生终态时 end 保存完整最终结果与错误标记。stop 后的合法终帧仍记录，reset / dispose 在终帧前解除订阅时不伪造 end，单独的 start 即表示调用未完成；公开时间线协议不承载完整参数或结构化错误。
- 产品工具只从当前设置、cache 与领域 query 读取事实；写入经对应服务的 Agent 专用入口复用 [`BACKEND.md`](BACKEND.md) 的 revision、事务和项目事件边界。模型可见结果不暴露绝对 `projectPath`，item、warning、quality 查询及写入确认携带与数据快照绑定的 section revision；写工具以 `applied | unchanged` 和紧凑变更身份表达权威结果，成功后不为确认重复查询完整事实。
- 质量规则工具统一查询和原子更新，模型通过 `write`、`delete`、`move` 表达差异，后端按 `entry_id` 决定创建或更新，并在提交前拒绝新增或扩大的重复组；Agent 不允许修改启用状态或文本保护模式。业务校验失败不写入，revision 冲突返回当前 revision 和重新查询动作，成功回执携带提交后的 quality revision。
- `query_items` 只从基础 item cache 组合 ID、状态、文件与单一文本搜索并返回分页；`query_warning_items` 复用当前校对评估运行态，只返回具有真实 warning 的条目与证据且不创建或替换 GUI 列表视图；`update_items` 接收由必填 `item_id`、`field` 和 `value` 组成的单字段 `write`，在 Agent 边界按 item 聚合后与 GUI 共用译文、译名和人工状态的字段更新核心，并以实际更新 ID 与提交后双 revision 确认结果，不回传更新后正文。`query_project_meta` 按需读取当前权威源语言和目标语言。
- `query_quality_rules(glossary)` 复用一次 `quality_statistics` compute task 同时返回覆盖数、实际命中次数、结构关系和每条最多一个有效语境 sample；sample 由统计启动前捕获的 item 快照投影，后续 `query_items` 以 section revisions 相等作为一致性边界，不另建 Agent 统计缓存或正文重扫。
- `web_fetch({ url })` 仅在 GUI 宿主能力可用时注册，CLI 不提供假实现。Electron main 复用默认 session 的 Chromium 网络栈逐跳限制 HTTP(S)、DNS/IP、重定向、超时和响应字节，只经 main 与 Backend Runtime 的私有宿主协议返回有限字节与原始 Content-Type；Backend 将 HTML / XHTML 经本地 Defuddle、其它受支持文本按 MIME 和 charset 归一为带不可信边界的 Markdown，二进制、无有效正文和不支持的 MIME 明确失败。

## 5. 前端消费

- Agent skill 的完整 `displayDescriptions` 由后端 snapshot 提供，页面只按当前 locale 选择，不建立第二份全局翻译表。
- `AgentSessionProvider` 跨路由持有 snapshot / SSE 镜像、当前 command、带恢复路径的 issue、模型可见历史 token、纯文本草稿与 renderer 全局输入历史；时间线不进入 `DesktopStateProvider` 或项目 session UI 缓存。Agent Composer 以该 token 和页面当前模型容量生成底栏用量，合法消息 ack 原子追加输入历史并清空草稿，失败保留草稿；页面只持有滚动、弹窗，以及从既有质量规则 query 与共享统计缓存读取的 glossary 和命中数，二者都不进入 Agent snapshot、草稿、历史或发送协议。输入框、引导卡片与时间线只把当前已知 marker 投影为整块视觉，不改变底层字符串或建立身份旁路。
- Agent 回合运行态与 stop 命令不锁定草稿编辑，send / reset 命令跨路由保持编辑器只读；共享 runtime 锁禁用发送、reset 与模型选择 / 思考档位控制，当前 Agent 回合的 stop 始终保留。
