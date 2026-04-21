# `module/Model` 规范说明

## 一句话总览
`module/Model` 负责模型配置领域对象与模型管理流程。`Types.py` 定义运行时使用的模型配置类型，`Manager.py` 负责预设加载、模板补齐、分组排序、激活模型回退与配置写回前的统一整理。

## 阅读顺序
| 任务类型 | 优先阅读 |
| --- | --- |
| 模型配置对象结构 | `Types.py` |
| 预设模型加载、迁移与模板回填 | `Manager.py` |
| 配置文件如何初始化模型列表 | `../Config.py` -> `Manager.py` |
| 模型页 API 行为 | `../../api/v2/Application/ModelAppService.py` -> `Manager.py` |

## 目录职责
| 路径 | 职责 |
| --- | --- |
| `Types.py` | `Model`、`ModelType`、`ThinkingLevel` 以及请求/阈值/思考/生成参数配置对象 |
| `Manager.py` | 预设模型加载、旧预设迁移、自定义模板补齐、模型 CRUD 与分组排序 |

## 边界与约束
- `Types.py` 只承载模型配置领域语义，不承担 HTTP 载荷或前端页面快照职责。
- `Manager.py` 是模型列表整理与分组排序的唯一规则入口；`Config` 与 `ModelAppService` 不应各自复制排序或默认模型补齐逻辑。
- 模型配置的持久化格式仍由 `Config` 决定，`module/Model` 不直接负责文件路径解析之外的应用设置读写。
- 新增模型供应商或模板时，优先扩展 `ModelType`、`Manager.TEMPLATE_FILENAME_BY_TYPE` 与对应预设资源，不要把分支散落到调用方。

## 维护提示
- 如果模型页协议变化涉及冻结 DTO，去改 `api/v2/Models/Model.py` / `api/v2/Models/ModelTest.py`，不要回写到这里。
- 如果只是模型配置字段、默认值或模板选择逻辑变化，优先改 `Types.py` / `Manager.py`，并同步检查 `Config` 与 `ModelAppService`。
