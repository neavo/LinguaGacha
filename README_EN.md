<div align=center><img src="https://github.com/user-attachments/assets/de19ec3f-246c-432d-9636-ff16f82b094e" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Next-generation text translator utilizing AI capabilities for one-click translation of novels, games, subtitles, and more</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), abbreviated as `LG`, is an AI-powered next-generation text translator
- Supports one-click mutual translation between multiple languages including `Chinese`, `English`, `Japanese`, `Korean`, `Russian`
- Compatible with various text types and formats including `novels`, `subtitles`, `game texts`
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

## Workflow 🛸
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
- Visit [Wiki](https://github.com/neavo/LinguaGacha/wiki) for detailed guides or share experiences in [Discussions](https://github.com/neavo/LinguaGacha/discussions)

## Supported Formats 🏷️
- Processes all supported files in input folder (including subdirectories):
  - Subtitles (.srt .ass)
  - E-books (.txt .epub)
  - [RenPy](https://www.renpy.org) exports (.rpy)
  - [MTool](https://afdian.com/a/AdventCirno) exports (.json)
  - [SExtractor](https://github.com/satan53x/SExtractor) exports (.txt .json .xlsx)
  - [Translator++](https://dreamsavior.net/translator-plusplus) exports (.xlsx)
- See [Wiki - Supported Formats](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F) for examples. Submit format requests via [ISSUES](https://github.com/neavo/LinguaGacha/issues)

## Recent Updates 📅
- 20250226 v0.7.3
  - OPT - Tweak EPUB styling and compatibility

- 20250225 v0.7.2
  - NEW - Thinking Mode Support for Claude Sonnet 3.7
  - FIX - Result Check Error with Traditional Chinese Output

- 20250224 v0.7.1
  - NEW - RenPy text code preservation and detection support
  - OPT - Significantly reduced CPU usage in high concurrency tasks

- 20250223 v0.6.4
  - OPT: Enhanced compatibility for English RPG Maker games.
  - OPT: Disabled verbose logging when a large number of quests are active.

- 20250221 v0.6.3
  - Minor Update

- 20250220 v0.6.2
  - OPT - Improved preservation of original EPUB styles
  - OPT - Minor performance optimization

- 20250218 v0.6.1
  - ADD - Internationalization UI (`Chinese` `English`)
  - OPT - Translation speed optimization
  - OPT - Enhanced ability to overcome limitations

## FAQ 📥
- Relationship between [LinguaGacha](https://github.com/neavo/LinguaGacha) and [AiNiee](https://github.com/NEKOparapa/AiNiee)
  - `LinguaGacha` is a complete rewrite incorporating lessons from `AiNiee`
  - `LinguaGacha`'s developer was a main contributor to `AiNiee v5`

## Support 😥
- Runtime logs are stored in `log` folder
- Please attach relevant logs when reporting issues
- You can also join our groups for discussion and feedback:
  - Discord - https://discord.gg/kX7UnxnKje
