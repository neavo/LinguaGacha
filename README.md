<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>使用 AI 能力一键翻译 小说、游戏、字幕 等文本内容的次世代文本翻译器</p>

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## 概述 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，使用 AI 技术次世代文本翻译器
- 开箱即用，（几乎）无需设置，功能的强大，不需要通过繁琐的设置来体现
- 支持 `中` `英` `日` `韩` `俄` `德` `法` `意` 等 16 种语言的一键互译
- 支持 `字幕`、`电子书`、`游戏文本` 等多种文本类型与文本格式
- 支持 `Claude`、`ChatGPT`、`DeepSeek`、`SakuraLLM` 等各种本地或在线接口

> <img src="https://github.com/user-attachments/assets/99f7d74e-ab5b-4645-b736-6f665782b4af" style="width: 80%;">

> <img src="https://github.com/user-attachments/assets/c0d7e898-f6fa-432f-a3cd-e231b657c4b5" style="width: 80%;">

## 特别说明 ⚠️
- 如您在翻译过程中使用了 [LinguaGacha](https://github.com/neavo/LinguaGacha) ，请在作品信息或发布页面的显要位置进行说明！
- 如您的项目涉及任何商业行为或者商业收益，在使用 [LinguaGacha](https://github.com/neavo/LinguaGacha)  前，请先与作者联系以获得授权！

## 功能优势 📌
- 极快的翻译速度，十秒钟一份字幕，一分钟一本小说，五分钟一部游戏
- 自动生成术语表，保证角色姓名等专有名词在整部作品中的译名统一　`👈👈 独家绝技`
- 最优的翻译质量，无论是 旗舰模型 `诸如 DeepSeek-R1` 还是 本地小模型　`诸如 Qwen2.5-7B`
- 同类应用中最强的样式与代码保留能力，显著减少后期工作量，是制作内嵌汉化的最佳选择
  - `.md` `.ass` `.epub` 格式几乎可以保留所有原有样式
  - 大部分的 `WOLF`、`RenPy`、`RPGMaker`、`Kirikiri` 引擎游戏无需人工处理，即翻即玩　`👈👈 独家绝技`

## 配置要求 🖥️
- 兼容 `OpenAI` `Google` `Anthropic` `SakuraLLM` 标准的 AI 大模型接口
- 兼容 [KeywordGacha](https://github.com/neavo/KeywordGacha)　`👈👈 使用 AI 能力一键生成术语表的次世代工具`

## 基本流程 🛸
- 从 [发布页](https://github.com/neavo/LinguaGacha/releases) 下载应用
- 获取一个可靠的 AI 大模型接口，建议选择其一：
  - [ [本地接口](https://github.com/neavo/OneClickLLAMA) ]，免费，需至少 8G 显存的独立显卡，Nvidia 显卡为佳
  - [ [火山引擎](https://github.com/neavo/LinguaGacha/wiki/VolcEngine) ]，需付费但便宜，速度快，质量高，无显卡要求　`👈👈 推荐`
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ]，需付费但便宜，速度快，质量高，无显卡要求 `👈👈 白天不稳定，备选`
- 准备要翻译的文本
  - `字幕`、`电子书` 等一般不需要预处理
  - `游戏文本` 需要根据游戏引擎选择合适的工具进行提取
- 双击 `app.exe` 启动应用
  - 在 `项目设置` 中设置原文语言、译文语言等必要信息
  - 将要翻译的文本文件复制到输入文件夹（默认为 `input` 文件夹），在 `开始翻译` 中点击开始翻译

## 使用教程 📝
- 综合
  - [基础教程](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈👈 手把手教学，有手就行，新手必看`
  - [Google Gemini 免费接口](https://github.com/neavo/LinguaGacha/wiki/GoogleGeminiFree)
  - [高质量翻译 WOLF 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLF)
  - [高质量翻译 RenPy 引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [高质量翻译 RPGMaker 系列引擎游戏的最佳实践](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- 视频教程
  - [How to Translate RPGMV with LinguaGacha and Translator++ (English)](https://www.youtube.com/watch?v=wtV_IODzi8I)
- 功能说明
  - [命令行模式](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
  - [术语表](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[文本保护](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[文本替换](https://github.com/neavo/LinguaGacha/wiki/Replacement)　　
  - [补充翻译](https://github.com/neavo/LinguaGacha/wiki/IncrementalTranslation)　　[MTool 优化器](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)
  - [百宝箱 - 批量修正](https://github.com/neavo/LinguaGacha/wiki/BatchCorrection)　　[百宝箱 - 部分重翻](https://github.com/neavo/LinguaGacha/wiki/ReTranslation)　　[百宝箱 - 姓名字段提取](https://github.com/neavo/LinguaGacha/wiki/NameFieldExtraction)
- 你可以在 [Wiki](https://github.com/neavo/LinguaGacha/wiki) 找到各项功能的更详细介绍，也欢迎在 [讨论区](https://github.com/neavo/LinguaGacha/discussions) 投稿你的使用心得

## 文本格式 🏷️
- 在任务开始时，应用将读取输入文件夹（及其子目录）内所有支持的文件，包括但是不限于：
  - 字幕（.srt .ass）
  - 电子书（.txt .epub）
  - Markdown（.md）
  - [RenPy](https://www.renpy.org) 导出游戏文本（.rpy）
  - [MTool](https://mtool.app) 导出游戏文本（.json）
  - [SExtractor](https://github.com/satan53x/SExtractor) 导出游戏文本（.txt .json .xlsx）
  - [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools) 导出游戏文本（.json）
  - [Translator++](https://dreamsavior.net/translator-plusplus) 项目文件（.trans）
  - [Translator++](https://dreamsavior.net/translator-plusplus) 导出游戏文本（.xlsx）
  - [WOLF 官方翻译工具](https://silversecond.booth.pm/items/5151747) 导出游戏文本（.xlsx）
- 具体示例可见 [Wiki - 支持的文件格式](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F)，更多格式将持续添加，你也可以在 [ISSUES](https://github.com/neavo/LinguaGacha/issues) 中提出你的需求

## 近期更新 📅
- 20260112 v0.30.0
  - 新增 - 替换与术语表功能支持 `大小写敏感` #291
  - 新增 - 自动处理前后缀的保护文本段（专家设置） #259
  - 调整 - 注音清理兼容性优化
  - 修正 - 用户反馈问题 #251 #289 #290

- 20260111 v0.29.6
  - 修正 - 应用图标丢失的问题
  - 修正 - 偶发的行数显示不正确的问题
  - 修正 - 修正不能正常停止翻译的问题（继续）
  - 调整 - Qwen3 系列模型不再支持 `优先使用思考模式`

- 20260102 v0.29.4
  - 修正 - 部分百宝箱功能使用时会崩溃的问题

- 20251231 v0.29.3
  - 新增 - 设置选项：任务输入长度阈值、任务输出长度阈值
  - 调整 - 使用思考模型功能支持更多模型 [→ 支持优先使用思考模式的模型列表 ←](https://github.com/neavo/LinguaGacha/wiki/ModelListForThinkingModePriority)
  - 修正 - 最后一个密钥不会被使用的问题
  - 修正 - 密钥为空时获取模型列表会崩溃的问题
  - 兼容性优化

## 常见问题 📥
- [LinguaGacha](https://github.com/neavo/LinguaGacha) 与 [AiNiee](https://github.com/NEKOparapa/AiNiee) 的关系
  - `LinguaGacha` 的作者是 `AiNiee v5` 的主要开发与维护者之一
  - `AiNiee v5` 及延用至 `AiNiee v6` 的 UI 框架也是由作者主要负责设计和开发的
  - 这也是两者 UI 相似的原因，因为作者已经没有灵感再重新设计一套了，求放过 🤣
  - 不过 `LinguaGacha` 并不是 `AiNiee` 的分支版本，而是在其经验上开发的全新翻译器应用
  - 相对作者主力开发的 `AiNiee v5`，`LinguaGacha` 有一些独有的优势，包括但是不限于：
    - 零设置，全默认设置下即可实现最佳的翻译质量与翻译速度
    - 更好的性能优化，即使 512+ 并发任务时电脑也不会卡顿，实际翻译速度也更快
    - 原生支持 `.rpy` `.trans`，大部分 `WOLF`、`RenPy`、`RPGMaker`、`Kirikiri` 游戏即翻即玩
    - 对文件格式的支持更好，例如 `.md` `.ass` `.epub` 格式几乎可以保留所有原有样式
    - 更完善的预处理、后处理和结果检查功能，让制作高品质翻译的校对工作量显著减少

## 问题反馈 😥
- 运行时的日志保存在应用根目录下的 `log` 等文件夹
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
