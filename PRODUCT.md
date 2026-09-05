# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

LinguaGacha 面向需要批量翻译小说、游戏文本、字幕、电子书、Markdown 和其它文本工程内容的创作者、汉化者、翻译协作者与个人用户。用户通常希望用尽量少的配置完成高质量翻译，并在翻译过程中保持术语一致、格式稳定和结果可校对。

## Product Purpose

LinguaGacha 是一个桌面端 AI 文本翻译工具，目标是在复杂文本工程中提供开箱即用、速度快、质量稳定的翻译工作流。它降低用户处理模型配置、术语表、文本保护、格式保留和校对修正的成本，让用户更专注于作品本身，而不是被工具流程拖住。

## Positioning

LinguaGacha 将多种文本格式的导入与导出、AI 翻译、术语一致性、文本保护、格式保留和可校对的桌面工作流组织在同一工具中。工作台承担批量任务，Agent 通过对话结合工程上下文完成规则整理、翻译与审校，用户可以在同一工程中检查并继续修正结果。

## Operating Context

用户在 Windows、macOS 或 Linux 的 Electron 桌面应用中创建或打开本地 `.lg` 工程，导入或拖入待翻译文件，再配置模型与原文、译文语言。主要工作路径包括：

1. 在 Agent 中通过对话整理术语与文本保护规则，按需要补充图片或对助手回答的批注，并在执行过程中回答问题、审阅工程写入请求。
2. 在工作台执行批量翻译、观察进度和处理失败；在校对页面检查原文、译文与上下文，按需要编辑规则、提示词和译文，再生成当前可用的翻译文件。
3. 在 Agent 中继续处理指定范围的翻译、审校与修正；高级用户也可以通过 CLI 执行批处理或自动化流程。

工作台保留经典分析入口，启动时提供迁移提示并推荐前往 Agent 自动生成术语表。

## Capabilities and Constraints

- 支持字幕、电子书、Markdown、Ren'Py、MTool、SExtractor、VNTextPatch、Translator++ 和 WOLF 等来源或项目格式；具体格式支持以当前解析器与发布说明为准。
- 提供工作台、校对、Agent、模型管理、基础与专家设置、术语表、文本保护、翻译前后文本替换、自定义提示词，以及百宝箱中的繁简转换。
- Agent 可读取工程上下文、搜索和读取网页、整理质量规则、翻译与审校文本，并通过工程写入流程提交结果；具体任务能力随当前可用技能与工具决定。
- Agent 输入支持技能引用、图片附件、响应批注和运行中的消息排队；用户可查看思考与工具详情、修改可修订消息，并通过输入菜单中的指令手动压缩上下文。
- Agent 工程写入支持「手动批准 / 自动批准」。手动模式在提交前展示实际变更类别与数量，用户可以拒绝、允许本次或允许本次及本会话后续全部写入；执行中的问题提供固定选项、自定义答案和取消。
- 可连接本地或在线模型接口；模型、语言、提示词和质量规则由用户配置或项目设置决定。
- 桌面界面由 Web 技术实现，并通过宿主桥与本地 Backend Runtime 使用产品能力；本记录的 `web` 平台值描述界面技术形态。CLI 是同一产品的另一入口。
- 工程数据保存在本地 `.lg` 文件中；Agent 对话、输入队列和草稿属于当前内存会话，切换工程或重置会话时清理。翻译任务与 Agent 执行共用运行资源，界面需要清楚表达忙碌、等待和可继续操作的状态。
- 结果需要保留原始格式与可校对上下文；翻译状态、任务进度、错误、覆盖写入和修正结果必须可追踪。
- 模型接入、格式覆盖和性能表述以当前实现及发布证据为准；产品记录不把宣传示例转换为固定的性能保证。

## Brand Commitments

- 产品名称为 LinguaGacha，表达基调是萌、极客、内敛。
- 桌面应用应保持可靠、紧凑、可重复操作的工具感，萌感与技术感通过克制的细节、文案和反馈表达。
- 视觉与交互避免浏览器式长页、营销 hero、卡片信息流、通用后台模板和 Web SaaS 套壳气质；稳定壳层、明确工具区、即时反馈和生产密度是需要保持的体验承诺。

## Evidence on Hand

- [`README.md`](README.md) 与 [`README_EN.md`](README_EN.md) 提供产品说明、支持场景、基本流程、格式列表和发布截图链接。
- [`src/frontend/pages/workbench-page/components/workbench-command-bar.tsx`](src/frontend/pages/workbench-page/components/workbench-command-bar.tsx) 与 [`src/shared/i18n/resources/zh-CN/workbench-page.ts`](src/shared/i18n/resources/zh-CN/workbench-page.ts) 提供批量任务操作和经典分析迁移提示的当前证据。
- [`docs/AGENT_RUNTIME.md`](docs/AGENT_RUNTIME.md) 与 [`src/frontend/pages/agent-page/`](src/frontend/pages/agent-page/) 提供 Agent 会话、工程写入、技能、上下文压缩、附件与队列的实现边界；[`docs/BACKEND.md`](docs/BACKEND.md)、[`docs/CLI.md`](docs/CLI.md) 分别记录工程存储与命令行契约。
- `src/frontend/pages/`、`src/frontend/features/` 与 `src/frontend/widgets/` 提供当前桌面界面的页面、工作台、Agent、设置、模型、术语、文本保护、文本替换和校对实现。
- `src/backend/`、`src/domain/`、`src/cli/` 与 `src/gui/` 提供任务、项目、规则、CLI 和 Electron 宿主能力的实现与测试。
- 发布说明、README 中的性能或格式覆盖表述属于待持续核验的外部证据，不在本记录中扩展为新的产品承诺。

## Product Principles

1. 让用户尽量少配置就能开始可靠的翻译工作。
2. 让术语、格式、文本保护和校对上下文在复杂文本工程中保持稳定。
3. 把翻译、分析、配置、检查和修正组织成清晰且可重复的工作流。
4. 给高级用户足够的模型、规则、提示词和自动化控制，同时保持新用户可理解。
5. 对任务状态、错误、写入和结果提供明确、可追踪的反馈。

## Accessibility & Inclusion

长时间使用场景需要键盘可达的主要操作、清晰可见的焦点态、足够的颜色对比、可读的文本层级，以及尊重系统减少动态效果偏好。辅助标签、状态和错误反馈应与现有可见文案保持一致，并支持用户在不同语言环境中理解关键操作。
