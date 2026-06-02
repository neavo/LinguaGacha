import { TextFakenameInjector } from "../../../../shared/text/text-fakename-injector";

/**
 * 分析 item 上下文只携带 prompt 与 checkpoint 必需字段，避免 worker 持有完整数据库行
 */
export interface AnalysisItemContext {
  item_id: number;
  file_path: string;
  src_text: string;
}

/**
 * 一个分析 chunk 的执行上下文，file_path 用于日志聚合，retry_count 用于任务诊断
 */
export interface AnalysisTaskContext {
  file_path: string;
  retry_count: number;
  items: AnalysisItemContext[];
}

/**
 * 分析译前产物，保留日志原文、请求原文和伪名恢复器
 */
export interface AnalysisPrePipelineResult {
  prompt_srcs: string[];
  request_srcs: string[];
  fake_name_injector: TextFakenameInjector;
}

/**
 * 术语分析译前 pipeline，负责控制码伪名注入
 */
export class AnalysisPrePipeline {
  /**
   * 构造分析 prompt 输入；prompt_srcs 用于日志，request_srcs 用于实际请求
   */
  public process_context(context: AnalysisTaskContext): AnalysisPrePipelineResult {
    const prompt_srcs = this.build_prompt_source_texts(context.items);
    const fake_name_injector = new TextFakenameInjector(prompt_srcs);
    return {
      prompt_srcs,
      request_srcs: fake_name_injector.inject_texts(prompt_srcs),
      fake_name_injector,
    };
  }

  /**
   * src_text 已由规划期渲染成最终分析输入，这里只负责空行过滤和伪名保护。
   */
  private build_prompt_source_texts(items: AnalysisItemContext[]): string[] {
    const prompt_srcs: string[] = [];
    for (const item of items) {
      const src_text = item.src_text.trim();
      if (src_text === "") {
        continue;
      }
      prompt_srcs.push(src_text);
    }
    return prompt_srcs;
  }
}
