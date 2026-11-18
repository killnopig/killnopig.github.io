# JJptt 臉書粉專素材

這個資料夾是開 JJptt 臉書粉絲專頁要用的圖和文字。圖片的原始檔在 `src/`（`node docs/fb/src/render.js` 重新產生，字型另外用 `npm pack @fontsource/noto-sans-tc` 放進 `src/fonts/`）。

圖裡和文中的帳號、文章、IP 都是虛構的示範資料。

## 圖片

| 用途 | 檔案 | 尺寸 |
|---|---|---|
| 大頭貼 | `fb-avatar.png` | 1200×1200（臉書會裁成圓形，四周已留邊） |
| 封面相片 | `fb-cover.png` | 1640×624（字和手機都在中間，手機上左右被裁掉也看得到） |
| 第 1 篇貼文 | `post1-intro.png` | 1080×1350 |
| 第 2 篇貼文 | `post2-fact-1.png` ＋ `post2-fact-2.png` | 兩張一起發 |
| 第 3 篇貼文 | `post3-desktop.png` | |
| 第 4 篇貼文 | `post4-ios.png` | 可不配圖 |

## 粉專基本資料

- **粉絲專頁名稱**：JJptt
- **類別**：應用程式頁面（找不到就選「軟體」）
- **用戶名稱**：jjptt（被用走就 jjptt.app）
- **網站**：https://github.com/JJptt1980/JJptt
- **行動按鈕**：「下載」或「使用應用程式」，連到 https://github.com/JJptt1980/JJptt/releases/tag/android-stable

**簡介**（臉書上限 101 字，下面這段 79 字）：

```
免費、開源、無廣告的 PTT 用戶端：Android App 和 Chrome 擴充功能。秒推、同網段、機房 IP 自動標出來，看 PTT 順手抓出帶風向的。
```

**詳細介紹**（放在「關於」的其他欄位）：

```
JJptt 是用來看 PTT 的免費工具，有 Android App 和 Chrome 擴充功能兩個版本。

📖 好讀：圖片、新聞連結卡片直接夾在文章裡，推文有樓層和 IP 國旗
🔍 真.事實查核（FACT）：秒推、脈衝、罐頭推文、同網段、機房 IP、相似帳號……直接標在推文旁邊，也能一鍵交給 AI 判讀
✍️ 推文、回文、發文都可以，推完馬上看到自己的推文
🔒 App 直接連上 PTT，不經過別人的伺服器；密碼存在手機的 Android Keystore，只在你手機裡

Android App：https://github.com/JJptt1980/JJptt/releases/tag/android-stable
原始碼與擴充功能版：https://github.com/JJptt1980/JJptt
請我喝咖啡：https://ko-fi.com/jjptt1980

本專頁是個人開發的非官方工具，與 PTT 批踢踢實業坊無關。
```

## 開站貼文

依序發，第 1 篇發完置頂。

### 第 1 篇：介紹（配 `android-cover.png`，置頂）

```
JJptt 粉專開張了 🎉

JJptt 是一個看 PTT 的免費工具，Android 手機和電腦（Chrome 擴充功能）都能用。

它會把「可能有人在帶風向」的跡象直接標在推文旁邊：
⚡ 秒推：發文沒幾分鐘就一排人推
🌐 同網段：好幾個帳號來自同一段 IP
🏢 機房：從雲端主機（例如 DigitalOcean）來的推文
📋 罐頭：好幾個人講幾乎一樣的話

其他也很好用：
📖 圖片、新聞卡片夾在文章裡，推文有樓層和國旗
✍️ 推文、回文、發文都可以
🔒 App 直接連 PTT，不經過別人的伺服器，密碼只存在你的手機
🆓 免費、開源、沒有廣告

📱 Android App 下載（約 10 MB，Android 7.0 以上）
https://github.com/JJptt1980/JJptt/releases/tag/android-stable
第一次安裝手機會問要不要允許「安裝不明來源的應用程式」，選允許就好（因為沒有上架 Google Play）

💻 電腦版、原始碼
https://github.com/JJptt1980/JJptt

有問題、想要的功能，歡迎在這裡留言或私訊 🙌

#JJptt #PTT #批踢踢 #鄉民 #帶風向 #開源 #Android
```

