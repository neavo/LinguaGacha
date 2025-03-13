<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>使用 AI 能力一键翻译 小说、游戏、字幕 等文本内容的次世代文本翻译器</p>

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## 概述 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)，简称 `LG`，使用 AI 技术次世代文本翻译器
- 开箱即用，（几乎）无需设置，功能的强大，不需要通过繁琐的设置来体现
- 支持 `中` `英` `日` `韩` `俄` `德` `法` `意` 等 13 种语言的一键互译
- 支持 `字幕`、`电子书`、`游戏文本` 等多种文本类型与文本格式
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

## 基本流程 🛸
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

## 使用教程 📝
- 图文教程
  - [基础教程](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial) `👈👈 手把手教学，有手就行，新手必看`
- 视频教程
  - [RenPy 引擎游戏 AI 汉化视频教程（中文）](https://space.bilibili.com/631729629/lists/4832968)
  - [How to Translate RPGMV with LinguaGacha and Translator++ (English)](https://www.youtube.com/watch?v=wtV_IODzi8I)
- 进阶教程
  - [ [术语表](https://github.com/neavo/LinguaGacha/wiki/%E6%9C%AF%E8%AF%AD%E8%A1%A8) ] | [ [译前替换与译后替换](https://github.com/neavo/LinguaGacha/wiki/%E8%AF%91%E5%89%8D%E6%9B%BF%E6%8D%A2%E4%B8%8E%E8%AF%91%E5%90%8E%E6%9B%BF%E6%8D%A2) ] | [ [MTool 优化器](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer) ]
- 你可以在 [Wiki](https://github.com/neavo/LinguaGacha/wiki) 找到各项功能的更详细介绍，也欢迎在 [讨论区](https://github.com/neavo/LinguaGacha/discussions) 投稿你的使用心得

## 文本格式 🏷️
- 在任务开始时，`LG` 将读取输入文件夹（及其子目录）内所有支持的文件，包括但是不限于：
  - 字幕（.srt .ass）
  - 电子书（.txt .epub）
  - Markdown（.md）
  - [RenPy](https://www.renpy.org) 导出游戏文本（.rpy）
  - [MTool](https://afdian.com/a/AdventCirno) 导出游戏文本（.json）
  - [SExtractor](https://github.com/satan53x/SExtractor) 导出游戏文本（.txt .json .xlsx）
  - [Translator++](https://dreamsavior.net/translator-plusplus) 项目文件（.trans）
  - [Translator++](https://dreamsavior.net/translator-plusplus) 导出游戏文本（.xlsx）
- 具体示例可见 [Wiki - 支持的文件格式](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F)，更多格式将持续添加，你也可以在 [ISSUES](https://github.com/neavo/LinguaGacha/issues) 中提出你的需求

## 近期更新 📅
- 20250313 v0.12.3
  - 调整 - 如果 .trans 文件中的数据条目包含 水蓝色 标签，则强制重新翻译
  - 修正 - 部分 .trans 文件上的兼容性问题

- 20250312 v0.12.2
  - 调整 - 显著降低了并发任务数较高（>=128）时的性能消耗
  - 调整 - 翻译 .trans 文件时，细化粒度以区分不同地址的相同文本条目
  - 修正 - 修复了一些可能导致翻译时卡住的问题

- 20250311 v0.12.1
  - 调整 - 更新默认提示词与文本过滤规则
    - 加强代码保留能力
    - 减少正常文本被错判为代码导致的漏翻问题（常见于 R1）

- 20250310 v0.12.0
  - 新增 - 直接翻译 Translator 项目文件（.trans） `重磅 👈👈`
    - 此模式下，对于大部分 RPGMaker MV/MZ 游戏而言
      - 不需要任何预处理与后处理，翻译后直接导出即可开玩
    - 对于剩下的少量复杂游戏或者追求完美体验的高级用户，也可以极大的减少精校的工作量
    - 游戏汉化的新时代已经到来！

- 20250310 v0.11.1
  - 新增 - 智能携带参考上文功能
    - 自动分析上文内容是否语义连贯、是否适宜携带
    - 在提供更多语义信息的同时，避免出现文本错位等翻译错误

## 常见问题 📥
- [LinguaGacha](https://github.com/neavo/LinguaGacha) 与 [AiNiee](https://github.com/NEKOparapa/AiNiee) 的关系
  - `LinguaGacha` 是吸取了 `AiNiee` 的经验以后开发的全新的翻译器应用
  - `LinguaGacha` 的作者也是 `AiNiee v5` 的主要开发与维护者之一

## 问题反馈 😥
- 运行时的日志保存在应用根目录下的 `log` 等文件夹
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
