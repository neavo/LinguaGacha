# LinguaGacha Agent 协作指南

本文件是 Agent 入口，只保留协作、编码和交付时必须立即遵守的硬约束

## 1. 阅读入口与唯一归宿

- 收到任务后先按 [`docs/WORKFLOW.md`](docs/WORKFLOW.md) 选择阅读路径
- 除非任务只涉及纯文档自检，否则先读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

| 你要判断的问题 | 唯一归宿 |
| --- | --- |
| 系统分层、跨层边界、模块关系、阅读地图 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| HTTP / SSE / bootstrap / topic / 错误码 / mutation 契约 | [`docs/API.md`](docs/API.md) |
| Electron / preload / renderer / `ProjectStore` / 导航与样式边界 | [`docs/FRONTEND.md`](docs/FRONTEND.md) |
| Core 数据域、状态拥有者、唯一写入口、`.lg` 物理存储落点 | [`docs/DATA.md`](docs/DATA.md) |
| 任务起手式、验证矩阵、文档同步、交付自检 | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) |
| 产品语境与设计权威 | [`PRODUCT.md`](PRODUCT.md) -> [`DESIGN.md`](DESIGN.md) |

- 长期文档只记录未来维护必须知道、且不能轻易从代码表面得出的当前有效事实
- 适合专题文档的规则必须迁到唯一归宿，不要在 `AGENTS.md` 里扩写专题正文

## 2. 仓库级硬约束

- LinguaGacha 是“Electron main 内部 Database Service + 无头 Core + Electron 桌面前端”的本机多进程工程
- `api/` 是 Core 对外暴露的唯一 HTTP / SSE 协议边界，HTTP / SSE 协议变化必须同步 [`docs/API.md`](docs/API.md)
- 渲染层只通过 `window.desktopApp` 接入桌面宿主，再通过 `frontend/src/renderer/app/desktop/desktop-api.ts` 访问 Core API
- 前端禁止绕过 preload 直连 Node / Electron，禁止直接导入 Python 模块
- 项目运行态主路径固定为 `/api/project/bootstrap/stream` 与 `/api/events/stream`
- 页面消费 bootstrap + `project.patch`，不是整页快照轮询
- 同一业务语义只允许一个权威来源与一个写入口，跨线程、跨模块、跨前后端只传 `id`、值对象或不可变快照，禁止共享可变对象引用
- 新增状态前先判断它属于 `ProjectSession`、领域 service、`DataManager`、`ProjectStore`，还是页面本地状态
- SQL、事务与 `.lg` 内 asset 读写只允许落在 `frontend/src/main/database/`，Zstd 压缩参数与压缩 / 解压工具只允许落在 `frontend/src/utils/zstd-tool.ts`，`.lg` 打开期 schema / 旧物理格式迁移统一落在 `frontend/src/main/migration/project-database-migration-service.ts`，Python Core 只能通过 `module/Data/Database/DatabaseGateway.py` 访问，API 层不得直接操作 database workflow，不得持有 `ProjectSession`
- 前端职责、导航、组件、样式与文案归属以 [`docs/FRONTEND.md`](docs/FRONTEND.md) 为唯一权威

## 3. 编码硬约束

通用：
- 新增命名必须遵循所在语言与目录的既有风格，禁止为了局部方便引入第二套命名体系
- 类、方法与关键逻辑应编写简明注释，解释“为什么这样约束”，不要复述代码表面行为
- 魔术值要收口到常量、枚举或冻结数据对象，避免散落在调用点
- 只有“预期且无害”的场景才允许静默忽略异常，静默忽略异常时必须用注释说明为何可以静默忽略，需要包装语义时必须保留异常链

Python：
- Python 变量与函数用 `snake_case`，类用 `PascalCase`，常量用 `UPPER_SNAKE_CASE`，命名禁止首位下划线
- 函数、类属性、实例属性与 `@dataclass` 字段必须显式标注类型，优先使用 `A | None`、`list[str]` 等现代写法
- 数据载体优先使用 `dataclasses`，跨线程或跨边界传递的数据优先使用 `@dataclass(frozen=True)`
- Python 模块对外只暴露类，常量与枚举优先设计为类属性
- 使用 `LogManager.get().debug/info/warning/error(msg, e)` 记录日志，记录异常时必须把 `e` 传入日志接口，使用 `raise ... from e` 保留异常链

TypeScript / React / CSS：
- TypeScript 代码优先保持显式类型，只有第三方类型确实缺失时才局部使用 `any` 兜底
- React Hook 必须维护真实依赖数组，禁止用 eslint 禁用注释掩盖 React Hook 依赖问题
- 渲染层视觉尺寸字面量优先使用 `px`，`line-height` 使用无单位数值，`letter-spacing` 仅允许 `em`，`clamp()` 仅允许 `px + vw + px` 组合

## 4. 交付硬约束

- 改代码前先确认状态拥有者、唯一写入口和事件回流路径，不能只按目录名推断
- 改动若会让阅读路径、职责边界、协议语义或设计语义失真，必须在同一任务内同步修正文档
- 删除或迁移遗留文档时，必须同步更新脚本报错、README、技能提示和测试断言里的文档入口，不能让工具链继续指向已迁空的目录级 `SPEC.md`
- 完成后必须回看 diff，确认命名、注释、实现边界与文档边界仍然一致
- 验证按 [`docs/WORKFLOW.md`](docs/WORKFLOW.md) 的矩阵执行，若未执行、执行失败或只完成部分验证，交付时必须说明原因与影响范围
- 若任务涉及前端视觉改动，交付时必须说明是否依照 [`DESIGN.md`](DESIGN.md) 完成核对
