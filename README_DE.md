<div align=center><img width="640px"  alt="hero-wide-v1" src="https://github.com/user-attachments/assets/ca23dd6d-a676-4c6b-a33e-0a2687bff534" /></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Ein Textübersetzer der nächsten Generation, der Romane, Spiele, Untertitel und mehr mit KI auf Knopfdruck übersetzt</p>

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ] | [ [한국어](./README_KO.md) ] | [ [Deutsch](./README_DE.md) ]

## Überblick 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/) ist ein KI-gestützter Textübersetzer der nächsten Generation
- Sofort einsatzbereit, (fast) ohne Einrichtung: Leistungsstarke Funktionen brauchen keine komplizierten Einstellungen
- Übersetzt auf Knopfdruck zwischen 16 Sprachen, darunter `Chinesisch`, `Englisch`, `Japanisch`, `Koreanisch`, `Russisch`, `Deutsch`, `Französisch` und `Italienisch`
- Unterstützt verschiedene Textarten und Formate wie `Untertitel`, `E-Books` und `Spieltexte`
- Unterstützt lokale und Online-Schnittstellen wie `OpenAI`, `Google`, `Anthropic` und `SakuraLLM`

> <img width="2562" height="1602" alt="01" src="https://github.com/user-attachments/assets/9ab0ef8f-136b-4b45-9640-d16b451acde7" />

> <img width="2570" height="1605" alt="02" src="https://github.com/user-attachments/assets/7f6d6556-d6b2-4fb1-b509-2d8272814290" />

