<div align=center><img src="https://github.com/user-attachments/assets/cdf990fb-cf03-4370-a402-844f87b2fab8" width="256px;"></div>
<div align=center><img src="https://img.shields.io/github/v/release/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/license/neavo/LinguaGacha"/>   <img src="https://img.shields.io/github/stars/neavo/LinguaGacha"/></div>
<p align='center'>Penerjemah teks generasi baru  memanfaatkan kecerdasan buatan untuk menerjemahkan novel, game, subtitle, dan lainnya hanya dengan satu klik.</p>

&ensp;
&ensp;

## README 🌍
- [ [中文](./README.md) ] | [ [English](./README_EN.md) ] | [ [日本語](./README_JA.md) ] [ [Indonesia](./README_ID.md) ]

## Ikhtisar 📢
- [LinguaGacha](https://github.com/neavo/LinguaGacha) (/ˈlɪŋɡwə ˈɡɑːtʃə/), disingkat `LG`, adalah penerjemah teks generasi baru berbasis AI.
- Siap digunakan tanpa pengaturan rumit, menawarkan fungsionalitas yang kuat tanpa pengaturan yang kompleks.
- Mendukung penerjemahan satu klik antara 13 bahasa:
  - Termasuk `Mandarin`, `Inggris`, `Jepang`, `Korea`, `Rusia`, `Jerman`, `Prancis`, `Indonesia`, dll.
- Mendukung berbagai jenis dan format teks seperti `subtitle`, `e-book`, dan `teks dalam game`.
- Mendukung Api Ai lokal maupun awan `Claude`, `OpenAi`, `DeepSeek`, `SakuraLLM`.

> <img src="https://github.com/user-attachments/assets/859a7e32-bf35-4572-8460-4ecb11a8d20c" style="width: 80%;">

> <img src="https://github.com/user-attachments/assets/c0d7e898-f6fa-432f-a3cd-e231b657c4b5" style="width: 80%;">

## Catatan Khusus ⚠️
- Jika Anda menggunakan [LinguaGacha](https://github.com/neavo/LinguaGacha) untuk menerjemahkan, harap sertakan atribusi yang jelas di lokasi yang menonjol dalam informasi atau halaman rilis produk anda !
- Untuk proyek yang melibatkan aktivitas komersial atau menghasilkan keuntungan, harap hubungi developer untuk mendapatkan izin sebelum menggunakan [LinguaGacha](https://github.com/neavo/LinguaGacha)!

## Fitur Utama 📌
- Kecepatan terjemahan super cepat: 10 detik untuk subtitle, 1 menit untuk novel, 5 menit untuk game.
- Pembuatan glosarium otomatis untuk memastikan konsistensi istilah (misalnya, nama karakter) dalam karya. `👈👈 Fitur Eksklusif`
- Kualitas terjemahan optimal dari model unggulan (misalnya, DeepSeek-R1) hingga model lokal kecil (misalnya, Qwen2.5-7B).
- `100%` mempertahankan format teks dan kode yang disematkan, secara signifikan mengurangi pekerjaan pasca-pemrosesan - sangat cocok untuk lokalisasi . `👈👈 Fitur Eksklusif`

## Persyaratan Sistem 🖥️
- Kompatibel dengan antarmuka model AI yang mengikuti standar `OpenAI`, `Google`, `Anthropic`, `SakuraLLM`.
- Kompatibel dengan [KeywordGacha](https://github.com/neavo/KeywordGacha) `👈👈 Alat generasi baru untuk pembuatan glosarium berbasis AI`.

## Alur Kerja Dasar 🛸
- Unduh aplikasi dari [halaman Rilis](https://github.com/neavo/LinguaGacha/releases).
- Dapatkan API Ai pilihan anda (pilih salah satu):

| Penyedia API                                      | Harga                                      | Catatan                                               |
|--------------------------------------------------|--------------------------------------------|---------------------------------------------------------|
| [**OpenAI**](https://platform.openai.com/docs/overview) | Berbayar (mahal)                          | Hasil berkualitas tinggi, tetapi membutuhkan investasi awal yang besar. Ada sensor; perlu penyesuaian prompt khusus. |
| [**Claude (Anthropic)**](https://www.anthropic.com/) | Berbayar (mahal)                          | Kualitas terjemahan sangat baik, ada sensor, dan memerlukan modifikasi prompt. |
| [**Local AI**](https://github.com/neavo/OneClickLLAMA) | Gratis                                    | Mendukung format OpenAI API, memerlukan minimal 8GB VRAM (disarankan Nvidia). Dapat menjalankan model seperti Llama secara lokal. |
| [**DeepSeek AI**](https://platform.deepseek.com/sign_in) | Berbayar (murah)                           | Cepat, berkualitas tinggi, tanpa sensor, tidak memerlukan GPU. |
| [**Groq AI**](https://console.groq.com/login)    | Freemium (dapat ditingkatkan ke versi berbayar) | Tanpa sensor, mendukung banyak model, tetapi memiliki batasan kecepatan. Jika di-upgrade, penggunaan token sebelumnya mungkin ditagih. |
| [**Celebres AI**](http://cloud.cerebras.ai/)     | Freemium  (beta)                                 | Tanpa sensor, tersedia gratis 2 model (Llama 70B & 8B), tetapi ada batasan penggunaan. |
| [**Google Gemini AI Studio**](https://cloud.google.com/generative-ai-studio?hl=id) | Terjangkau, uji coba gratis 90 hari (kredit $300), hanya berbayar jika di-upgrade | Memerlukan kartu kredit dan hanya tersedia di wilayah tertentu. |


- Siapkan bahan terjemahan:
  - `Subtitle`/`E-book` biasanya tidak memerlukan prapemrosesan.
  - `Teks game` perlu diekstrak menggunakan alat yang sesuai untuk mesin game tertentu.
- Jalankan aplikasi melalui `app.exe`:
  - Konfigurasikan pengaturan penting (bahasa sumber/target) di `Project Setting`.
  - Salin file ke folder input (default: `input`), mulai terjemahan dengan menklik `Start Translation`.

## Panduan Pengguna 📝
- Tutorial
  - [Tutorial Video Lokalisasi AI Game RenPy (Mandarin)](https://space.bilibili.com/631729629/lists/4832968)
  - [Cara Menerjemahkan RPGMV dengan LinguaGacha dan Translator++ (Inggris)](https://www.youtube.com/watch?v=wtV_IODzi8I)
- Deskripsi Fitur
  - [Glosarium](https://github.com/neavo/LinguaGacha/wiki/%E6%9C%AF%E8%AF%AD%E8%A1%A8)　　[Penggantian Sebelum Terjemahan](https://github.com/neavo/LinguaGacha/wiki/%E8%AF%91%E5%89%8D%E6%9B%BF%E6%8D%A2)　　[Penggantian Setelah Terjemahan](https://github.com/neavo/LinguaGacha/wiki/%E8%AF%91%E5%90%8E%E6%9B%BF%E6%8D%A2)
  - [MTool Optimizer](https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer)
- Anda dapat menemukan lebih banyak detail tentang setiap fitur di [Wiki](https://github.com/neavo/LinguaGacha/wiki), dan Anda dipersilakan untuk berbagi pengalaman di [Discussions](https://github.com/neavo/LinguaGacha/discussions).

## Format yang Didukung 🏷️
- Memproses semua file yang didukung dalam folder input (termasuk subdirektori):
  - Subtitle (.srt .ass)
  - E-book (.txt .epub)
  - Markdown (.md)
  - Ekspor [RenPy](https://www.renpy.org) (.rpy)
  - Ekspor [MTool](https://afdian.com/a/AdventCirno) (.json)
  - Ekspor [SExtractor](https://github.com/satan53x/SExtractor) (.txt .json .xlsx)
  - Proyek [Translator++](https://dreamsavior.net/translator-plusplus) (.trans)
  - Ekspor [Translator++](https://dreamsavior.net/translator-plusplus) (.xlsx)
- Lihat [Wiki - Format yang Didukung](https://github.com/neavo/LinguaGacha/wiki/%E6%94%AF%E6%8C%81%E7%9A%84%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F) untuk contoh. Kirim permintaan format melalui [ISSUES](https://github.com/neavo/LinguaGacha/issues).

## Pembaruan Terbaru 📅
- 20250313 v0.12.3
  - OPT - Jika entri data dalam file .trans memiliki tag AQUA, paksa penerjemahan ulang.
  - FIX - Masalah kompatibilitas pada beberapa file .trans.

## FAQ 📥
- Hubungan antara [LinguaGacha](https://github.com/neavo/LinguaGacha) dan [AiNiee](https://github.com/NEKOparapa/AiNiee)
  - `LinguaGacha` adalah penulisan ulang total yang mengadopsi  `AiNiee`.
  - Pengembang `LinguaGacha` adalah kontributor utama untuk `AiNiee v5`.

## Dukungan 😥
- Log runtime disimpan dalam folder `log`.
- Harap lampirkan log terkait saat melaporkan masalah.
- Anda juga dapat bergabung dalam grup diskusi dan umpan balik:
  - Discord - https://discord.gg/pyMRBGse75
