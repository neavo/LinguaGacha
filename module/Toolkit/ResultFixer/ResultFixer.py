"""
结果修正器 - 主流程控制器

协调整个修正流程：检测问题 → 重翻修正 → 生成报告
"""

import os
import shutil
from datetime import datetime

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

    MAX_RETRIES = 3  # 最大重试次数

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

        # 4. 统一重翻
        self.info(f"开始修正 {len(problems)} 个问题...")
        self.emit(Base.Event.RESULT_FIXER_START, {"total": len(problems)})

        for i, problem in enumerate(problems):
            self.info(f"修正进度：{i+1}/{len(problems)} - {problem.details}")
            result = self._fix_single_problem(problem)
            self.fix_results.append(result)

            # 发送进度事件
            self.emit(Base.Event.RESULT_FIXER_UPDATE, {
                "current": i+1,
                "total": len(problems),
                "success": result.success
            })

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

        self.emit(Base.Event.RESULT_FIXER_DONE, {"report": report})

        return report

    def _fix_single_problem(self, problem: FixProblem) -> FixResult:
        """修正单个问题（最多重试3次）"""

        cache_item = problem.cache_item
        original_dst = cache_item.get_dst()

        for attempt in range(self.MAX_RETRIES):
            self.debug(f"第 {attempt+1}/{self.MAX_RETRIES} 次尝试修正")

            try:
                # 构建增强提示词和温度参数
                enhanced_prompt, temperature = self._build_enhanced_prompt(problem, attempt)
                self.debug(f"使用温度参数：{temperature}")

                # 重新翻译
                new_dst = self._retry_translation(cache_item, enhanced_prompt, temperature)

                # 验证是否修复
                if self._verify_fixed(new_dst, problem):
                    self.info(f"✓ 修正成功（第 {attempt+1} 次尝试，温度={temperature}）")
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
                self.error(f"翻译失败", e)
                if attempt == self.MAX_RETRIES - 1:
                    # 最后一次失败，恢复原译文
                    cache_item.set_dst(original_dst)
                    return FixResult(
                        problem=problem,
                        success=False,
                        attempts=attempt+1,
                        final_dst=original_dst,
                        error_message=str(e)
                    )

        # 3次都失败，恢复原译文
        self.error(f"✗ 修正失败：尝试 {self.MAX_RETRIES} 次后仍有问题")
        cache_item.set_dst(original_dst)
        return FixResult(
            problem=problem,
            success=False,
            attempts=self.MAX_RETRIES,
            final_dst=original_dst,
            error_message="超过最大重试次数"
        )

    def _build_enhanced_prompt(self, problem: FixProblem, attempt: int) -> tuple[str, float]:
        """构建增强提示词和温度参数

        Returns:
            tuple[str, float]: (增强提示词, 温度参数)
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

        # 添加增强规则，同时获取温度参数
        enhanced_prompt, temperature = self.prompt_builder.build(
            base_prompt=base_prompt,
            problem_type=problem.problem_type,
            attempt=attempt,
            glossary=self._build_glossary_dict(),
            src_language=self.config.source_language,
            dst_language=self.config.target_language
        )

        return enhanced_prompt, temperature

    def _retry_translation(self, cache_item: CacheItem, prompt: str, temperature: float) -> str:
        """重新翻译（调用 API）

        Args:
            cache_item: 缓存项
            prompt: 增强后的提示词
            temperature: 温度参数
        """

        # 获取当前激活的平台
        platform = self.config.platforms[self.config.activate_platform]

        # 构建消息
        messages = [{"role": "user", "content": prompt}]

        # 临时修改平台配置中的温度参数
        original_temperature = platform.get("temperature", 1.0)
        platform["temperature"] = temperature

        try:
            # 调用 API（复用 TaskRequester）
            from module.Engine.TaskRequester import TaskRequester
            requester = TaskRequester(self.config, platform, current_round=1)
            skip, response_think, response_result, input_tokens, output_tokens = requester.request(messages)

            if skip:
                raise RuntimeError("API 请求被跳过")

            if not response_result:
                raise RuntimeError("API 返回空结果")

            return response_result
        finally:
            # 恢复原始温度参数
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
