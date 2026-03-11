**结论**
核心结论先说清楚：真正的“实际术语”是在把候选池转成 `glossary_entries` 时生成的，关键函数是 [DataManager.py:1545](E:/Project/LinguaGacha/module/Data/DataManager.py#L1545) 和 [DataManager.py:1567](E:/Project/LinguaGacha/module/Data/DataManager.py#L1567)，不是点击导入按钮后把原始候选直接塞进术语表。

```text
模型返回候选
   -> 解码
   -> 规范化
   -> observation 去重
   -> 按 src 聚合成候选池(票池)
   -> 导入时从票池选 winner
   -> 过滤无效项
   -> 和现有 glossary 做 FILL_EMPTY 合并
   -> 批量写入正式术语表
```

**处理链路**
这条链路分成两段看最清楚：前半段先“攒候选票”，后半段再“生成正式术语”。

1. 分析阶段先拿到模型输出，然后做解码。
模型响应先经过 [AnalysisResponseDecoder.py:8](E:/Project/LinguaGacha/module/Response/AnalysisResponseDecoder.py#L8)，只接受旧格式的 JSONLine 术语对象，也就是必须有 `src`、`dst`、`type`，最后统一转成 `src/dst/info`。

2. 解码后的候选会再做一次规范化。
在 [AnalysisPipeline.py:685](E:/Project/LinguaGacha/module/Engine/Analyzer/AnalysisPipeline.py#L685) 里，代码会把字段 `strip()`，再用 [AnalysisPipeline.py:677](E:/Project/LinguaGacha/module/Engine/Analyzer/AnalysisPipeline.py#L677) 按标点拆复合术语对，并过滤掉：
   - 空 `src`
   - 空 `dst`
   - `src == dst`
最后补成固定结构：`{"src","dst","info","case_sensitive": False}`。调用点在 [AnalysisPipeline.py:632](E:/Project/LinguaGacha/module/Engine/Analyzer/AnalysisPipeline.py#L632) 和 [AnalysisPipeline.py:654](E:/Project/LinguaGacha/module/Engine/Analyzer/AnalysisPipeline.py#L654)。

3. 规范化结果不会立刻变正式术语，而是先记成 observation。
分析任务提交时走 [DataManager.py:1480](E:/Project/LinguaGacha/module/Data/DataManager.py#L1480)，里面会先用 [DataManager.py:1097](E:/Project/LinguaGacha/module/Data/DataManager.py#L1097) 生成 observation，再用 [DataManager.py:1122](E:/Project/LinguaGacha/module/Data/DataManager.py#L1122) 去掉同一任务里重复的 observation，保证幂等。

4. 然后 observation 会按 `src` 汇总进候选池。
真正累计票数的是 [DataManager.py:1169](E:/Project/LinguaGacha/module/Data/DataManager.py#L1169)，它会把同一个 `src` 的：
   - `dst_votes`
   - `info_votes`
   - `observation_count`
   - `case_sensitive`
合并进 `analysis_candidate_aggregate` 这张候选池表，表结构在 [LGDatabase.py:171](E:/Project/LinguaGacha/module/Data/LGDatabase.py#L171)。

5. 点击“导入到术语表”时，才开始从候选池生成正式术语。
UI 按钮在 [AnalysisPage.py:569](E:/Project/LinguaGacha/frontend/Analysis/AnalysisPage.py#L569) 发出 `ANALYSIS_IMPORT_GLOSSARY` 事件，`Analyzer` 在 [Analyzer.py:77](E:/Project/LinguaGacha/module/Engine/Analyzer/Analyzer.py#L77) 和 [Analyzer.py:167](E:/Project/LinguaGacha/module/Engine/Analyzer/Analyzer.py#L167) 接住，最后调用 [DataManager.py:1586](E:/Project/LinguaGacha/module/Data/DataManager.py#L1586)。

6. “实际术语”就是在这里被算出来的。
[DataManager.py:1567](E:/Project/LinguaGacha/module/Data/DataManager.py#L1567) 会遍历候选池，每个 `src` 交给 [DataManager.py:1545](E:/Project/LinguaGacha/module/Data/DataManager.py#L1545) 处理。这个函数会：
   - 用 [DataManager.py:855](E:/Project/LinguaGacha/module/Data/DataManager.py#L855) 从 `dst_votes` 里选票数最高的 `dst`
   - 再从 `info_votes` 里选票数最高的 `info`
   - 同票时保留先出现者
   - 过滤掉 `src == ""`、`dst == ""`、`info == ""`、`dst == src`
   - 过滤 `info` 是 `其它 / 其他 / other` 的项
最终才生成正式术语字典：
```python
{
    "src": src,
    "dst": dst,
    "info": info,
    "case_sensitive": bool(entry.get("case_sensitive", False)),
}
```

7. 生成后的正式术语不会直接硬覆盖原术语表，而是先合并。
[DataManager.py:1603](E:/Project/LinguaGacha/module/Data/DataManager.py#L1603) 调用 [DataManager.py:1988](E:/Project/LinguaGacha/module/Data/DataManager.py#L1988)，使用 `FILL_EMPTY` 模式；这个模式定义在 [QualityRuleMerger.py:17](E:/Project/LinguaGacha/module/QualityRule/QualityRuleMerger.py#L17) 和 [QualityRuleMerger.py:25](E:/Project/LinguaGacha/module/QualityRule/QualityRuleMerger.py#L25)。
对 glossary 来说，它只补 `dst/info` 空位，不改 `case_sensitive`，对应逻辑在 [QualityRuleMerger.py:272](E:/Project/LinguaGacha/module/QualityRule/QualityRuleMerger.py#L272) 和 [QualityRuleMerger.py:273](E:/Project/LinguaGacha/module/QualityRule/QualityRuleMerger.py#L273)。

8. 合并完才真正写入术语表。
最后通过 `batch_service.update_batch(...)` 写入正式 glossary，入口还是 [DataManager.py:1586](E:/Project/LinguaGacha/module/Data/DataManager.py#L1586)。

**补充**
还有个很容易看漏的小点：界面上的“候选术语数量”其实已经是“可导入的正式术语数量”了，因为 [DataManager.py:1366](E:/Project/LinguaGacha/module/Data/DataManager.py#L1366) 直接返回 `len(build_analysis_glossary_from_candidates())`，也就是已经走过“票选 + 过滤”后的结果，而不是原始 observation 数量。

📝 补充修正：从 2026-03-11 这次规则调整开始，`info` 为空的候选术语也不会再导入正式术语表。
