# 第七史詩 RTA 顧問

```bash
cd rta-advisor
python3 server.py
```

用 Chrome 或 Edge 打開 `http://127.0.0.1:8765/`。

頁面順序：

1. 讀入 Fribbels 匯出的帳號（英雄和裝備）。
2. 對照這個賽季的配裝，分開顯示你現在有的，和建議調整的。
3. 世界競技場開打後才分享遊戲視窗，給出下一步禁選或技能、要不要燒魂。

「更新英雄、倍率與賽季」會重新抓 Fribbels 的英雄資料庫、技能倍率和神器，以及 Epic7RTAStats 的賽季模型，並把版本寫在頁面上方。

```bash
node rta-advisor/test/engine.test.mjs
node rta-advisor/test/screen.test.mjs
```

技能倍率來自 Fribbels。賽季套裝與神器來自 Epic7RTAStats。頁面上的版本列會寫 commit、賽季代號和假設的遊戲版本。
