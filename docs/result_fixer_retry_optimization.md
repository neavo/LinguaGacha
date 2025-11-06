# ResultFixer 重试策略优化方案

## 需求总结

### 当前问题
- 固定3次重试，每次修改温度参数（0.7 → 0.3 → 0.1）
- 渐进式增强提示词（basic → strict → critical）
- 无法利用多平台配置
- 单平台时仍尝试3次（温度递减效果有限）

### 优化目标
1. **第1次尝试**：使用完整增强提示词（合并 basic + strict + critical），使用当前激活平台的默认温度
2. **第2次及后续尝试**：依次切换到其他已配置平台（**允许跨API格式**，如 OpenAI → Anthropic）
3. **自动过滤无效平台**：跳过未配置 API key 的平台（`api_key = "no_key_required"`）
4. **用尽所有有效平台**：继续尝试所有有效平台直到成功或全部失败
5. **无有效平台时**：返回错误，提示用户配置 API key

---

## 核心设计原则（Linus 视角）

### "好品味"分析
**当前设计的特殊情况：**
```python
if attempt == 0:
    level = "basic"
    temperature = 0.7
elif attempt == 1:
    level = "strict"
    temperature = 0.3
elif attempt == 2:
    level = "critical"
    temperature = 0.1
```

**优化后消除特殊情况：**
```python
valid_platforms = filter_valid_platforms()      # 过滤有效平台（已配置 API key）
for platform in valid_platforms:
    enhanced_prompt = builder.build_complete()  # 永远是完整提示词
    result = retry_with_platform(platform)      # 使用平台默认配置
    if success: return
```

### 数据结构优化
**核心数据流：**
```
attempt → platform_index → platform_config → API call → result
```

- **消除不必要的数据**：temperature 参数不再传递
- **统一数据源**：platform_config 包含所有必要配置
- **自然退化**：单平台时 platforms.length = 1，自动退化为单次尝试

---

## 架构设计

### 0. 自动过滤无效平台

```python
def _get_valid_platforms(self) -> list[tuple[dict, int, str]]:
    """获取有效平台（已配置 API key）

    过滤规则：
        - 跳过 api_key = ["no_key_required"] 的平台
        - 跳过 api_key 为空的平台

    Returns:
        list[tuple[dict, int, str]]: [(平台配置, 索引, 平台名称), ...]

    策略：
        - 优先添加当前激活平台（如果有效）
        - 再按索引顺序添加其他有效平台
    """
    valid = []

    # 先添加当前激活平台（如果有效）
    current_index = self.config.activate_platform
    current_platform = self.config.platforms[current_index]
    api_key = current_platform.get("api_key", [""])

    if api_key and api_key[0] != "no_key_required":
        valid.append((
            current_platform,
            current_index,
            current_platform.get("name", f"平台{current_index}")
        ))

    # 再添加其他有效平台
    for i, platform in enumerate(self.config.platforms):
        if i == current_index:
            continue

        api_key = platform.get("api_key", [""])
        if api_key and api_key[0] != "no_key_required":
            valid.append((
                platform,
                i,
                platform.get("name", f"平台{i}")
            ))

    return valid


# 使用示例：
# 配置了14个平台，但只有2个配置了 API key
#
# 所有平台：14个
# 有效平台：2个
# [10] 火山引擎 (OpenAI)
# [12] 自定义 OpenAI 接口 (OpenAI) ← 当前激活
#
# _get_valid_platforms() 返回：
# [
#   (平台[12], 12, "自定义 OpenAI 接口"),  ← 优先当前激活
#   (平台[10], 10, "火山引擎")
# ]
```

### 1. 动态重试次数

