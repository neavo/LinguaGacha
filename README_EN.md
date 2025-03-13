<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Next-generation text translator utilizing AI capabilities for one-click translation of novels, games, subtitles, and more</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), abbreviated as `LG`, is an AI-powered next-generation text translator
- Out of the box, (almost) no setup needed, powerful functionality that doesn't need complicated settings to show it off.
- Supports one-click translation between 13 languages
  - including `Chinese`, `English`, `Japanese`, `Korean`, `Russian`, `German`, `French`, `Italian`, etc.
- Supports various text types and formats such as `subtitles`, `e-books`, and `game text`
- Supports both local and online interfaces such as `Claude`, `ChatGPT`, `DeepSeek`, `SakuraLLM`

> <img src="https://github.com/user-attachments/assets/859a7e32-bf35-4572-8460-4ecb11a8d20c" style="width: 80%;">

> <img src="https://github.com/user-attachments/assets/c0d7e898-f6fa-432f-a3cd-e231b657c4b5" style="width: 80%;">

## Special Notice ⚠️
- If you use [LinguaGacha](https://github.com/neavo/LinguaGacha) during translation, please include clear attribution in prominent locations of your work's information or release pages!
- For projects involving commercial activities or profits, please contact the author for authorization before using [LinguaGacha](https://github.com/neavo/LinguaGacha)!

## Key Features 📌
- Lightning-fast translation speed: 10 seconds for subtitles, 1 minute for novels, 5 minutes for games
- Automatic glossary generation ensuring consistent terminology (e.g., character names) throughout the work `👈👈 Exclusive Feature`
- Optimal translation quality from flagship models (e.g., DeepSeek-R1) to local small models (e.g., Qwen2.5-7B)
- `100%` accurate preservation of text formatting and embedded codes, significantly reducing post-processing work - ideal for embedded localization `👈👈 Exclusive Feature`

## System Requirements 🖥️
- Compatible with AI model interfaces following `OpenAI`, `Google`, `Anthropic`, `SakuraLLM` standards
- Compatible with [KeywordGacha](https://github.com/neavo/KeywordGacha) `👈👈 Next-generation tool for AI-powered glossary generation`

## Basic Workflow 🛸
- Download application from [Releases page](https://github.com/neavo/LinguaGacha/releases)
- Obtain a reliable AI model interface (choose one):
  - [Local API - Tutorial](https://github.com/neavo/OneClickLLAMA) (Free, requires ≥8GB VRAM GPU, Nvidia recommended)
  - [DeepSeek - Tutorial](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) (Paid, cost-effective, fast, high-quality, no GPU required) `👈👈 Recommended`
- Prepare source text:
  - `Subtitles`/`E-books` typically require no preprocessing
  - `Game texts` need extraction using appropriate tools for specific game engines
- Launch application via `app.exe`:
  - Configure essential settings (source/target languages) in `Project Settings`
  - Copy files to input folder (default: `input`), start translation in `Begin Translation`

## User Guide 📝
- Tutorials
  - [RenPy Engine Game AI Localization Video Tutorial (Chinese)](https://space.bilibili.com/631729629/lists/4832968)
  - [How to Translate RPGMV with LinguaGacha and Translator++ (English)](https://www.youtube.com/watch?v=wtV_IODzi8I)
- Feature Descriptions
  - [Glossary](https://github.com/neavo/LinguaGacha/wiki/%E6%9C%AF%E8%AF%AD%E8%A1%A8)　　[Pre-translation Replacement](https://github.com/neavo/LinguaGacha/wiki/%E8%AF%91%E5%89%8D%E6%9B%BF%E6%8D%A2)　　[Post-translation Replacement](https://github.com/neavo/LinguaGacha/wiki/%E8%AF%91%E5%90%8E%E6%9B%BF%E6%8D%A2)
  - [MTool Optimizer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)
- You can find more details on each feature in the [Wiki](https://github.com/neavo/LinguaGacha/wiki), and you are welcome to share your experience in the [Discussions](https://github.com/neavo/LinguaGacha/discussions).

## Supported Formats 🏷️
- Processes all supported files in input folder (including subdirectories):
  - Subtitles (.srt .ass)
  - E-books (.txt .epub)
  - Markdown（.md）
  - [RenPy](https://www.renpy.org) exports (.rpy)
  - [MTool](https://afdian.com/a/AdventCirno) exports (.json)
  - [SExtractor](https://github.com/satan53x/SExtractor) exports (.txt .json .xlsx)
  - [Translator++](https://dreamsavior.net/translator-plusplus) project (.trans)
  - [Translator++](https://dreamsavior.net/translator-plusplus) exports (.xlsx)
- See [Wiki - Supported Formats](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F) for examples. Submit format requests via [ISSUES](https://github.com/neavo/LinguaGacha/issues)

## Recent Updates 📅
- 20250313 v0.12.3
  - OPT - If a data entry in the .trans file has a AQUA tag, force re-translation
  - FIX - Compatibility issues on some .trans files

- 20250312 v0.12.2
  - OPT - Performance overhead is way down when there's a lot of concurrent tasks (>=128).
  - OPT - When translating .trans files, it's more granular now, to tell apart identical text entries from different addresses.
  - FIX - Fixed some problems that could cause translation to get stuck.

- 20250311 v0.12.1
  - OPT - Updated the default prompts and text filtering rules.
    - Improved the ability to keep code intact
    - Reduced instances of normal text being mistakenly flagged as code, and thus not getting translated (often seen in R1)

- 20250310 v0.12.0
  - NEW - Directly translate Translator project files (.trans) `AWESOME 👈👈`
    - In this mode, for most RPGMaker MV/MZ games
      - No need for any pre-processing or post-processing, just translation&export and you're ready to play
    - For the few remaining complex games, or for advanced users seeking a perfect experience, it can also greatly reduce the amount of fine-tuning work
    - NEW AGE is HERE

- 20250310 v0.11.1
  - NEW - Smart carry-over of context from previous text
    - Automatically analyzes whether the previous text is semantically coherent and suitable for carry-over
    - Provides more semantic information while avoiding translation errors such as text misalignment

## FAQ 📥
- Relationship between [LinguaGacha](https://github.com/neavo/LinguaGacha) and [AiNiee](https://github.com/NEKOparapa/AiNiee)
  - `LinguaGacha` is a complete rewrite incorporating lessons from `AiNiee`
  - `LinguaGacha`'s developer was a main contributor to `AiNiee v5`

## Support 😥
- Runtime logs are stored in `log` folder
- Please attach relevant logs when reporting issues
- You can also join our groups for discussion and feedback:
  - Discord - https://discord.gg/pyMRBGse75
