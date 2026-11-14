# 第七史詩 RTA 顧問

Windows 請雙擊 `rta-advisor/RtaAdvisor.exe`。它會在這台電腦啟動顧問並打開 `http://127.0.0.1:8765/`。不要在雙擊之前先開那個網址。

已經會下指令的人：

```bash
cd rta-advisor
python3 server.py
```

然後用 Chrome 或 Edge 打開 `http://127.0.0.1:8765/`。

重新打包 Windows 檔：

```bash
cd rta-advisor
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o RtaAdvisor.exe .
```

打包前先把 `launcher.go` 的 `packVersion` 加一，新的 exe 才會換掉使用者電腦上已展開的資料。

頁面順序：

1. 讀入 Fribbels 匯出的帳號（英雄和裝備）。讀入後存在這台瀏覽器，下次打開不用再匯入。
2. 對照這個賽季的配裝。神器只建議帳號裡有的；速度只比你讀得到的裝備，到不了就直說，不把別人的面板寫成你的。
3. 世界競技場開打後才分享遊戲視窗。沙盤估計一直顯示。同類型 4 對 4 的實戰勝率低於畫面上的門檻（預設 40%）時，選角改推薦另一組。人已經在場上時，技能仍照沙盤。

「更新英雄、倍率與賽季」會重新抓 Fribbels 的英雄資料庫、技能倍率和神器，以及 Epic7RTAStats 的賽季模型，並把版本寫在頁面上方。

```bash
node rta-advisor/test/engine.test.mjs
node rta-advisor/test/screen.test.mjs
node rta-advisor/test/records.test.mjs
```

技能倍率來自 Fribbels。賽季套裝與神器來自 Epic7RTAStats。頁面上的版本列會寫 commit、賽季代號和假設的遊戲版本。
