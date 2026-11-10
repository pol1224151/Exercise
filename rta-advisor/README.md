# 第七史詩 RTA 顧問

在這個資料夾啟動靜態伺服器後，用瀏覽器打開首頁。

```bash
cd rta-advisor
python3 -m http.server 8765
```

然後打開 `http://127.0.0.1:8765/`。

預設載入的是標好的範例名單，不是你的帳號。個人化建議要等你用 Fribbels 匯出 `gear.txt` 或 Save all 的 JSON，再在頁面上載入。

檢查沙盤：

```bash
node rta-advisor/test/engine.test.mjs
```

技能倍率來自 Fribbels `herodata.json` commit `cd69229`（2026-11-07）。賽季套裝與神器來自 Epic7RTAStats 2026 秋季賽季（`pvp_rta_ss21`）Champion+，抓取日 2026-11-10。假設的遊戲版本是 8.7（2026-10-29）加上 2026-11-05 的修正檔；2026-11-19 的平衡調整預告沒有算進去。
