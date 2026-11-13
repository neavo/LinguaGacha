<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>AIの能力を活用して小説、ゲーム、字幕などのテキストをワンクリックで翻訳する次世代のテキスト翻訳ツール</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Deutsch](./README_DE.md) | [Português](./README_PT.md) ]

## 概要 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)、AIを活用した次世代のテキスト翻訳ツールです
- 箱から出してすぐに使え、（ほぼ）設定不要。機能の強力さは、煩雑な設定を必要としません。
- `中国語`、`英語`、`日本語`、`韓国語`、`ロシア語`、`ドイツ語`、`フランス語`、`イタリア語`など 16 言語にワンタッチ双方向翻訳対応。
- `字幕`、`電子書籍`、`ゲームテキストなど`、色々なテキストタイプと形式に対応。
- `OpenAI`、`Google`、`Anthropic`、`SakuraLLM` などのローカルおよびオンラインインターフェースをサポート

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## 特別なお知らせ ⚠️
- 翻訳中に [LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する場合は、作品の情報やリリースページの目立つ場所に明確な帰属を含めてください！
- 商業活動や利益を伴うプロジェクトの場合は、[LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する前に、著者に連絡して許可を得てください！

## 機能の利点 📌
- 最高の翻訳品質と最速の翻訳速度
  - さまざまな `字幕` `電子書籍` のスタイルを完全に保持
  - 用語集を自動生成し、固有名詞の訳語を作品全体で統一
  - 10秒で字幕1本、1分で小説1冊、5分でゲーム1本
- 対話を通じてさまざまなタスクを自動で完了する内蔵 `AGENT` モード　`👈👈 独自の強み`
  - 技術的な知識は不要。ゲームは翻訳後すぐにプレイ可能
  - 主要エンジンを網羅 `Godot` `RenPy` `Tyrano` `WOLFRPG` `RPGMAKER` `Kirikiri` `Unity` `Bakin` `RealLive` `Escude` `ACTION GAME MAKER`

## ワークフロー 🛸
- [リリースページ](https://github.com/neavo/LinguaGacha/releases) からアプリケーションをダウンロード
  - Windows:
    - CPU の種類に応じて `*_Windows_x64.zip` または `*_Windows_arm64.zip` をダウンロード
    - 解凍して `app.exe` をダブルクリックして起動
  - <details>
    <summary>macOS:</summary>
    - CPU の種類に応じて `*_macOS_x64.dmg` または `*_macOS_arm64.dmg` をダウンロード
    - アプリケーションフォルダにドラッグし、まだ起動しないでください
    - ターミナルを開き、`sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` と入力して Enter を押してください
    - システムパスワードを入力し、ターミナルを閉じると、通常通り起動できます
    </details>
  - <details>
    <summary>Linux:</summary>
    - CPU の種類に応じて `*_Linux_x64.AppImage` または `*_Linux_arm64.AppImage` をダウンロード
    - `chmod +x LinguaGacha*.AppImage` で実行権限を付与
    - `./LinguaGacha*.AppImage` を実行
    </details>
- 信頼できるAIモデルインターフェースを取得。おすすめ：
  - [ [DeepSeek API](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN) ] (GPU不要)
- アプリケーションを起動し、`翻訳するファイル` をページにドラッグして、Enter を押すだけ！

## 使い方チュートリアル 📝
- はじめに
  - [基本チュートリアル](https://github.com/neavo/LinguaGacha/wiki/BasicTutorialEN)　`👈 手順に沿って学べる、初心者必読のチュートリアル`
  - [対応フォーマット](https://github.com/neavo/LinguaGacha/wiki/SupportedFileFormatEN)
- モデル設定
  - [モデル管理](https://github.com/neavo/LinguaGacha/wiki/ModelManagementEN)　　[DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeekEN)
- 機能説明
  - [AGENT](https://github.com/neavo/LinguaGacha/wiki/AgentEN)　　[校正](https://github.com/neavo/LinguaGacha/wiki/ProofreadingEN)
  - [用語集](https://github.com/neavo/LinguaGacha/wiki/GlossaryEN)　　[テキスト保護](https://github.com/neavo/LinguaGacha/wiki/TextPreserveEN)　　[テキスト置換](https://github.com/neavo/LinguaGacha/wiki/ReplacementEN)
  - [MTool オプティマイザー](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN)　　[コマンドラインモード](https://github.com/neavo/LinguaGacha/wiki/CLIModeEN)　　[高度な機能](https://github.com/neavo/LinguaGacha/wiki/AdvancedFeaturesEN)
- エンジン別ガイド
  - [Godot ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)
  - [RenPy ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)
  - [Tyrano ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyranoEN)
  - [WOLFRPG ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)
  - [RPGMAKER ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)
- コミュニティの経験談
  - [複雑な暗号化のない Kirikiri ゲームの機械翻訳メモ](https://github.com/neavo/LinguaGacha/discussions/181)
- 各機能の詳しい説明は [Wiki](https://github.com/neavo/LinguaGacha/wiki) をご覧ください

## 対応フォーマット 🏷️
| 種類 | 形式 | 説明 |
|:---|:---|:---|
| 字幕 | `.srt` `.ass` `.ssa` `.vtt` `.lrc` | - |
| 電子書籍 | `.txt` `.pdf` `.epub` | - |
| Markdown | `.md` | - |
| `KV-JSON` ゲームテキスト | `.json` | 出力元 [[MTool](https://mtool.app)] [[SExtractor](https://github.com/satan53x/SExtractor)] |
| `Message-JSON` ゲームテキスト | `.json` | 出力元 [[SExtractor](https://github.com/satan53x/SExtractor)] [[VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools)] |
| `Godot` ゲームファイル | `.exe` またはゲームフォルダー | ガイド [[Godot ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForGodotEN)] |
| `RenPy` ゲームファイル | `.exe` またはゲームフォルダー | ガイド [[RenPy ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPyEN)] |
| `Tyrano` ゲームファイル | `.exe` またはゲームフォルダー | ガイド [[Tyrano ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForTyranoEN)] |
| `WOLFRPG` ゲームファイル | `.exe` またはゲームフォルダー | ガイド [[WOLFRPG ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLFRPGEN)] |
| `RPGMAKER MV/MZ` ゲームファイル | `.exe` またはゲームフォルダー | ガイド [[RPGMAKER ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)] |
| `RPGMAKER XP/VX/VXAce` ゲームファイル | `.exe` またはゲームフォルダー | ガイド [[RPGMAKER ゲームの高品質翻訳ガイド](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMakerEN)] |
| `.rpy` ゲームテキスト | `.rpy` | `👈 サポート終了予定` |
| `.xlsx` ゲームテキスト | `.xlsx` | 出力元 [SExtractor](https://github.com/satan53x/SExtractor) [Translator++](https://dreamsavior.net/translator-plusplus) [WOLF 公式翻訳ツール](https://silversecond.booth.pm/items/5151747)　`👈 サポート終了予定` |
| `.trans` プロジェクトファイル | `.trans` | 出力元 [Translator++](https://dreamsavior.net/translator-plusplus)　`👈 サポート終了予定` |
| その他の形式の `ゲーム` `字幕` `電子書籍` | 任意 | `AGENT` が自動で識別・処理 |

## 最近の更新 📅
- 20261113 v0.141.2
  - `音声・動画`の翻訳機能を改善 [1095](../../issues/1092)
  - 修正と改善 [#1097](../../issues/1097) [#1098](../../issues/1098)

- 20261112 v0.141.1
  - `音声・動画`の翻訳機能を改善 [#1092](../../issues/1092)
  - 修正と改善 [#1088](../../issues/1088) [#1089](../../issues/1089) [#1090](../../issues/1090) [#1091](../../issues/1091) [#1093](../../issues/1093)

- 20261110 v0.141.0
  - `音声（ASMR）`の翻訳に対応 [#1085](../../pull/1085)
  - `動画`の翻訳に対応 [#1085](../../pull/1085)
  - 修正と改善 [#1083](../../issues/1083) [#1084](../../issues/1084)

## 開発ガイド 🛠️
- [Go](https://go.dev) と [`Node.js`](https://nodejs.org) をインストール
- 依存関係のインストール: `npm install`
- 依存関係の更新: `npm ci`
- アプリの実行: `npm run dev`
- リリースのビルド: `npm run build`
- PRを提出する前に、変更範囲に応じて [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) の対応する検証を実行してください
- 非開発者の方は [リリースページ](https://github.com/neavo/LinguaGacha/releases) からビルド済みバージョンをダウンロードすることをお勧めします

## サポート 😥
- 実行時のログは `log` フォルダに保存されます
- 問題を報告する際は、関連するログを添付してください
- グループに参加して、ディスカッションやフィードバックもできます。
  - Discord - https://discord.gg/pyMRBGse75
