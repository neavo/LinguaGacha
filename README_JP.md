<h1><p align='center'>LinguaGacha</p></h1>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>AIの能力を活用して小説、ゲーム、字幕などのテキストをワンクリックで翻訳する次世代のテキスト翻訳ツール</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](/README_EN.md) ] | [ [日本語](/README_JP.md) ]

## 概要 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/)、略して `LG` は、AIを活用した次世代のテキスト翻訳ツールです
- `中国語`、`英語`、`日本語`、`韓国語`、`ロシア語` などの多言語間のワンクリック相互翻訳をサポート
- `小説`、`字幕`、`ゲームテキスト` などのさまざまなテキストタイプとフォーマットに対応
- `Claude`、`ChatGPT`、`DeepSeek`、`SakuraLLM` などのローカルおよびオンラインインターフェースをサポート

> <img src="https://github.com/user-attachments/assets/859a7e32-bf35-4572-8460-4ecb11a8d20c" style="width: 80%;">

> <img src="https://github.com/user-attachments/assets/c0d7e898-f6fa-432f-a3cd-e231b657c4b5" style="width: 80%;">

## 特別なお知らせ ⚠️
- 翻訳中に [LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する場合は、作品の情報やリリースページの目立つ場所に明確な帰属を含めてください！
- 商業活動や利益を伴うプロジェクトの場合は、[LinguaGacha](https://github.com/neavo/LinguaGacha) を使用する前に、著者に連絡して許可を得てください！

## 主な機能 📌
- 超高速の翻訳速度：字幕は10秒、小説は1分、ゲームは5分で翻訳
- 自動用語集生成により、作品全体で一貫した用語（例：キャラクター名）を保証 `👈👈 独自機能`
- フラッグシップモデル（例：DeepSeek-R1）からローカル小型モデル（例：Qwen2.5-7B）まで、最適な翻訳品質を提供
- テキストのフォーマットと埋め込みコードを `100%` 正確に保持し、後処理作業を大幅に削減 - 埋め込みローカリゼーションに最適 `👈👈 独自機能`

## システム要件 🖥️
- `OpenAI`、`Google`、`Anthropic`、`SakuraLLM` 標準に準拠したAIモデルインターフェースに対応
- [KeywordGacha](https://github.com/neavo/KeywordGacha) と互換性あり `👈👈 AIを活用して用語集をワンクリックで生成する次世代ツール`

## ワークフロー 🛸
- [リリースページ](https://github.com/neavo/LinguaGacha/releases) からアプリケーションをダウンロード
- 信頼できるAIモデルインターフェースを取得（以下のいずれかを選択）：
  - [ローカルAPI - チュートリアル](https://github.com/neavo/OneClickLLAMA)（無料、8GB以上のVRAM GPUが必要、Nvidia推奨）
  - [DeepSeek - チュートリアル](https://github.com/neavo/LinguaGacha/wiki/DeepSeek)（有料、コストパフォーマンスが高く、高速で高品質、GPU不要） `👈👈 推奨`
- ソーステキストを準備：
  - `字幕`/`電子書籍`は通常、前処理が不要
  - `ゲームテキスト`は特定のゲームエンジンに適したツールを使用して抽出が必要
- `app.exe` を実行してアプリケーションを起動：
  - `プロジェクト設定` で必要な設定（ソース/ターゲット言語）を行う
  - 入力フォルダ（デフォルト：`input`）にファイルをコピーし、`翻訳開始` で翻訳を開始
- 詳細なガイドは [Wiki](https://github.com/neavo/LinguaGacha/wiki) を参照するか、[Discussions](https://github.com/neavo/LinguaGacha/discussions) で経験を共有

## 対応フォーマット 🏷️
- 入力フォルダ内のすべての対応ファイル（サブディレクトリを含む）を処理：
  - 字幕 (.srt .ass)
  - 電子書籍 (.txt .epub)
  - [RenPy](https://www.renpy.org) エクスポート (.rpy)
  - [MTool](https://afdian.com/a/AdventCirno) エクスポート (.json)
  - [SExtractor](https://github.com/satan53x/SExtractor) エクスポート (.txt .json .xlsx)
  - [Translator++](https://dreamsavior.net/translator-plusplus) エクスポート (.xlsx)
- 例については [Wiki - 対応フォーマット](https://github.com/neavo/LinguaGacha/wiki/Supported-File-Formats) を参照。フォーマットのリクエストは [ISSUES](https://github.com/neavo/LinguaGacha/issues) で提出

## 最近の更新 📅
- 20250218 v0.6.1
  - 国際化サポートを追加：`中国語` `英語`
  - 翻訳速度の向上
  - 制限解除機能の強化

- 20250216 v0.5.2
  - MToolオプティマイザーを追加
  - 翻訳タスクの早期終了を有効化
  - RenPyファイルの拡張子の問題を修正

- 20250215 v0.4.6
  - 自動用語集生成を実装
  - XLSXフォーマットのサポートを拡大
  - UTF8-BOMファイルの互換性を向上

## FAQ 📥
- [LinguaGacha](https://github.com/neavo/LinguaGacha) と [AiNiee](https://github.com/NEKOparapa/AiNiee) の関係
  - `LinguaGacha` は `AiNiee` の教訓を取り入れて完全に書き直されたものです
  - `LinguaGacha` の開発者は `AiNiee v5` の主要な貢献者でした

## サポート 😥
- 実行時のログは `log` フォルダに保存されます
- 問題を報告する際は、関連するログを添付してください