## Besondere Hinweise ⚠️
- Wenn Sie [LinguaGacha](https://github.com/neavo/LinguaGacha) für Ihre Übersetzung verwenden, weisen Sie bitte an gut sichtbarer Stelle in den Werkangaben oder auf der Veröffentlichungsseite darauf hin!
- Wenn Ihr Projekt kommerzielle Aktivitäten oder Einnahmen umfasst, kontaktieren Sie bitte vor der Nutzung von [LinguaGacha](https://github.com/neavo/LinguaGacha) den Autor, um eine Genehmigung einzuholen!

## Vorteile 📌
- Integrierter `AGENT`-Modus, der verschiedene Aufgaben automatisch im Dialog erledigt　`👈👈 Exklusive Funktion`
- Extrem schnelle Übersetzung: Untertitel in zehn Sekunden, ein Roman in einer Minute, ein Spiel in fünf Minuten
- Erstellt auf Knopfdruck ein Glossar, damit Eigennamen wie Charakternamen im gesamten Werk einheitlich übersetzt werden
- Beste Übersetzungsqualität sowohl mit Spitzenmodellen `wie DeepSeek-R1` als auch mit kleinen lokalen Modellen `wie Qwen2.5-7B`
- Führend unter vergleichbaren Anwendungen beim Erhalt von Formatierung und Code; reduziert die Nachbearbeitung erheblich und eignet sich besonders für direkt ins Spiel integrierte chinesische Lokalisierungen
  - Die Formate `.md`, `.ass` und `.epub` behalten nahezu die gesamte ursprüngliche Formatierung bei
  - Die meisten Spiele mit `WOLF`, `RenPy`, `RPGMaker` oder `Kirikiri` benötigen keine manuelle Nachbearbeitung: übersetzen und sofort spielen

## Erste Schritte 🛸
- Laden Sie die Anwendung von der [Release-Seite](https://github.com/neavo/LinguaGacha/releases) herunter
  - Windows:
    - Laden Sie je nach CPU-Typ `*_Windows_x64.zip` oder `*_Windows_arm64.zip` herunter
    - Entpacken Sie das Archiv und starten Sie die Anwendung per Doppelklick auf `app.exe`
  - macOS:
    - Laden Sie je nach CPU-Typ `*_macOS_x64.dmg` oder `*_macOS_arm64.dmg` herunter
    - Ziehen Sie die Anwendung in den Programme-Ordner, starten Sie sie aber noch nicht
    - Öffnen Sie das Terminal, geben Sie `sudo xattr -rd com.apple.quarantine /Applications/LinguaGacha.app` ein und drücken Sie die Eingabetaste
    - Geben Sie Ihr Systempasswort ein und schließen Sie das Terminal. Sie können die Anwendung jetzt normal starten
  - Linux:
    - Laden Sie je nach CPU-Typ `*_Linux_x64.AppImage` oder `*_Linux_arm64.AppImage` herunter
    - Erteilen Sie mit `chmod +x LinguaGacha*.AppImage` die Ausführungsberechtigung
    - Führen Sie `./LinguaGacha*.AppImage` aus
- Besorgen Sie sich Zugang zu einer zuverlässigen KI-Modellschnittstelle. Empfehlung:
  - [ [DeepSeek](https://github.com/neavo/LinguaGacha/wiki/DeepSeek) ], keine Grafikkarte erforderlich
- Bereiten Sie die zu übersetzenden Texte vor
  - `Untertitel` und `E-Books` benötigen in der Regel keine Vorverarbeitung
  - `Spieltexte` müssen mit einem zur jeweiligen Spiel-Engine passenden Werkzeug extrahiert werden
- Starten Sie die Anwendung
  - Ziehen Sie die `zu übersetzenden Dateien` auf die Seite, um ein Projekt zu erstellen
  - Legen Sie in den `Grundeinstellungen` die Ausgangs- und Zielsprache sowie weitere erforderliche Angaben fest
  - Wählen Sie in `AGENT` ein Modell aus und klicken Sie nacheinander auf die vorgegebenen Anweisungen, um folgende Schritte auszuführen:
    - `Terminologie extrahieren`　`👈👈 Optional, aber empfohlen; wichtig für die Qualität`
    - `Vollständigen Text übersetzen`
    - `Automatisch Korrektur lesen`　`👈👈 Optional, aber empfohlen; wichtig für die Qualität`
  - Klicken Sie in `AGENT` auf die Option zum Generieren der Übersetzung

## Anleitungen 📝
- Allgemein
  - [Grundlagen-Tutorial](https://github.com/neavo/LinguaGacha/wiki/BasicTutorial)　`👈👈 Schritt für Schritt erklärt, leicht verständlich und für Einsteiger empfohlen`
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von WOLF-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForWOLF)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von RenPy-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRenPy)
  - [Bewährte Vorgehensweisen für hochwertige Übersetzungen von RPGMaker-Spielen](https://github.com/neavo/LinguaGacha/wiki/BestPracticeForRPGMaker)
- Videoanleitungen
  - [RPGMV mit LinguaGacha und Translator++ übersetzen (Englisch)](https://www.youtube.com/watch?v=wtV_IODzi8I)
- Funktionsbeschreibungen
  - [Befehlszeilenmodus](https://github.com/neavo/LinguaGacha/wiki/CLIMode)
  - [Glossar](https://github.com/neavo/LinguaGacha/wiki/Glossary)　　[Textschutz](https://github.com/neavo/LinguaGacha/wiki/TextPreserve)　　[Textersetzung](https://github.com/neavo/LinguaGacha/wiki/Replacement)
  - [MTool-Optimierer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)　　[Werkzeugkasten – Umwandlung zwischen traditionellem und vereinfachtem Chinesisch](https://github.com/neavo/LinguaGacha/wiki/TSConversion)
- Ausführlichere Informationen zu den Funktionen finden Sie im [Wiki](https://github.com/neavo/LinguaGacha/wiki). Teilen Sie Ihre Erfahrungen gerne in den [Diskussionen](https://github.com/neavo/LinguaGacha/discussions)

## Unterstützte Formate 🏷️
- Untertitel `.srt .ass`
- E-Books `.txt .epub`
- Markdown `.md`
- Mit [RenPy](https://www.renpy.org) exportierte Spieltexte `.rpy`
- Mit [MTool](https://mtool.app) exportierte Spieltexte `.json`
- Mit [SExtractor](https://github.com/satan53x/SExtractor) exportierte Spieltexte `.txt .json .xlsx`
- Mit [VNTextPatch](https://github.com/arcusmaximus/VNTranslationTools) exportierte Spieltexte `.json`
- [Translator++](https://dreamsavior.net/translator-plusplus)-Projektdateien `.trans`
- Mit [Translator++](https://dreamsavior.net/translator-plusplus) exportierte Spieltexte `.xlsx`
- Mit dem [offiziellen WOLF-Übersetzungswerkzeug](https://silversecond.booth.pm/items/5151747) exportierte Spieltexte `.xlsx`
- Beispiele finden Sie unter [Wiki – Unterstützte Dateiformate](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F). Weitere Formate werden laufend ergänzt. Wünsche können Sie unter [ISSUES](https://github.com/neavo/LinguaGacha/issues) einreichen

## Neueste Updates 📅
- 20260914 v0.121.0
  - Verschiedene Verbesserungen der Benutzeroberfläche
    - Neue Oberflächensprachen: `Japanisch` und `Koreanisch` [#875](../../issues/875)
    - Neue Darstellung von `Markdown` [#884](../../issues/884)
    - Weitere Verbesserungen der Bedienung [#878](../../issues/878) [#882](../../issues/882)
  - Fehlerbehebungen und Verbesserungen [#876](../../issues/876) [#879](../../issues/879) [#880](../../issues/880) [#883](../../issues/883) [#885](../../issues/885)

## Entwicklung 🛠️
- Installieren Sie [Go](https://go.dev) und [`Node.js`](https://nodejs.org)
- Abhängigkeiten installieren: `npm install`
- Abhängigkeiten aktualisieren: `npm ci`
- Anwendung starten: `npm run dev`
- Release erstellen: `npm run build`
- Führen Sie vor dem Einreichen eines PR die zum Änderungsumfang passenden Prüfungen aus [`docs/WORKFLOW.md`](./docs/WORKFLOW.md) aus
- Wenn Sie nicht selbst entwickeln möchten, laden Sie die fertige Version direkt von der [Release-Seite](https://github.com/neavo/LinguaGacha/releases) herunter

## Probleme melden 😥
- Laufzeitprotokolle werden unter anderem im Ordner `log` im Stammverzeichnis der Anwendung gespeichert
- Fügen Sie diese Protokolldateien bitte Ihrer Fehlermeldung bei
- Sie können auch unseren Gruppen beitreten, um sich auszutauschen und Feedback zu geben
  - QQ - 41763231⑥
  - Discord - https://discord.gg/pyMRBGse75
