<div align="center">
    <img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px">
</div>

<p align="center">
    <img src="https://img.shields.io/github/v/release/neavo/LinguaGacha">
    <img src="https://img.shields.io/github/license/neavo/LinguaGacha">
    <img src="https://img.shields.io/github/stars/neavo/LinguaGacha">
</p>

<p align="center">
    Next-generation text translator utilizing AI capabilities for one-click translation of novels, games, subtitles, and more.
</p>

---

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ]

## Overview 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), abbreviated as `LG`, is an AI-powered next-generation text translator.
- Out of the box, (almost) no setup needed, powerful functionality without complex settings.
- Supports one-click translation between 13 languages:
  - `Chinese`, `English`, `Japanese`, `Korean`, `Russian`, `German`, `French`, `Italian`, etc.
- Supports various text types and formats such as `subtitles`, `e-books`, and `game text`.
- Supports both local and online interfaces such as `Claude`, `ChatGPT`, `DeepSeek`, `SakuraLLM`.

<div align="center">
    <img src="https://github.com/user-attachments/assets/859a7e32-bf35-4572-8460-4ecb11a8d20c" width="80%">
</div>

<div align="center">
    <img src="https://github.com/user-attachments/assets/c0d7e898-f6fa-432f-a3cd-e231b657c4b5" width="80%">
</div>

## Special Notice ⚠️
- If you use [LinguaGacha](https://github.com/neavo/LinguaGacha) during translation, please include clear attribution in prominent locations of your work.
- For commercial projects, please contact the author for authorization before using LinguaGacha.

## Key Features 📌
- **Lightning-fast translation speed**: 10s for subtitles, 1min for novels, 5min for games.
- **Automatic glossary generation** ensuring consistent terminology throughout the work. `👈👈 Exclusive Feature`
- **Optimal translation quality** from flagship models (`DeepSeek-R1`) to local models (`Qwen2.5-7B`).
- **100% accurate preservation** of text formatting and embedded codes—ideal for localization. `👈👈 Exclusive Feature`

## System Requirements 🖥️
- Compatible with AI model interfaces following `OpenAI`, `Google`, `Anthropic`, `SakuraLLM` standards.
- Compatible with [KeywordGacha](https://github.com/neavo/KeywordGacha).

## Basic Workflow 🛸
1. **Download** the application from the [Releases page](https://github.com/neavo/LinguaGacha/releases).
2. **Obtain an AI model interface** (choose one):

| API Provider                                      | Price                                      | Note                                               |
|--------------------------------------------------|--------------------------------------------|---------------------------------------------------------|
| [**OpenAI**](https://platform.openai.com/docs/overview) | Paid (expensive)                          | High-quality results, but requires a high initial investment. Some censorship; needs applied custom prompt tuning. |
| [**Claude (Anthropic)**](https://www.anthropic.com/) | Paid (expensive)                          | Excellent translation quality, some censorship, requires prompt modifications. |
| [**Local AI**](https://github.com/neavo/OneClickLLAMA) | Free                                       | Supports OpenAI API format, requires at least 8GB VRAM (Nvidia recommended). Can run models like Llama locally. |
| [**DeepSeek AI**](https://platform.deepseek.com/sign_in) | Paid (cheap)                               | Fast, high quality, no censorship, no need GPU         |
| [**Groq AI**](https://console.groq.com/login)    | Freemium (Pay-as-you-go upon upgrade)      | No censorship, multi-model support, but rate limited. If upgraded, previous token usage may be billed. |
| [**Celebres AI**](http://cloud.cerebras.ai/)     | Freemium (beta)                                   | No censorship, free 2 models (Llama 70B & 8B), rate limited |
| [**Google Gemini AI Studio**](https://cloud.google.com/generative-ai-studio?hl=en) | Affordable, free trial 90 days ($300 credit), only paid if upgraded | Needs credit card and only available in certain regions |


3. **Prepare the source text:**
   - `Subtitles`/`E-books` require no preprocessing.
   - `Game texts` may need extraction tools for specific engines.
4. **Launch application (`app.exe`) and configure settings:**
   - Set source and target languages in `Project Settings`.
   - Copy files to the input folder (`input` by default).
   - Start translation via `Begin Translation`.

## User Guide 📝
### Tutorials:
- [RenPy Engine Game AI Localization (Chinese)](https://space.bilibili.com/631729629/lists/4832968)
- [How to Translate RPGMV with LinguaGacha & Translator++ (English)](https://www.youtube.com/watch?v=wtV_IODzi8I)

### Feature Descriptions:
- [Glossary](https://github.com/neavo/LinguaGacha/wiki/%E6%9C%AF%E8%AF%AD%E8%A1%A8)　
- [Pre-translation Replacement](https://github.com/neavo/LinguaGacha/wiki/%E8%AF%91%E5%89%8D%E6%9B%BF%E6%8D%A2)　
- [Post-translation Replacement](https://github.com/neavo/LinguaGacha/wiki/%E8%AF%91%E5%90%8E%E6%9B%BF%E6%8D%A2)

For more details, check the [Wiki](https://github.com/neavo/LinguaGacha/wiki) or join the [Discussions](https://github.com/neavo/LinguaGacha/discussions).

## Supported Formats 🏷️
Supports processing of the following file types:
- Subtitles (`.srt`, `.ass`)
- E-books (`.txt`, `.epub`)
- Markdown (`.md`)
- Game exports:
  - [RenPy](https://www.renpy.org) (`.rpy`)
  - [MTool](https://afdian.com/a/AdventCirno) (`.json`)
  - [SExtractor](https://github.com/satan53x/SExtractor) (`.txt`, `.json`, `.xlsx`)
  - [Translator++](https://dreamsavior.net/translator-plusplus) (`.trans`, `.xlsx`)

For more info, see [Wiki - Supported Formats](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F).

## Recent Updates 📅
- **2025-03-13** v0.12.3  
  - Improved handling of `.trans` files with `AQUA` tags.  
  - Fixed compatibility issues with `.trans` files.

- **2025-03-12** v0.12.2  
  - Optimized performance for concurrent tasks (`>=128`).  
  - Improved `.trans` translation granularity.

- **2025-03-11** v0.12.1  
  - Updated default prompts and text filtering rules.

## FAQ 📥
**Q: What is the relationship between LinguaGacha and AiNiee?**  
A: `LinguaGacha` is a complete rewrite based on lessons from `AiNiee`. The developer of `LinguaGacha` was a main contributor to `AiNiee v5`.

## Support 😥
- Runtime logs are stored in the `log` folder.
- Attach relevant logs when reporting issues.
- Join our **Discord** for discussions: [https://discord.gg/pyMRBGse75](https://discord.gg/pyMRBGse75)
