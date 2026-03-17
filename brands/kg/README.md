<h1><p align='center' >KeywordGacha</p></h1>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/KeywordGacha"/>   <img src="https://img.shields.io/github/license/neavo/KeywordGacha"/>   <img src="https://img.shields.io/github/stars/neavo/KeywordGacha"/></div>
<p align='center'>使用 AI 能力一键分析 小说、游戏、字幕 等文本内容并生成术语表的次世代翻译辅助工具</p>


&ensp;
&ensp;


## 概述 📢
- [KeywordGacha](https://github.com/neavo/KeywordGacha)，简称 KG，使用 AI 技术来自动生成 `术语表` 的次世代工具
  - 高质量的 `术语表` 是保障翻译质量的最重要手段，没有之一
  - 在长篇文本的翻译过程中，`术语表` 可以实现 `名词统一` `人称矫正` `角色关系引导` 等目的
- 开箱即用，（几乎）无需设置，功能的强大，不需要通过繁琐的设置来体现
- 支持 `中` `英` `日` `韩` `俄` `德` `法` `意` 等 16 种语言的分析与输出
- 支持 `字幕`、`电子书`、`游戏文本` 等多种文本类型与文本格式
- 支持 `Claude`、`ChatGPT`、`DeepSeek` 等各种本地或在线接口

> <img src="https://github.com/user-attachments/assets/5cb7e5be-86b4-491f-a15d-57b017df716f" style="width: 80%;" alt="image/01.jpg">

> <img src="https://github.com/user-attachments/assets/d8619102-cc2d-40cc-b889-d6a5bf0b3fcd" style="width: 80%;" alt="image/02.jpg">

## 特别说明 ⚠️
- 如您在翻译过程中使用了 [KeywordGacha](https://github.com/neavo/KeywordGacha)，请在作品信息或发布页面的显要位置进行说明 ！
- 如您的项目涉及任何商业行为或者商业收益，在使用 [KeywordGacha](https://github.com/neavo/KeywordGacha) 前，请先与作者联系以获得授权 ！

## 功能优势 📌
- 极快的处理速度，几分钟内完成 `字幕` `小说` `游戏文本` 的分析
- 相较传统工具，具有高命中、语义化、智能总结角色信息等特色，对文本的兼容性更好
- 极大的提升 `小说`、`漫画`、`字幕`、`游戏文本` 等内容译前准备时制作词语表的工作效率
- 随机选取 [绿站榜单作品](https://books.fishhawk.top) 作为测试样本，与人工校对制作的词表对比，命中率约为 `90%+`

## 配置要求 🖥️
- 兼容 `OpenAI` `Google` `Anthropic` 格式的 AI 大模型接口
- 兼容 [LinguaGacha](https://github.com/neavo/LinguaGacha) `使用 AI 能力一键翻译小说、游戏、字幕的次世代文本翻译器` 👈👈

## 基本流程 🛸
- 从 [发布页](https://github.com/neavo/KeywordGacha/releases) 下载应用
- 获取一个可靠的 AI 大模型接口，建议选择其一：
  - [ [本地接口](https://github.com/neavo/OneClickLLAMA) ]，免费，需至少 8G 显存的独立显卡，Nvidia 显卡为佳
  - [ [火山引擎](https://github.com/neavo/KeywordGacha/wiki/VolcEngine) ]，需付费但便宜，速度快，质量高，无显卡要求　`👈👈 推荐`
  - [ [DeepSeek](https://github.com/neavo/KeywordGacha/wiki/DeepSeek) ]，需付费但便宜，速度快，质量高，无显卡要求 `👈👈 白天不稳定，备选`
- 准备要翻译的文本
  - `字幕`、`电子书` 等一般不需要预处理
  - `游戏文本` 需要根据游戏引擎选择合适的工具进行提取
- 双击 `app.exe` 启动应用
  - 在 `项目设置` 中设置原文语言、译文语言等必要信息
  - 将要翻译的文本文件复制到输入文件夹（默认为 `input` 文件夹），在 `开始任务` 中点击 `开始`
- 结果保存在输出文件夹（默认为 `output` 文件夹），可以直接导入 [LinguaGacha](https://github.com/neavo/LinguaGacha) 等翻译器使用

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
- 具体示例可见 [Wiki - 支持的文件格式](https://github.com/neavo/KeywordGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F)，更多格式将持续添加，你也可以在 [ISSUES](https://github.com/neavo/KeywordGacha/issues) 中提出你的需求

## 近期更新 📅
- 20250612 v0.20.2
  - 修正 - 不能继续任务的问题

- 20250612 v0.20.1
  - 新增 - 输出候选数据
  - 新增 - 输出 KVJSON 文件

- 20250611 v0.20.0
  - 久等了，欢迎使用 `基于原生 AI 技术` 的全新 `KeywordGacha`
    - 双语图形化界面
    - 大幅度缩小应用体积
    - 支持 `术语类型` 自定义
    - 支持 `多语言` 分析与输出
    - 支持 `Google` `OpenAI` `Anthropic` 全格式接口
    - 原生 AI 工作流，显著提升在强力模型上的提取效果
    - 更多变化，等你发掘 ！

## 常见问题 📥
- 分析 `小说文本` 的最佳实践
  - 提前移除 `作者评论`、`出版社信息` 等与故事内容无关的文本

- 处理 `游戏文本` 的最佳实践
  - 推荐使用以下格式：
    - [RenPy](https://www.renpy.org) 导出游戏文本（.rpy）
    - [Translator++](https://dreamsavior.net/translator-plusplus) 项目文件（.trans）
    - [Translator++](https://dreamsavior.net/translator-plusplus) 导出游戏文本（.xlsx）
  - 避免使用以下格式：
    - [MTool](https://mtool.app) 导出游戏文本（.json）
  - 如果抓取效果不好，可以多试几种导出工具和格式，有时候会有奇效

## 问题反馈 😥
- 运行时的日志保存在程序目录下的 `*.log` 等日志文件内
- 反馈问题的时候请附上这些日志文件
- 你也可以来群组讨论与反馈
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
