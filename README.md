<div align=center><img src="https://github.com/user-attachments/assets/de19ec3f-246c-432d-9636-ff16f82b094e" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>使用 AI 能力一键翻译 小说、游戏、字幕 等文本内容的次世代文本翻译器</p>

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## 概述 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，简称 `LG`，使用 AI 技术次世代文本翻译器
- 支持 `中` `英` `日` `韩` `俄` 等多种语言的一键互译
- 支持 `小说`、`字幕`、`游戏文本` 等多种文本类型与文本格式
- 支持 `Claude`、`ChatGPT`、`DeepSeek`、`SakuraLLM` 等各种本地或在线接口

> <img src="https://github.com/user-attachments/assets/859a7e32-bf35-4572-8460-4ecb11a8d20c" style="width: 80%;">

> <img src="https://github.com/user-attachments/assets/c0d7e898-f6fa-432f-a3cd-e231b657c4b5" style="width: 80%;">

## 特别说明 ⚠️
- 如您在翻译过程中使用了 [LinguaGacha](https://github.com/neavo/LinguaGacha) ，请在作品信息或发布页面的显要位置进行说明！
- 如您的项目涉及任何商业行为或者商业收益，在使用 [LinguaGacha](https://github.com/neavo/LinguaGacha)  前，请先与作者联系以获得授权！

## 功能优势 📌
- 极快的翻译速度，十秒钟一份字幕，一分钟一本小说，五分钟一部游戏
- 自动生成术语表，保证角色姓名等专有名词在整部作品中的译名统一  `👈👈 独家绝技`
- 最优的翻译质量，无论是 旗舰模型 `诸如 DeepSeek-R1` 还是 本地小模型 `诸如 Qwen2.5-7B`
- `100%` 精确还原文本样式与文本内代码，显著减少后期工作量，是制作内嵌汉化的最佳选择  `👈👈 独家绝技`

## 配置要求 🖥️
- 兼容 `OpenAI` `Google` `Anthropic` `SakuraLLM` 标准的 AI 大模型接口
- 兼容 [KeywordGacha](https://github.com/neavo/KeywordGacha) `👈👈 使用 AI 能力一键生成术语表的次世代工具`

## 使用流程 🛸
- 从 [发布页](https://github.com/neavo/LinguaGacha/releases) 下载应用
- 获取一个可靠的 AI 大模型接口，建议以下两种选择其一：
  - [本地接口 - 点击查看教程](https://github.com/neavo/OneClickLLAMA)，免费，需至少 8G 显存的独立显卡，Nvidia 显卡为佳
  - [DeepSeek - 点击查看教程](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)，需付费但便宜，速度快，质量高，无显卡要求 `👈👈 推荐`
- 准备要翻译的文本
  - `字幕`、`电子书` 等一般不需要预处理
  - `游戏文本` 需要根据游戏引擎选择合适的工具进行提取
- 双击 `app.exe` 启动应用
  - 在 `项目设置` 中设置原文语言、译文语言等必要信息
  - 将要翻译的文本文件复制到输入文件夹（默认为 `input` 文件夹），在 `开始翻译` 中点击开始翻译
- 你可以在 [Wiki](https://github.com/neavo/LinguaGacha/wiki) 找到各项功能的更详细介绍，也欢迎在 [讨论区](https://github.com/neavo/LinguaGacha/discussions) 投稿你的使用心得

## 文本格式 🏷️
- 在任务开始时，`LG` 将读取输入文件夹（及其子目录）内所有支持的文件，包括但是不限于：
  - 字幕（.srt .ass）
  - 电子书（.txt .epub）
  - [RenPy](https://www.renpy.org) 导出游戏文本（.rpy）
  - [MTool](https://afdian.com/a/AdventCirno) 导出游戏文本（.json）
  - [SExtractor](https://github.com/satan53x/SExtractor) 导出游戏文本（.txt .json .xlsx）
  - [Translator++](https://dreamsavior.net/translator-plusplus) 导出游戏文本（.xlsx）
- 具体示例可见 [Wiki - 支持的文件格式](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F)，更多格式将持续添加，你也可以在 [ISSUES](https://github.com/neavo/LinguaGacha/issues) 中提出你的需求

## 近期更新 📅
- 20250226 v0.7.3
  - 调整 - 优化 EPUB 样式与兼容性

- 20250225 v0.7.2
  - 新增 - 支持 Cladue Sonnet 3.7 思考模式
  - 修正 - 繁体输出时术语表检查结果不正确的问题

- 20250224 v0.7.1
  - 新增 - 支持 RenPy 文本的代码保留与检测
  - 调整 - 显著降低了高并发任务数量时的 CPU 占用率

- 20250223 v0.6.4
  - 调整 - 英文 RPGMaker 游戏兼容性优化
  - 调整 - 实时任务数较多时禁用详细日志的打印

- 20250221 v0.6.3
  - 细节调整

- 20250220 v0.6.2
  - 调整 - 更好的保留 EPUB 文件的原有样式
  - 调整 - 较小的性能优化

- 20250218 v0.6.1
  - 新增 - 国际化 UI `中文` `English`
  - 调整 - 翻译速度优化
  - 调整 - 破限能力强化

## 常见问题 📥
- [LinguaGacha](https://github.com/neavo/LinguaGacha) 与 [AiNiee](https://github.com/NEKOparapa/AiNiee) 的关系
  - `LinguaGacha` 是吸取了 `AiNiee` 的经验以后开发的全新的翻译器应用
  - `LinguaGacha` 的作者也是 `AiNiee v5` 的主要开发与维护者之一

## 问题反馈 😥
- 运行时的日志保存在应用根目录下的 `log` 等文件夹
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/kX7UnxnKje
