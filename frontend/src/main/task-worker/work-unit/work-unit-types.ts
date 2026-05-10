import type { ApiJsonValue } from "../../api/api-types";
import type { TextTaskItemRecord } from "../../../shared/text/text-types";

/**
 * TaskEngine 传给 worker 的公共 work unit 请求字段。
 */
export interface WorkUnitBaseRequest {
  // run_id 用于隔离一次任务运行，worker 不用它访问项目状态。
  run_id: string;
  // work_unit_id 是 chunk 级诊断键，迟到响应和日志都围绕它定位。
  work_unit_id: string;
  // task_type 保留 TaskEngine 语义，便于日志与错误回传分类。
  task_type: string;
  // model / config_snapshot 均来自任务启动快照，避免执行中读取可变全局配置。
  model: ApiJsonValue;
  config_snapshot: ApiJsonValue;
  // quality_snapshot 是文本后处理与提示词构造的唯一质量规则输入。
  quality_snapshot: ApiJsonValue;
}

/**
 * 翻译 chunk 请求，items 和 precedings 都是不可变 JSON 快照。
 */
export interface TranslationWorkUnitRequest extends WorkUnitBaseRequest {
  // items 是本 chunk 的不可变条目快照，worker 修改结果后再回传给 TaskEngine。
  items: ApiJsonValue;
  // precedings 只用于上下文提示词，不参与当前 chunk 的写回。
  precedings?: ApiJsonValue;
  // 以下字段保留 旧调度日志语义，避免迁移后任务诊断信息丢失。
  split_count?: ApiJsonValue;
  retry_count?: ApiJsonValue;
  token_threshold?: ApiJsonValue;
  is_initial?: ApiJsonValue;
}

/**
 * 重翻请求显式只携带单个 item，避免 worker 猜测场景。
 */
export interface RetranslateWorkUnitRequest extends WorkUnitBaseRequest {
  // item 固定为单条记录，避免重翻逻辑误用普通 chunk 的数组路径。
  item: ApiJsonValue;
}

/**
 * 低频单条翻译请求，不写数据库也不发 project.patch。
 */
export interface TranslateSingleWorkUnitRequest extends WorkUnitBaseRequest {
  // text 来自公开派生工具调用，不关联任何项目条目。
  text: ApiJsonValue;
}

/**
 * 分析请求由 TaskEngine 预先切块，worker 只执行单个 chunk。
 */
export interface AnalysisWorkUnitRequest extends WorkUnitBaseRequest {
  // context 包含分析 chunk 所需候选、语言和术语上下文，worker 不再回读数据库。
  context: ApiJsonValue;
}

/**
 * worker 只生成诊断文本，真正写文件 / 控制台 / 日志窗口仍由 Electron main LogManager 统一完成。
 */
export interface WorkUnitLogEntry {
  // level 映射 LogManager 的基础级别，不暴露前端 toast 或文件实现。
  level: "info" | "warning" | "error";
  // message 保持已格式化文本，TaskEngine 只负责转发。
  message: string;
}

/**
 * 翻译类 work unit 返回给 TaskEngine 的稳定结果。
 */
export interface TranslationWorkUnitResult {
  // items 只包含本 work unit 处理后的条目快照，由 TaskEngine 统一提交。
  items: TextTaskItemRecord[];
  // row_count 沿用 旧日志口径，表示本次成功覆盖的输入行数。
  row_count: number;
  // token 计数向任务统计累加，不参与业务分支判断。
  input_tokens: number;
  output_tokens: number;
  // stopped 表示主动取消或 adapter 取消，区别于可重试错误。
  stopped: boolean;
  // logs 由主线程统一提交，worker 不直接写日志目标。
  logs?: WorkUnitLogEntry[];
}

/**
 * 分析 work unit 返回候选和 token，checkpoint 由 TaskEngine 生成。
 */
export interface AnalysisWorkUnitResult {
  // success 表示分析解码出了可提交候选或合法空结果。
  success: boolean;
  // stopped 表示主动取消，TaskEngine 不应把它当作失败重试。
  stopped: boolean;
  // token 计数与翻译结果同源，用于任务统计。
  input_tokens: number;
  output_tokens: number;
  // glossary_entries 是已归一的候选池输入，checkpoint 仍由 TaskEngine 生成。
  glossary_entries: Array<Record<string, ApiJsonValue>>;
  // logs 只承载诊断文本，不包含可变业务对象。
  logs?: WorkUnitLogEntry[];
}

/**
 * 单条翻译保持公开 API 兼容响应形状。
 */
export interface TranslateSingleWorkUnitResult {
  // success/status 对齐公开 API 返回，不泄露内部 work unit 状态枚举。
  success: boolean;
  status: string;
  // dst 是单条翻译结果，失败时为空字符串。
  dst: string;
  // logs 供调用方展示诊断，不触发项目事件。
  logs?: WorkUnitLogEntry[];
}