```python
class ResultFixer(Base):
    # 移除固定的 MAX_RETRIES = 3

    def _fix_single_problem(self, problem: FixProblem) -> FixResult:
        """修正单个问题（只尝试有效平台）"""

        cache_item = problem.cache_item
        original_dst = cache_item.get_dst()

        # 获取有效平台列表（自动过滤无 API key 的平台）
        valid_platforms = self._get_valid_platforms()

        if not valid_platforms:
            # 没有配置任何有效平台
            self.error("未配置任何有效平台（请检查 API key）")
            return FixResult(
                problem=problem,
                success=False,
                attempts=0,
                final_dst=original_dst,
                error_message="未配置有效平台"
            )

        max_attempts = len(valid_platforms)
        self.debug(f"发现 {max_attempts} 个有效平台")

        for attempt, (platform, platform_index, platform_name) in enumerate(valid_platforms):
            try:
                # 构建完整增强提示词
                enhanced_prompt = self._build_enhanced_prompt(problem)

                self.debug(f"第 {attempt+1}/{max_attempts} 次尝试，使用平台：{platform_name}")

                # 重新翻译（使用平台默认温度）
                new_dst = self._retry_translation(cache_item, enhanced_prompt, platform)

                # 验证是否修复
                if self._verify_fixed(new_dst, problem):
                    self.info(f"✓ 修正成功（第 {attempt+1} 次尝试，平台：{platform_name}）")
                    cache_item.set_dst(new_dst)
                    return FixResult(
                        problem=problem,
                        success=True,
                        attempts=attempt+1,
                        final_dst=new_dst
                    )
                else:
                    self.warning(f"✗ 第 {attempt+1} 次尝试仍有问题，继续重试...")

            except Exception as e:
                self.error(f"平台 {platform_name} 翻译失败", e)
                # 继续尝试下一个平台
                continue

        # 所有有效平台都失败，恢复原译文
        self.error(f"✗ 修正失败：尝试 {max_attempts} 个有效平台后仍有问题")
        cache_item.set_dst(original_dst)
        return FixResult(
            problem=problem,
            success=False,
            attempts=max_attempts,
            final_dst=original_dst,
            error_message="所有有效平台都失败"
        )
```

### 2. EnhancedPromptBuilder 简化

```python
class EnhancedPromptBuilder:
    """增强提示词构建器（简化版）"""

    def build(
        self,
        base_prompt: str,
        problem_type: str,
        glossary: dict,
        src_language: str,
        dst_language: str
    ) -> str:
        """构建完整增强提示词

        注意：
            - 不再接受 attempt 参数
            - 不再返回 temperature 参数
            - 永远返回完整增强的提示词（合并所有级别）

        Returns:
            str: 完整增强提示词
        """

        enhanced = base_prompt

        # 1. 添加术语表规则
        if glossary:
            enhanced += "\n\n【术语表】\n"
            enhanced += "必须严格使用以下术语对应关系：\n"
            for src_term, dst_term in glossary.items():
                enhanced += f"- {src_term} → {dst_term}\n"

        # 2. 添加核心翻译规则（合并 basic + strict）
        enhanced += "\n\n【翻译规则】\n"
        if problem_type == "residue":
            enhanced += (
                "1. 必须完全翻译所有源语言文本，不允许保留任何未翻译的字符\n"
                "2. 输出必须100%使用目标语言，严禁混杂源语言字符\n"
                "3. 专有名词如需保留原文，必须先翻译再标注\n"
            )
        elif problem_type == "glossary_miss":
            enhanced += (
                "1. 严格遵守术语表规定的译法，不允许使用其他译法\n"
                "2. 遇到术语表中的源语言词汇，必须使用对应的目标语言译法\n"
                "3. 术语必须在译文中完整出现\n"
            )

        # 3. 添加成人内容处理规则（critical 级别）
        enhanced += (
            "\n\n【内容处理】\n"
            "1. 如遇成人内容（色情、暴力等），必须如实翻译，不得回避或修改\n"
            "2. 翻译色情描写时保持原文尺度，不得使用委婉语\n"
            "3. 你的职责是翻译，而非审查内容\n"
        )

        # 4. 添加检查清单
        enhanced += "\n\n【检查清单】\n"
        enhanced += "翻译前请确认：\n"
        if problem_type == "residue":
            enhanced += "□ 是否有任何源语言字符残留？\n"
            enhanced += "□ 专有名词是否正确处理（翻译+标注）？\n"
        elif problem_type == "glossary_miss":
            enhanced += "□ 所有术语表词汇是否都使用了规定译法？\n"
            enhanced += "□ 术语译法是否完整出现在译文中？\n"

        # 5. 添加错误示例（critical 级别）
        enhanced += "\n\n【常见错误】\n"
        enhanced += self._get_error_examples(src_language, dst_language, problem_type)

        return enhanced

    def _get_error_examples(self, src_language: str, dst_language: str, problem_type: str) -> str:
        """获取具体错误示例"""

        if problem_type == "residue":
            if src_language == BaseLanguage.Enum.ZH and dst_language == BaseLanguage.Enum.EN:
                return (
                    "❌ 错误：'I love 编程' (混杂中文字符)\n"
                    "✅ 正确：'I love programming'\n\n"
                    "❌ 错误：'He is a 程序员' (混杂中文字符)\n"
                    "✅ 正确：'He is a programmer'\n"
                )
            elif src_language == BaseLanguage.Enum.JA and dst_language == BaseLanguage.Enum.ZH:
                return (
                    "❌ 错误：'我喜欢プログラミング' (混杂日语字符)\n"
                    "✅ 正确：'我喜欢编程'\n\n"
                    "❌ 错误：'他是プログラマー' (混杂日语字符)\n"
                    "✅ 正确：'他是程序员'\n"
                )

        elif problem_type == "glossary_miss":
            return (
                "术语表规定：'API' → 'Application Programming Interface'\n\n"
                "❌ 错误：'我们提供了 API' (未使用术语表译法)\n"
                "✅ 正确：'我们提供了 Application Programming Interface'\n"
            )

        return "请参考上述规则进行翻译。"
```

