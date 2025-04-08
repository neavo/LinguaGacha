<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Next-generation text translator utilizing AI capabilities for one-click translation of novels, games, subtitles, and more</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), is an AI-powered next-generation text translator
- Out of the box, (almost) no setup needed, powerful does not need to be shown through complicated setting options
- Supports one-click translation between 14 languages
  - including `Chinese`, `English`, `Japanese`, `Korean`, `Russian`, `German`, `French`, `Italian`, etc
- Supports various text types and formats such as `Subtitle`, `E-Book`, and `Game Text`
- Supports both local and online interfaces such as `Claude`, `ChatGPT`, `DeepSeek`, `SakuraLLM`

> <img src="https://github.com/user-attachments/assets/99f7d74e-ab5b-4645-b736-6f665782b4af" style="width: 80%;">

> <img src="https://github.com/user-attachments/assets/c0d7e898-f6fa-432f-a3cd-e231b657c4b5" style="width: 80%;">

## Special Notice ⚠️
- If you use [LinguaGacha](https://github.com/neavo/LinguaGacha) during translation, please include clear attribution in prominent locations of your work's information or release pages!
- For projects involving commercial activities or profits, please contact the author for authorization before using [LinguaGacha](https://github.com/neavo/LinguaGacha)!

## Feature Advantages 📌
- Ultra-fast translation speed: subtitles in ten seconds, novels in one minute, games in five minutes
- Automatically generate a glossary to ensure consistent translation of proper nouns like character names throughout the entire work.  `👈👈 Exclusive Feature`
- Optimal translation quality, whether it's flagship models `such as DeepSeek-R1` or local small models `such as Qwen2.5-7B`
- The strongest style and code retention capability among similar applications, significantly reducing post-processing workload, making it the best choice for creating embedded Chinese localization.
  - `.md` `.ass` `.epub` formats can almost retain all original styles.
  - Most `WOLF`, `RenPy`, `RPGMaker`, `Kirikiri` games require no manual processing, allowing for instant translation and play `👈👈 Exclusive Feature`

## System Requirements 🖥️
- Compatible with AI model interfaces following `OpenAI`, `Google`, `Anthropic`, `SakuraLLM` standards
- Compatible with [KeywordGacha](https://github.com/neavo/KeywordGacha)　`👈👈 Next-generation tool for AI-powered glossary generation`

## Basic Workflow 🛸
- Download application from [Releases page](https://github.com/neavo/LinguaGacha/releases)
- Obtain a reliable AI model interface (choose one):
  - [ [Local API](https://github.com/neavo/OneClickLLAMA) ] (Free, requires ≥8GB VRAM GPU, Nvidia recommended)
  - [ [Gemini API](https://aistudio.google.com/) ] (Paid, cost-effective, fast, relatively-high-quality, no GPU required)　`👈👈 Recommended`
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ] (Paid, cost-effective, fast, high-quality, no GPU required)　`👈👈 Unstable during the day, Alternative`
- Prepare source text:
  - `Subtitles`/`E-books` typically require no preprocessing
  - `Game texts` need extraction using appropriate tools for specific game engines
- Launch application via `app.exe`:
  - Configure essential settings (source/target languages) in `Project Settings`
  - Copy files to input folder (default: `input`), start translation in `Begin Translation`

## User Guide 📝
- Overall
  - [Basic Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈👈 Step-by-step tutorial, easy to follow, a must-read for beginners`
  - [Best Practices for High-Quality Translation of WOLF Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLF-%E2%80%90-EN)
  - [Best Practices for High-Quality Translation of RPGMaker Series Engine Games](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker-%E2%80%90-EN)
- Video Tutorial
  - [How to Translate RPGMV with LinguaGacha and Translator++ (English)](https://www.youtube.com/watch?v=NbpyL2fMgDc)
- Feature Description
  - [Glossary](https://github.com/neavo/LinguaGacha/wiki/Glossary-%E2%80%90-EN)　　[Replacement](https://github.com/neavo/LinguaGacha/wiki/Replacement-%E2%80%90-EN)　　[Incremental Translation](https://github.com/neavo/LinguaGacha/wiki/IncrementalTranslation-%E2%80%90-EN)
  - [Batch Correction](https://github.com/neavo/LinguaGacha/wiki/BatchCorrection-%E2%80%90-EN)　　[Partial ReTranslation](https://github.com/neavo/LinguaGacha/wiki/ReTranslation-%E2%80%90-EN)
  - [Expert Config](https://github.com/neavo/LinguaGacha/wiki/ExpertConfig-%E2%80%90-EN)　　[Name Injection](https://github.com/neavo/LinguaGacha/wiki/NameInjection-%E2%80%90-EN)　　[MTool Optimizer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer-%E2%80%90-EN)
- You can find more details on each feature in the [Wiki](https://github.com/neavo/LinguaGacha/wiki), and you are welcome to share your experience in the [Discussions](https://github.com/neavo/LinguaGacha/discussions)

## Supported Formats 🏷️
- Processes all supported files in input folder (including subdirectories):
  - Subtitles (.srt .ass)
  - E-books (.txt .epub)
  - Markdown（.md）
  - [RenPy](https://www.renpy.org) exports (.rpy)
  - [MTool](https://mtool.app) exports (.json)
  - [SExtractor](https://github.com/satan53x/SExtractor) exports (.txt .json .xlsx)
  - [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools) exports (.json)
  - [Translator++](https://dreamsavior.net/translator-plusplus) project (.trans)
  - [Translator++](https://dreamsavior.net/translator-plusplus) exports (.xlsx)
  - [WOLF Official Translation Tool](https://silversecond.booth.pm/items/5151747) exports (.xlsx)
- See [Wiki - Supported Formats](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F) for examples. Submit format requests via [ISSUES](https://github.com/neavo/LinguaGacha/issues)

## Recent Updates 📅
- 20250408 v0.22.0
  - OPT - Optimize punctuation repair logic
  - OPT - Optimize code preservation, repair, and check logic
  - OPT - Open SakuraLLM model settings
  - OPT - Automated character name injection, feature introduction [Name Injection](https://github.com/neavo/LinguaGacha/wiki/NameInjection-%E2%80%90-EN)
    - Automatically complete the unified translation of character name fields
    - Use character name fields as translation auxiliary information to improve translation quality
    - The original manual function has been removed

- 20250405 v0.21.2
  - OPT - Optimized model response stability
  - OPT - Optimized line break compatibility for [Batch Correction](https://github.com/neavo/LinguaGacha/wiki/BatchCorrection-%E2%80%90-EN)

- 20250404 v0.21.1
  - Detail adjustments and optimizations, including but not limited to:
    - Optimization of punctuation repair rules
    - Supports GalGame text with `names` field

- 20250404 v0.21.0
  - ADD - [Batch Correction](https://github.com/neavo/LinguaGacha/wiki/BatchCorrection-%E2%80%90-EN) Feature
    - Batch correct errors in the inspection report at once
  - OPT - Optimized punctuation restoration rules
    - Punctuation marks in the original text can now be restored more reliably

- 20250401 v0.20.0
  - OPT - [Translator++](https://dreamsavior.net/translator-plusplus) project file (.trans) rules update
    - Supports [WOLF Official Translation Tool Exported Text](https://silversecond.booth.pm/items/5151747) (.xlsx)
    - Refactored support for the `WOLF` engine, expanding the supported engine version scope. See [Wiki](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLF-%E2%80%90-EN) for details

- 20250330 v0.19.2
  - Optimizations to some pre-processing and post-processing flows, including:
    - Most of the `‘’` `“”` `「」` at the beginning and end of sentences can be correctly fixed
    - Automatic fixing of redundant code generated by model

- 20250329 v0.19.1
  - ADD - Fully Refactored Control Character Retention Feature
    - In practice, it can achieve nearly `100%` code retention rate in most `WOLF`, `RenPy`, `RPGMaker` games

## Support 😥
- Runtime logs are stored in `log` folder
- Please attach relevant logs when reporting issues
- You can also join our groups for discussion and feedback:
  - Discord - https://discord.gg/pyMRBGse75
