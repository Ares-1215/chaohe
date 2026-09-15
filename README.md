# 朝和餅舖 出貨分區統計

每日從貨物追蹤系統抓 4106 彰化「74257 黃世良」與「64237 蔣廷彧」兩位司機的卸集明細，只留客戶代號 05964550009 朝和餅舖，
依到著站分區（北一／北二／桃竹／中／彰嘉／南）後顯示並可匯出 Excel。

- 網址：https://ares-1215.github.io/chaohe/（無通行碼；含收件人姓名地址，勿外傳）
- 後端：Supabase 表 `chaohe_shipments`（PK ship_date+invoice_no，RLS 無 anon）＋ Edge Function `chaohe`
  - `upload`：ingest token 驗證，**整日覆蓋**（先刪該日再插入）
  - `dates`：有資料的日期＋筆數/件數
  - `range`：from/to 區間明細
- 日期選擇：單日＝日期框＋◀▶（跳前一個／後一個有資料的日期）；整月＝月份框＋◀▶切月，逐日彙總表點列可切到該日；「最新」鈕。
- 相容性：index.html 只用 ES2018 以內語法（公司電腦 Edge 不吃 `??=`，會整頁空白），`window.onerror` 會把錯誤顯示在頁面。
- 大客戶寶島眼鏡：收貨人含「寶島」（`regions.js` 的 `VIP`）另列——網頁「大客戶」卡片（KPI＋分區彙總＋明細）、Excel 多一張「寶島眼鏡」工作表，分區彙總表多「寶島眼鏡筆數／件數」欄；出貨明細仍含全部。
- 分區／到著簡碼對照：`regions.js`（來源桌面「新竹物流各區.xlsx」，要改分區改這裡）
- Excel：ExcelJS，欄位 分區/貨號/到著簡碼/到著站/收貨人/收貨地址/件數/卸集時間，
  依區排序、整列分區底色（老花眼友善高對比）、篩選、凍結首列、A4 橫向縮一頁寬、每頁重複標題列。
  整月模式多「日期」欄與「逐日彙總」工作表。

## 更新方式（對 Claude 說「更新朝和」）

前置：瀏覽器面板登入 https://cagweb.hct.com.tw:8081/apex.aspx?apex=CAGWEB.A_PISDR320（使用者自己登入）。

1. **A 卸集清單（8081）**：導到
   `https://cagweb.hct.com.tw:8081/Apex.aspx?APEX=CAGWEB.A_PIKAM052_1&pSCD=4106&pDATE_WK=YYYYMMDD&pOPE=74257&pMARK=2&pSearchFlg=2`
   用 `tools/fetch_chaohe.js` 的 `listStep()` 取 [{invoice_no,dest_station,pcs}]。（pDayFlg 只保留 30 天）
2. **B 逐筆明細（8080）**：導到任一貨號 `https://cagweb.hct.com.tw:8080/CAGWEB/C_PIKAM020.aspx?pACT=C_PISDR320&pINVOICE_NO=<貨號>&pADDITION_NO=000&pNo=<貨號>`
   注入 `CH` 物件＋清單，跑 `CH.detailStep(list)`；輪詢 `window.__ch.running`。
   每筆同源 fetch 託運資料＋ `C_PIKAM022.ashx`（收件地址顯示號碼版），兩版遮罩互補合成完整地址。約 0.8 秒/筆。
3. **C 上傳**：同一分頁 `CH.uploadStep('YYYY-MM-DD', token, rows)`（token 在 `tools/config.local.json`，不進版控）。
   兩位司機（pOPE=74257 黃世良、64237 蔣廷彧）的清單各跑一次 A，合併後一起跑 B（每筆帶 `driver`/`date`），
   再依日期分組上傳。**上傳是整日覆蓋**，只重抓其中一位時用 `CH.mergeUpload()` 先把庫裡另一位的資料撈回合併。
   欄位 `driver` 存司機姓名，網頁明細與 Excel 都有「司機」欄，KPI 顯示兩位各幾筆幾件。

踩雷：
- 8081 與 8080 是不同來源，跨域 fetch 會 `Failed to fetch`，所以清單與明細要分兩段、靠 javascript_tool 回傳值搬資料。
- 清單頁的收貨人／出貨人是遮罩（朝＊餅舖），要靠明細頁的客戶代號判斷。
- 地址：明細頁 `lblTrsRecAddr` 是「縣市清楚、號碼打＊」，`C_PIKAM022.ashx` 回的是「前三字打＊、號碼清楚」，逐字合併＋全形轉半形。
- Write 工具寫 index.html 時 hook 會把它開進瀏覽器面板新分頁，原本 cagweb 分頁還在，用 tabId 指定即可。