### 第 2 篇：FACT 怎麼看（配 `android-fact.png` ＋ `app-pushes.png`）

```
一分鐘內五個人都說「真的超好喝」？🧋

這是 JJptt 的「真.事實查核」（FACT）會抓出來的例子（圖裡都是示範用的假帳號）：

🔸 1～5 樓在發文 2 分鐘內就推完 → 秒推
🔸 其中 3 個帳號來自同一段 IP → 同網段
🔸 另外 2 個從 DigitalOcean 機房連進來 → 同機房
🔸 大家講的話幾乎一樣 → 罐頭

文章上方會有一份 FACT 報告，整理這篇有哪些疑點；每則推文旁邊也會標出來。看不懂？按「問 AI」，一鍵交給 AI 幫你判讀。

⚠️ 標出來不代表一定是網軍，只是「值得多看一眼」。每條規則都能在設定裡調門檻或關掉。

規則說明 👉 https://github.com/JJptt1980/JJptt/blob/gh-pages/docs/fact.md
App 下載 👉 https://github.com/JJptt1980/JJptt/releases/tag/android-stable

#JJptt #PTT #事實查核 #帶風向 #網軍
```

### 第 3 篇：電腦版（配 `reader-factcheck.png`）

```
在電腦上看 PTT 的人看這邊 💻

JJptt 也有 Chrome 擴充功能版（Edge、Brave、Arc、Vivaldi 也能用）：
✅ 保留原本的 BBS 終端機畫面，熟悉的鍵盤操作都在
✅ 多一個「閱讀模式」：圖片、連結卡片直接顯示，推文有樓層、國旗、FACT 標記
✅ 黑名單、自訂名單、自動擋洗版
✅ 設定可以存成檔案，搬到手機 App 直接用

安裝要照步驟做一次，大約 5 分鐘 👇
https://github.com/JJptt1980/JJptt/blob/gh-pages/docs/desktop.md

#JJptt #PTT #Chrome擴充功能
```

### 第 4 篇：iPhone 版（不用配圖，或配 `fb-avatar.png`）

```
「有沒有 iPhone 版？」是最常被問的問題 🍎

老實說我也很想做。程式大部分可以沿用，但 iOS App 要上架，得先加入 Apple 開發者計畫（每年 99 美元），還需要一支 iPhone 來測試直連 PTT、推文這些功能。

JJptt 一直是免費、沒有廣告的業餘專案，這筆費用目前還沒有著落。如果你覺得 JJptt 好用、也願意幫忙促成 iOS 版，歡迎到 Ko-fi 請我喝杯咖啡 ☕ 金額不拘，完全自由，不影響任何功能。

https://ko-fi.com/jjptt1980

謝謝大家 🙏

#JJptt #PTT #iOS
```

## 常見問題（可以發成一篇，或放在私訊自動回覆）

```
Q：為什麼不在 Google Play？安裝會不會有問題？
A：目前是個人業餘開發，還沒有上架。APK 都有正式簽章，原始碼全部公開在 GitHub，任何人都可以檢查。手機會問「安裝不明來源的應用程式」是因為不是從 Google Play 裝，選允許就好。

Q：我的 PTT 帳號密碼安全嗎？
A：App 直接連到 PTT，中間不經過任何別人的伺服器。密碼用手機內建的 Android Keystore 加密，只存在你手機裡，不會備份到雲端。

Q：被標成秒推、同網段就是網軍嗎？
A：不一定，只是值得多看一眼。每條規則的門檻都能調，也能關掉。

Q：有 iPhone 版嗎？
A：還沒有，原因在這裡：https://github.com/JJptt1980/JJptt/blob/gh-pages/docs/android.md#關於-ios-版

Q：怎麼更新？
A：App 裡 設定 → 關於 →「檢查並自動更新」，設定和登入都會保留。
```
