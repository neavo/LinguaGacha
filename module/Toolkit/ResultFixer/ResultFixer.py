"""
结果修正器 - 主流程控制器

协调整个修正流程：检测问题 → 重翻修正 → 生成报告
"""

import os
import json
import shutil
import random
import threading
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Cache.CacheManager import CacheManager
from module.Cache.CacheItem import CacheItem
from module.Config import Config
from .ProblemDetector import ProblemDetector, FixProblem
from .EnhancedPromptBuilder import EnhancedPromptBuilder
from .FixReport import FixReport, FixResult


class ResultFixer(Base):
    """结果修正器 - 主流程控制器"""

    def __init__(self, cache_manager: CacheManager):
        super().__init__()
        self.cache_manager = cache_manager
        self.config = Config().load()
        self.prompt_builder = EnhancedPromptBuilder()
        self.fix_results: list[FixResult] = []

    def fix_all(self) -> FixReport:
        """主流程：修正所有问题"""

        # 1. 获取当前项目和缓存数据
        self.info("加载项目缓存...")
        cache_project = self.cache_manager.get_project()
        cache_items = self.cache_manager.get_items()

        if not cache_items:
            raise ValueError("缓存数据为空")

        # 2. 备份原缓存
        self.info("备份原缓存...")
        backup_path = self._backup_cache(self.config.output_folder)
        self.info(f"备份完成：{backup_path}")

        # 3. 检测问题
        self.info("检测问题...")
        detector = ProblemDetector(
            src_language=self.config.source_language,
            dst_language=self.config.target_language,
            glossary=self._build_glossary_dict()
        )
        problems = detector.detect_all(cache_items)
        self.info(f"检测完成：发现 {len(problems)} 个问题")

        if not problems:
            self.info("没有发现问题，无需修正")
            return FixReport(total=0, fixed=0, failed=0, backup_path=backup_path)

        # 4. 并行修正
        self.info(f"开始并行修正 {len(problems)} 个问题...")

        # 获取有效平台信息并发送
        valid_platforms = self._get_valid_platforms()
        platform_names = [name for _, _, name in valid_platforms]
        self.emit(Base.Event.RESULT_FIXER_START, {
            "total": len(problems),
            "valid_platforms": platform_names
        })

        # 获取并发数配置（复用翻译引擎的配置）
        max_workers = self.config.max_workers if self.config.max_workers > 0 else 10
        self.info(f"使用 {max_workers} 个并发线程")

        # 线程安全的计数器和锁
        results_lock = threading.Lock()
        completed_count = 0

        # 使用线程池并发处理
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # 提交所有任务到线程池
            future_to_problem = {
                executor.submit(self._fix_single_problem, problem): problem
                for problem in problems
            }

            # 按完成顺序收集结果
            for future in as_completed(future_to_problem):
                try:
                    result = future.result()

                    # 线程安全地添加结果和更新计数
                    with results_lock:
                        self.fix_results.append(result)
                        completed_count += 1
                        current = completed_count

                    # 发送进度事件（包含详细信息）
                    src_preview = result.problem.cache_item.get_src()[:50]
                    if len(result.problem.cache_item.get_src()) > 50:
                        src_preview += "..."

                    # 最终译文片段（用于失败时显示）
                    final_dst_preview = result.final_dst[:50]
                    if len(result.final_dst) > 50:
                        final_dst_preview += "..."

                    self.emit(Base.Event.RESULT_FIXER_UPDATE, {
                        "current": current,
                        "total": len(problems),
                        "success": result.success,
                        "problem_type": result.problem.problem_type,
                        "problem_details": result.problem.details,
                        "attempts": result.attempts,
                        "src_preview": src_preview,
                        "final_dst_preview": final_dst_preview,
                        "platform_name": result.platform_name,
                        "error_message": result.error_message
                    })

                    # 优化后的日志：只显示计数，避免乱序
                    status_text = "成功" if result.success else "失败"
                    self.info(f"已完成 {current}/{len(problems)}（{status_text}）")

                except Exception as e:
                    self.error(f"修正任务执行失败", e)
                    with results_lock:
                        completed_count += 1

        # 5. 保存修正结果到缓存
        self.info("保存修正结果到缓存...")
        self.cache_manager.save_to_file(cache_project, cache_items, self.config.output_folder)

        # 6. 重新生成翻译文件（包括纯译文和双语对照）
        self.info("重新生成翻译文件...")
        from module.File.FileManager import FileManager
        FileManager(self.config).write_to_path(cache_items)
        self.info("翻译文件已更新")

        # 7. 生成报告
        report = self._generate_report(backup_path)
        self.info(f"修正完成：成功 {report.fixed}/{report.total}")

        # 8. 保存失败条目到结果检查文件
        self._save_failed_items_to_file(report)

        self.emit(Base.Event.RESULT_FIXER_DONE, {"report": report})

        return report

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
                platform_name="",
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
                        final_dst=new_dst,
                        platform_name=platform_name
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
            platform_name="",
            error_message="所有有效平台都失败"
        )

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

    def _retry_translation(self, cache_item: CacheItem, prompt: str, platform: dict) -> str:
        """重新翻译（调用 API）

        Args:
            cache_item: 缓存项
            prompt: 增强后的提示词
            platform: 平台配置（包含所有必要参数）

        注意：
            - 使用 0.4-0.8 之间的随机温度值
            - 临时修改 platform 的 temperature，调用后恢复
        """

        # 生成 0.4-0.8 之间的随机温度值
        random_temperature = round(random.uniform(0.4, 0.8), 2)

        # 保存原始温度
        original_temperature = platform.get("temperature", 1.0)

        # 临时设置随机温度
        platform["temperature"] = random_temperature
        self.debug(f"使用随机温度：{random_temperature}")

        try:
            # 构建消息
            messages = [{"role": "user", "content": prompt}]

            # 调用 API
            from module.Engine.TaskRequester import TaskRequester
            requester = TaskRequester(self.config, platform, current_round=1)
            skip, response_think, response_result, input_tokens, output_tokens = requester.request(messages)

            if skip:
                raise RuntimeError("API 请求被跳过")

            if not response_result:
                raise RuntimeError("API 返回空结果")

            return response_result
        finally:
            # 恢复原始温度
            platform["temperature"] = original_temperature

    def _verify_fixed(self, new_dst: str, problem: FixProblem) -> bool:
        """验证问题是否已修复"""

        if problem.problem_type == "residue":
            # 检测是否还有源语言残留
            detector = ProblemDetector(
                src_language=self.config.source_language,
                dst_language=self.config.target_language,
                glossary=self._build_glossary_dict()
            )

            # 创建临时 cache item 来检测
            from module.Cache.CacheItem import CacheItem as TempCacheItem
            temp_item = TempCacheItem(src="", dst=new_dst)
            residue = detector.detect_residue(temp_item)

            return residue is None

        elif problem.problem_type == "glossary_miss":
            # 检测术语是否生效
            glossary = self._build_glossary_dict()
            src = problem.cache_item.get_src()

            for src_term, dst_term in glossary.items():
                if src_term in src and dst_term not in new_dst:
                    return False  # 仍有术语未生效

            return True

        return False

    def _build_glossary_dict(self) -> dict:
        """构建术语表字典"""
        glossary = {}
        for item in self.config.glossary_data:
            if item.get("enable", True):
                glossary[item["src"]] = item["dst"]
        return glossary

    def _backup_cache(self, output_folder: str) -> str:
        """备份缓存文件夹"""
        cache_folder = f"{output_folder}/cache"
        if not os.path.exists(cache_folder):
            raise RuntimeError("缓存文件夹不存在")

        # 生成备份路径（带时间戳）
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_folder = f"{output_folder}/cache_backup_{timestamp}"

        # 复制整个缓存文件夹
        shutil.copytree(cache_folder, backup_folder)

        return backup_folder

    def _generate_report(self, backup_path: str) -> FixReport:
        """生成修正报告"""

        total = len(self.fix_results)
        fixed = sum(1 for r in self.fix_results if r.success)
        failed = total - fixed

        return FixReport(
            total=total,
            fixed=fixed,
            failed=failed,
            backup_path=backup_path,
            details=self.fix_results
        )

    def _save_failed_items_to_file(self, report: FixReport) -> None:
        """保存失败条目到结果检查文件

        规则：
            - 如果全部成功（failed = 0），删除已存在的文件
            - 如果有失败（failed > 0），生成/覆盖文件
        """

        # 定义文件路径
        result_check_file = f"{self.config.output_folder}/结果检查_智能修正失败.json"

        # 全部成功：删除文件（如果存在）
        if report.failed == 0:
            if os.path.exists(result_check_file):
                os.remove(result_check_file)
                self.info(f"所有问题修正成功，已删除结果检查文件")
            return

        # 有失败：生成文件
        self.info(f"生成结果检查文件：{report.failed} 个失败条目")

        # 问题类型中文化
        problem_type_zh_map = {
            "residue": "源语言残留",
            "glossary_miss": "术语未生效"
        }

        # 构建 JSON 数据
        result_data = {}

        for fix_result in self.fix_results:
            if not fix_result.success:  # 只保存失败的
                # 获取基本信息
                cache_item = fix_result.problem.cache_item
                file_path = cache_item.get_file_path()
                problem_type = fix_result.problem.problem_type
                problem_details = fix_result.problem.details
                src_text = cache_item.get_src()
                final_dst = fix_result.final_dst

                # 问题类型中文化
                problem_type_zh = problem_type_zh_map.get(problem_type, problem_type)

                # 构建 key：file_path | 问题类型（问题详情）
                key = f"{file_path} | {problem_type_zh}（{problem_details}）"

                # 构建 value：{"原文": "最终译文"}
                if key not in result_data:
                    result_data[key] = {}
                result_data[key][src_text] = final_dst

        # 保存到文件
        with open(result_check_file, "w", encoding="utf-8") as f:
            json.dump(result_data, f, ensure_ascii=False, indent=4)

        self.info(f"结果检查文件已保存：{result_check_file}")