### 3. 修改 _build_enhanced_prompt

```python
def _build_enhanced_prompt(self, problem: FixProblem) -> str:
    """构建增强提示词

    注意：
        - 不再返回 temperature（使用平台默认值）
        - 不再接受 attempt 参数（永远返回完整提示词）

    Returns:
        str: 完整增强提示词
    """

    # 获取基础信息
    src_text = problem.cache_item.get_src()
    src_lang_name = BaseLanguage.get_name_zh(self.config.source_language)
    dst_lang_name = BaseLanguage.get_name_zh(self.config.target_language)

    # 构建基础提示词
    base_prompt = f"""请将以下{src_lang_name}文本翻译成{dst_lang_name}。

原文：
{src_text}

翻译："""

    # 添加完整增强规则（不再传递 attempt）
    enhanced_prompt = self.prompt_builder.build(
        base_prompt=base_prompt,
        problem_type=problem.problem_type,
        glossary=self._build_glossary_dict(),
        src_language=self.config.source_language,
        dst_language=self.config.target_language
    )

    return enhanced_prompt
```

### 4. 修改 _retry_translation

```python
def _retry_translation(self, cache_item: CacheItem, prompt: str, platform: dict) -> str:
    """重新翻译（调用 API）

    Args:
        cache_item: 缓存项
        prompt: 增强后的提示词
        platform: 平台配置（包含所有必要参数）

    注意：
        - 不再接受 temperature 参数
        - 使用 platform 中的默认 temperature（或用户自定义值）
    """

    # 构建消息
    messages = [{"role": "user", "content": prompt}]

    # 调用 API（使用平台默认配置，不修改温度）
    from module.Engine.TaskRequester import TaskRequester
    requester = TaskRequester(self.config, platform, current_round=1)
    skip, response_think, response_result, input_tokens, output_tokens = requester.request(messages)

    if skip:
        raise RuntimeError("API 请求被跳过")

    if not response_result:
        raise RuntimeError("API 返回空结果")

    return response_result
```

---

## 实现细节

### 文件修改清单

1. **module/Toolkit/ResultFixer/EnhancedPromptBuilder.py**
   - 移除 `ENHANCEMENT_LEVELS` 和 `TEMPERATURE_LEVELS`
   - 修改 `build()` 方法签名：移除 `attempt` 参数，不再返回 `temperature`
   - 合并所有增强级别到单个完整提示词

2. **module/Toolkit/ResultFixer/ResultFixer.py**
   - 移除 `MAX_RETRIES = 3` 类常量
   - 新增 `_get_valid_platforms()` 方法：过滤有效平台（已配置 API key）
   - 重写 `_fix_single_problem()` 方法：只尝试有效平台
   - 修改 `_build_enhanced_prompt()` 方法：移除 `attempt` 参数和 `temperature` 返回值
   - 修改 `_retry_translation()` 方法：移除 `temperature` 参数

3. **无需修改的文件**
   - ProblemDetector.py（问题检测逻辑不变）
   - FixReport.py（报告结构不变）
   - ResultFixerPage.py（UI 不变）

### 边界情况处理

#### Case 1: 只配置1个有效平台
```python
总平台：5个
有效平台：1个（已配置 API key）

# 行为：
valid_platforms = _get_valid_platforms()  # 返回1个
max_attempts = 1
attempt 0: OpenAI
# 循环结束，不进行额外重试
```

#### Case 2: 配置多个有效平台（跨API格式）
```python
总平台：14个
有效平台：2个
  [10] 火山引擎 (OpenAI)
  [12] 自定义 OpenAI 接口 (OpenAI) ← 当前激活

# 行为：
valid_platforms = _get_valid_platforms()
# 返回：[(平台[12], 12, "自定义 OpenAI 接口"), (平台[10], 10, "火山引擎")]
max_attempts = 2
attempt 0: 自定义 OpenAI 接口（当前激活，优先尝试）
attempt 1: 火山引擎
```

