/*
 * 朝和餅舖 出貨抓取腳本（在瀏覽器面板 javascript_tool 執行，需已登入貨物追蹤系統）
 *
 * 兩段式（8081 與 8080 是不同來源，跨域 fetch 會失敗）：
 *  A. 在 8081 卸集清單頁執行 listStep()：
 *     https://cagweb.hct.com.tw:8081/Apex.aspx?APEX=CAGWEB.A_PIKAM052_1&pSCD=4106&pDATE_WK=YYYYMMDD&pOPE=74257&pMARK=2&pSearchFlg=2
 *     → 回傳 [{invoice_no, dest_station, pcs, sender_masked}]
 *  B. 在 8080 任一貨號明細頁（C_PIKAM020.aspx）執行 detailStep(list)：
 *     同源 fetch 每筆 C_PIKAM020.aspx（收件人/商品/件數/郵區/卸集時間/客戶代號）＋
 *     C_PIKAM022.ashx（收件地址顯示號碼版），兩版地址合併成完整地址。
 *     結果放 window.__ch = {idx,total,done,errors,running}；輪詢 running=false 後取 done。
 *  只保留客戶代號 05964550009（朝和餅舖）的貨。
 */
const CH = {
  CUST: '05964550009',
  listStep() {
    const d = window.frames[0].document;
    const rows = [...d.querySelectorAll('tr')].filter(tr => tr.cells.length >= 17 && /^\d{10}$/.test(tr.cells[1].innerText.trim()));
    return rows.map(tr => ({
      invoice_no: tr.cells[1].innerText.trim(),
      dest_station: tr.cells[4].innerText.trim(),
      pcs: parseInt(tr.cells[8].innerText.trim(), 10) || 0,
      sender_masked: tr.cells[5].innerText.trim(),
    }));
  },
  toHalf(s) { return (s || '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').trim(); },
  mergeAddr(masked, revealed) {
    masked = masked || ''; revealed = revealed || '';
    let full;
    if (revealed && masked.length === revealed.length) {
      // masked：縣市清楚、號碼打＊；revealed：前三字打＊、號碼清楚
      full = ''; for (let i = 0; i < masked.length; i++) full += masked[i] === '＊' ? revealed[i] : masked[i];
    } else if (revealed) {
      full = masked.slice(0, 3) + revealed.slice(3);
    } else full = masked;
    return CH.toHalf(full);
  },
  parseDetail(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const txt = id => (doc.getElementById('ctl00_IFMContent_' + id) || {}).innerText || '';
    const cellAfter = label => {
      const td = [...doc.querySelectorAll('td')].find(t => t.children.length === 0 && t.innerText.trim() === label);
      return td && td.nextElementSibling ? td.nextElementSibling.innerText.trim() : '';
    };
    const pdt = [...doc.querySelectorAll('tr')].find(tr => tr.cells.length > 5 && tr.cells[2] && tr.cells[2].innerText.trim() === '卸集貨');
    const cust = txt('lblTrsFwdCustCd').trim();
    return {
      cust_code: (cust.match(/^\d{11}/) || [''])[0],
      cust_name: CH.toHalf(cust.replace(/^\d{11}/, '')),
      receiver: CH.toHalf(txt('lblTrsRecNam')),
      addr_masked: txt('lblTrsRecAddr').trim(),
      product_cls: cellAfter('商品區分1'),
      pcs_detail: parseInt(cellAfter('件數'), 10) || 0,
      postal: cellAfter('收件郵區'),
      dest_detail: cellAfter('到著站'),
      unload_time: pdt ? pdt.cells[1].innerText.trim() : '',
    };
  },
  // list 每筆可帶 driver（司機姓名）與 date（YYYY-MM-DD），多位司機／多天可一次跑
  async detailStep(list, delay = 250) {
    window.__ch = { idx: 0, total: list.length, done: [], errors: [], running: true };
    const base = 'https://cagweb.hct.com.tw:8080/CAGWEB/';
    for (const it of list) {
      try {
        const u = `${base}C_PIKAM020.aspx?pACT=C_PISDR320&pINVOICE_NO=${it.invoice_no}&pADDITION_NO=000&pNo=${it.invoice_no}`;
        const html = await (await fetch(u, { credentials: 'include', cache: 'no-store' })).text();
        const d = CH.parseDetail(html);
        if (d.cust_code !== CH.CUST) { window.__ch.idx++; continue; }   // 非朝和餅舖略過
        let revealed = '';
        try {
          const a = `${base}C_PIKAM022.ashx?Type=hlkTrsRecAddrDetail&pINVOICE_NO=${it.invoice_no}&pADDITION_NO=000&pMode=&pMode1=1&_=${Date.now()}`;
          const j = await (await fetch(a, { credentials: 'include', cache: 'no-store' })).json();
          revealed = j.TRS_ADDR || '';
        } catch (e) { /* 地址顯示失敗就用遮罩版 */ }
        window.__ch.done.push({
          invoice_no: it.invoice_no,
          dest_station: it.dest_station || d.dest_detail,
          receiver: d.receiver,
          address: CH.mergeAddr(d.addr_masked, revealed),
          pcs: it.pcs || d.pcs_detail,
          product_cls: d.product_cls,
          postal: d.postal,
          unload_time: d.unload_time,
          cust_code: d.cust_code,
          cust_name: d.cust_name,
          driver: it.driver || '',
          date: it.date || '',
        });
      } catch (e) { window.__ch.errors.push({ invoice_no: it.invoice_no, err: String(e) }); }
      window.__ch.idx++;
      await new Promise(r => setTimeout(r, delay));
    }
    window.__ch.running = false;
    return window.__ch.done.length;
  },
  // C. 直接從瀏覽器分頁 POST 到 Edge Function（實測 cagweb 分頁可打 Supabase；不必走 PowerShell）
  // 上傳是「整日覆蓋」：只抓其中一位司機時，要先把庫裡該日既有資料（另一位司機）撈回來合併再上傳
  async uploadStep(dateISO, token, rows, edge = 'https://hmqnlovyzlvvnkqmfwtt.supabase.co/functions/v1/chaohe') {
    rows = rows || window.__ch.done;
    const r = await fetch(edge, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'upload', token, date: dateISO, rows }) });
    return { status: r.status, body: await r.text() };
  },
  async mergeUpload(dateISO, token, newRows, edge = 'https://hmqnlovyzlvvnkqmfwtt.supabase.co/functions/v1/chaohe') {
    const r = await fetch(edge, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'range', from: dateISO, to: dateISO }) });
    const old = ((await r.json()).rows || []);
    const drivers = new Set(newRows.map(x => x.driver));
    const keep = old.filter(x => !drivers.has(x.driver || ''));   // 這次沒重抓的司機保留舊資料
    const seen = new Set(newRows.map(x => x.invoice_no));
    const merged = newRows.concat(keep.filter(x => !seen.has(x.invoice_no)));
    return CH.uploadStep(dateISO, token, merged, edge);
  },
};
window.CH = CH;
