import type { ApiJsonValue } from "../../api/api-types";
import type { TextTaskItemRecord } from "../../../shared/text/text-types";

/**
 * TaskEngine 传给 worker 的公共 work unit 请求字段
 */
export interface WorkUnitBaseRequest {
  run_id: string; // run_id 用于隔离一次任务运行，worker 不用它访问项目状态
  work_unit_id: string; // work_unit_id 是 chunk 级诊断键，迟到响应和日志都围绕它定位
  task_type: string; // task_type 保留 TaskEngine 语义，便于日志与错误回传分类
  model: ApiJsonValue; // model / config_snapshot 均来自任务启动快照，避免执行中读取可变全局配置
  config_snapshot: ApiJsonValue;
  quality_snapshot: ApiJsonValue; // quality_snapshot 是文本后处理与提示词构造的唯一质量规则输入
}

/**
 * 翻译 chunk 请求，items 和 precedings 都是不可变 JSON 快照
 */
export interface TranslationWorkUnitRequest extends WorkUnitBaseRequest {
  items: ApiJsonValue; // items 是本 chunk 的不可变条目快照，worker 修改结果后再回传给 TaskEngine
  precedings?: ApiJsonValue; // precedings 只用于上下文提示词，不参与当前 chunk 的写回
  split_count?: ApiJsonValue; // 以下字段用于调度日志诊断，避免任务诊断信息丢失
  retry_count?: ApiJsonValue;
  token_threshold?: ApiJsonValue;
  is_initial?: ApiJsonValue;
}

/**
 * 重翻请求显式只携带单个 item，避免 worker 猜测场景
 */
export interface RetranslateWorkUnitRequest extends WorkUnitBaseRequest {
  item: ApiJsonValue; // item 固定为单条记录，避免重翻逻辑误用普通 chunk 的数组路径
}

/**
 * 低频单条翻译请求，不写数据库也不发项目数据变更事件
 */
export interface TranslateSingleWorkUnitRequest extends WorkUnitBaseRequest {
  text: ApiJsonValue; // text 来自公开派生工具调用，不关联任何项目条目
}

/**
 * 分析请求由 TaskEngine 预先切块，worker 只执行单个 chunk
 */
export interface AnalysisWorkUnitRequest extends WorkUnitBaseRequest {
  context: ApiJsonValue; // context 包含分析 chunk 所需候选、语言和术语上下文，worker 只消费快照输入
}

/**
 * worker 只生成诊断文本，真正写文件 / 控制台 / 日志窗口仍由 Electron main LogManager 统一完成
 */
export interface WorkUnitLogEntry {
  level: "info" | "warning" | "error"; // level 映射 LogManager 的基础级别，不暴露前端 toast 或文件实现
  message: string; // message 保持已格式化文本，TaskEngine 只负责转发
}

/**
 * 翻译类 work unit 返回给 TaskEngine 的稳定结果
 */
export interface TranslationWorkUnitResult {
  items: TextTaskItemRecord[]; // items 只包含本 work unit 处理后的条目快照，由 TaskEngine 统一提交
  row_count: number; // row_count 按日志口径表示本次成功覆盖的输入行数
  input_tokens: number; // token 计数向任务统计累加，不参与业务分支判断
  output_tokens: number;
  stopped: boolean; // stopped 表示主动取消或 adapter 取消，区别于可重试错误
  logs?: WorkUnitLogEntry[]; // logs 由主线程统一提交，worker 不直接写日志目标
}

/**
 * 分析 work unit 返回候选和 token，checkpoint 由 TaskEngine 生成
 */
export interface AnalysisWorkUnitResult {
  success: boolean; // success 表示分析解码出了可提交候选或合法空结果
  stopped: boolean; // stopped 表示主动取消，TaskEngine 不应把它当作失败重试
  input_tokens: number; // token 计数与翻译结果同源，用于任务统计
  output_tokens: number;
  glossary_entries: Array<Record<string, ApiJsonValue>>; // glossary_entries 是已归一的候选池输入，checkpoint 仍由 TaskEngine 生成
  logs?: WorkUnitLogEntry[]; // logs 只承载诊断文本，不包含可变业务对象
}

/**
 * 单条翻译保持公开 API 兼容响应形状
 */
export interface TranslateSingleWorkUnitResult {
  success: boolean; // success/status 对齐公开 API 返回，不泄露内部 work unit 状态枚举
  status: string;
  dst: string; // dst 是单条翻译结果，失败时为空字符串
  logs?: WorkUnitLogEntry[]; // logs 供调用方展示诊断，不触发项目事件
}