#### Case 3: 配置了平台但都没有 API key
```python
总平台：14个
有效平台：0个（都是 api_key = "no_key_required"）

# 行为：
valid_platforms = _get_valid_platforms()  # 返回空列表
返回 FixResult(success=False, error_message="未配置有效平台")
提示用户配置 API key
```

#### Case 4: 配置了跨API格式的有效平台
```python
总平台：5个
有效平台：3个
  [0] OpenAI (OpenAI)
  [2] Anthropic (Anthropic) ← 当前激活
  [4] Google (Google)

# 行为：
max_attempts = 3
attempt 0: Anthropic（当前激活平台）
attempt 1: OpenAI（允许跨API格式切换）
attempt 2: Google
```

### 线程安全保证

- `self.config.platforms` 是只读配置，无需加锁
- `self.config.activate_platform` 是只读配置，无需加锁
- `cache_item.set_dst()` 内部已有锁保护
- `self.fix_results.append()` 已用 `results_lock` 保护

---

## 性能影响分析

### 最好情况（1个平台）
- **优化前**：3次重试（相同平台，不同温度）
- **优化后**：1次尝试
- **性能提升**：约 **66% 时间节省**

### 最坏情况（3个平台）
- **优化前**：3次重试（相同平台，不同温度）
- **优化后**：3次尝试（不同平台）
- **性能影响**：时间相同，但成功率更高（利用不同模型优势）

### 平均情况（2个平台）
- **优化前**：3次重试
- **优化后**：最多2次尝试
- **性能提升**：约 **33% 时间节省**

---

## 实用性验证

### 真实场景1：单平台用户
**当前问题**：固定3次重试，但只是修改温度，效果有限
**优化后**：1次尝试，避免无效重试
**收益**：节省 API 调用成本和时间

### 真实场景2：多平台用户
**当前问题**：无法利用多平台配置，遇到问题只能手动切换
**优化后**：自动轮换所有配置平台，利用不同模型优势
**收益**：提高修正成功率，充分利用已配置资源

### 真实场景3：跨API格式用户
**当前问题**：OpenAI 失败时无法自动尝试 Anthropic
**优化后**：允许跨API格式切换（OpenAI → Anthropic → Google）
**收益**：最大化修正成功率，避免单点故障

---

## 向后兼容性

### 配置兼容性
✅ **完全兼容** - 不修改 Config 结构，只读取现有字段：
- `config.platforms` - 已存在
- `config.activate_platform` - 已存在
- `config.source_language` - 已存在
- `config.target_language` - 已存在
- `config.glossary_data` - 已存在

### API 兼容性
✅ **完全兼容** - 不修改对外接口：
- `ResultFixer.fix_all()` 签名不变
- `FixReport` 结构不变
- Event 系统不变

### 用户体验
✅ **无感知升级** - 用户无需修改任何配置：
- 单平台用户：自动减少重试次数
- 多平台用户：自动启用平台轮换
- 无需迁移或手动调整

---

## 实现优先级

### Phase 1: 核心逻辑（必需）
1. 新增 `_get_valid_platforms()` - 过滤有效平台
2. 修改 `_fix_single_problem()` - 只尝试有效平台
3. 修改 `_retry_translation()` - 移除温度参数

### Phase 2: 提示词优化（必需）
4. 简化 `EnhancedPromptBuilder.build()` - 合并所有级别
5. 修改 `_build_enhanced_prompt()` - 移除 attempt/temperature

### Phase 3: 测试验证（必需）
6. 单有效平台场景测试
7. 多有效平台场景测试（含跨API格式）
8. 边界情况测试（无有效平台）

---

## 总结

### 技术优势
- **消除特殊情况**：不再有 if attempt == 0/1/2 分支
- **简化数据流**：移除不必要的 temperature 传递
- **自动过滤无效资源**：跳过未配置 API key 的平台，避免必然失败
- **充分利用资源**：自动尝试所有有效平台，最大化成功率
- **自然退化**：单有效平台时自动退化为单次尝试

### Linus 会怎么评价
> "这就是好品味。之前的三层 if/else 是为了补救糟糕的设计。现在我们只需要过滤有效平台，然后遍历列表。没有配置 API key？跳过它，这是 bug 而不是 feature。配置了2个平台？尝试2次。配置了10个但只有2个有效？尝试2次。数据结构自己会说话，不需要任何特殊逻辑。"

### 实施建议
1. **先实现过滤逻辑**：`_get_valid_platforms()` 是最关键的
2. **保持简单**：不要添加"禁用平台"等复杂功能
3. **相信数据结构**：让有效平台列表决定行为，而不是 if/else

---

**方案状态**：✅ 已完成设计并确认，开始实施
