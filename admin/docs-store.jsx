// docs-store.jsx — data layer + printable PDF builders for Delivery Notes
// (pps_deliveries) and Local Purchase Orders (pps_lpos). Purely additive:
// reuses the company identity, currency helpers and #pps-print-root already
// established by quote-store.jsx.
(function () {
  const COMPANY = window.PPS_COMPANY;
  const { Q_fmtMoney: fmtMoney, Q_fmtDate: fmtDate, Q_todayISO: todayISO } = window;
  const VAT_RATE = window.PPS_VAT_RATE || 0.18;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const YEAR = () => new Date().getFullYear();

  // ── Amount in words (LPO requirement) ────────────────────────────────────
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function under1000(n) {
    let s = '';
    if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) s += ' '; }
    if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += ' ' + ONES[n % 10]; }
    else if (n > 0) s += ONES[n];
    return s;
  }
  function numToWords(num) {
    let n = Math.floor(Math.abs(Number(num) || 0));
    if (n === 0) return 'Zero';
    const scales = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
    const parts = [];
    for (const [v, name] of scales) {
      if (n >= v) { parts.push(under1000(Math.floor(n / v)) + ' ' + name); n %= v; }
    }
    if (n > 0) parts.push(under1000(n));
    return parts.join(' ');
  }
  const CUR_WORD = { UGX: 'Uganda Shillings', USD: 'US Dollars', EUR: 'Euros' };
  const amountInWords = (n, cur) => `${CUR_WORD[cur] || cur} ${numToWords(n)} Only`;

  // ── Totals for an LPO (supports VAT inclusive / exclusive) ───────────────
  function lpoTotals(o) {
    const gross = (o.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
    const mode = o.vatMode || 'inclusive';
    if (mode === 'inclusive') { const subtotal = gross / (1 + VAT_RATE); return { subtotal, vat: gross - subtotal, grand: gross, mode }; }
    if (mode === 'none') return { subtotal: gross, vat: 0, grand: gross, mode };
    return { subtotal: gross, vat: gross * VAT_RATE, grand: gross * (1 + VAT_RATE), mode };
  }

  // ── Generic store factory ────────────────────────────────────────────────
  function makeStore(key, prefix, seed, startSeq) {
    const read = () => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (e) { return null; } };
    const writeAll = (l) => { try { localStorage.setItem(key, JSON.stringify(l)); } catch (e) {} };
    const padNum = (n) => prefix + YEAR() + '-' + String(n).padStart(4, '0');
    if (!read()) writeAll(seed);
    // One-time migration: legacy PPS-*/CUL-* document numbers become KG-*.
    try {
      const cur = read();
      if (cur) {
        let changed = false;
        const out = cur.map((x) => (typeof x.number === 'string' && /^(PPS|CUL)-/.test(x.number)
          ? (changed = true, { ...x, number: 'KG-' + x.number.slice(4) }) : x));
        if (changed) writeAll(out);
      }
    } catch (e) {}
    // Continuous numbering: persistent high-water counter so a deleted document
    // never frees its number for re-use.
    const seqKey = key + '_seq';
    const seqFloor = () => {
      let f = startSeq;
      try { f = Math.max(f, Number(localStorage.getItem(seqKey)) || 0); } catch (e) {}
      return list.reduce((m, x) => Math.max(m, Number(x.seq) || 0), f);
    };
    const bumpSeq = (n) => { try { localStorage.setItem(seqKey, String(n)); } catch (e) {} };
    const subs = new Set();
    let list = read() || [];
    const emit = () => { list = list.slice(); subs.forEach((f) => f(list)); };
    const persist = () => writeAll(list);
    return {
      all: () => list,
      sub: (f) => { subs.add(f); return () => subs.delete(f); },
      nextNumber: () => { const s = seqFloor() + 1; return { seq: s, number: padNum(s) }; },
      save: (x) => { const i = list.findIndex((y) => y.id === x.id); bumpSeq(Math.max(seqFloor(), Number(x.seq) || 0)); if (i >= 0) list[i] = x; else list.unshift(x); persist(); emit(); return x; },
      setStatus: (id, status) => { list = list.map((x) => (x.id === id ? { ...x, status } : x)); persist(); emit(); },
      remove: (id) => { list = list.filter((x) => x.id !== id); persist(); emit(); },
    };
  }

  const DN_SEED = [{
    id: 'dn_seed1', number: 'KG-DN-2026-0134', seq: 134,
    client: { company: 'Frux Solutions (U) Limited', tin: '1056098919', phone: '+256 746 889 178', address: 'Plot 9, Lugogo Bypass, Kampala', email: '' },
    date: '2026-05-22', customerRef: 'PO.No: FS/25-26/0234', preparedBy: 'Hillary Twebaze',
    items: [{ code: 'LTG-T8-4FT', itemNo: '', description: '4FT Fluorescent Tube', qty: 100, uom: 'Pcs' }],
    notes: 'Payment in 7 days.', status: 'Delivered', createdAt: '2026-05-22T10:00:00',
  }];
  const LPO_SEED = [{
    id: 'lpo_seed1', number: 'KG-LPO-2026-0015', seq: 15,
    supplier: { company: 'Infra Electro Services Ltd', tin: '', phone: '+256 772 445 018', address: 'Nakawa Industrial Area, Kampala', email: '' },
    date: '2026-07-27', expectedDelivery: '', paymentTerms: 'Cash on Delivery', currency: 'UGX', vatMode: 'inclusive',
    items: [{ code: 'DB-200A-TPN8', brand: 'HPL India', description: '200A TPN 8-Ways Distribution Board', uom: 'Pcs', qty: 1, unitPrice: 667000 }],
    requestedBy: 'Shiv Patel', approvedBy: '', preparedBy: 'Hillary Twebaze',
    status: 'Issued', createdAt: '2026-07-27T09:00:00',
  }];

  const DeliveryStore = makeStore('pps_deliveries', 'KG-DN-', [], 0);
  const LPOStore = makeStore('pps_lpos', 'KG-LPO-', [], 0);
  function useDeliveries() { const [l, set] = React.useState(DeliveryStore.all()); React.useEffect(() => DeliveryStore.sub(set), []); return l; }
  function useLPOs() { const [l, set] = React.useState(LPOStore.all()); React.useEffect(() => LPOStore.sub(set), []); return l; }

  // ── Shared document chrome ───────────────────────────────────────────────
  const docHead = (copyLabel) => `
      <div class="pd-copy">${esc(copyLabel.split('').join(' '))}</div>
      <div class="pd-head">
        <img class="pd-logo" src="${window.COMPANY_LOGO}" alt="${esc(COMPANY.name)}" />
        <div class="pd-co">
          <div class="pd-coname">${esc(COMPANY.name)}</div>
          <div>${esc(COMPANY.address)}</div>
          <div>Tel ${esc(COMPANY.phone)} &nbsp;·&nbsp; ${esc(COMPANY.email)} &nbsp;·&nbsp; ${esc(COMPANY.web)}</div>
          <div><strong>TIN: ${esc(COMPANY.tin)}</strong></div>
        </div>
      </div>`;
  const titleBar = (title, num, date) => `
      <div class="pd-titlebar">
        <div class="pd-title">${esc(title)}</div>
        <div class="pd-titlemeta"><div class="pd-num">${esc(num)}</div><div class="pd-date">${fmtDate(date)}</div></div>
      </div>`;

  // ── Delivery Note ────────────────────────────────────────────────────────
  function buildDeliveryPage(n, copyLabel) {
    const rows = (n.items || []).map((it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="mono">${esc(it.code) || '—'}</td>
        <td>${esc(it.description)}</td>
        <td class="r">${Number(it.qty || 0).toLocaleString('en-US')}</td>
        <td class="c">${esc(it.uom) || '—'}</td>
      </tr>`).join('');
    return `<div class="pd pd-page">
      ${docHead(copyLabel)}
      ${titleBar('DELIVERY NOTE', n.number, n.date)}
      <div class="pd-meta">
        <div class="pd-party">
          <div class="pd-lbl">From</div>
          <div class="pd-pname">${esc(COMPANY.name)}</div>
          <div>${esc(COMPANY.address)}</div>
          <div>TIN: ${esc(COMPANY.tin)}</div>
          <div>Tel: ${esc(COMPANY.phone)}</div>
          <div>${esc(COMPANY.email)}</div>
        </div>
        <div class="pd-party">
          <div class="pd-lbl">Deliver To</div>
          <div class="pd-pname">${esc(n.client.company) || '—'}</div>
          ${n.client.address ? `<div>${esc(n.client.address)}</div>` : ''}
          ${n.client.tin ? `<div>TIN: ${esc(n.client.tin)}</div>` : ''}
          ${n.client.phone ? `<div>Tel: ${esc(n.client.phone)}</div>` : ''}
          ${n.client.email ? `<div>${esc(n.client.email)}</div>` : ''}
        </div>
        <div class="pd-facts">
          <div class="pd-fact"><span>Reference</span><strong>${esc(n.number)}</strong></div>
          <div class="pd-fact"><span>Date</span><strong>${fmtDate(n.date)}</strong></div>
          <div class="pd-fact"><span>Customer Ref</span><strong>${esc(n.customerRef) || '—'}</strong></div>
          <div class="pd-fact"><span>Prepared By</span><strong>${esc(n.preparedBy) || '—'}</strong></div>
        </div>
      </div>
      <table class="pd-items">
        <thead><tr><th class="c">#</th><th>Product Code</th><th>Description</th><th class="r">Qty</th><th class="c">UOM</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="c muted">No items</td></tr>'}</tbody>
      </table>
      ${n.notes ? `<div class="pd-notes"><div class="pd-lbl">Notes</div><div>${esc(n.notes)}</div></div>` : ''}
      <div class="pd-prepared">Prepared by: <strong>${esc(n.preparedBy) || '—'}</strong></div>
      <div class="pd-sign pd-sign-3">
        <div class="pd-sigbox"><div class="pd-lbl">Delivered By</div><div class="pd-sigline"></div><div class="pd-sigmeta">Name &amp; Signature</div><div class="pd-sigline"></div><div class="pd-sigmeta">Date</div></div>
        <div class="pd-sigbox"><div class="pd-lbl">Received By</div><div class="pd-sigline"></div><div class="pd-sigmeta">Name &amp; Signature</div><div class="pd-sigline"></div><div class="pd-sigmeta">Date</div></div>
        <div class="pd-sigbox"><div class="pd-lbl">Company Stamp</div><div class="pd-stamp"></div></div>
      </div>
      <div class="pd-foot">${esc(COMPANY.name)} · ${esc(COMPANY.address)} · ${esc(COMPANY.phone)} · ${esc(COMPANY.web)} · TIN ${esc(COMPANY.tin)}<br />Computer-generated delivery note. Goods must be checked on receipt; claims accepted within 48 hours of delivery.</div>
    </div>`;
  }
  const buildDeliveryHTML = (n, copies) => (copies || ['ORIGINAL']).map((c) => buildDeliveryPage(n, c)).join('');

  // ── Local Purchase Order ─────────────────────────────────────────────────
  function buildLPOPage(o, copyLabel) {
    const t = lpoTotals(o);
    const cur = o.currency || 'UGX';
    const rows = (o.items || []).map((it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="mono">${esc(it.code) || '—'}</td>
        <td>${esc(it.brand) || '—'}</td>
        <td>${esc(it.description)}</td>
        <td class="c">${esc(it.uom) || '—'}</td>
        <td class="r">${Number(it.qty || 0).toLocaleString('en-US')}</td>
        <td class="r">${fmtMoney(it.unitPrice, cur)}</td>
        <td class="r">${fmtMoney((Number(it.qty) || 0) * (Number(it.unitPrice) || 0), cur)}</td>
      </tr>`).join('');
    return `<div class="pd pd-page">
      ${docHead(copyLabel)}
      ${titleBar('LOCAL PURCHASE ORDER', o.number, o.date)}
      <div class="pd-meta pd-meta-2">
        <div class="pd-party">
          <div class="pd-lbl">Supplier</div>
          <div class="pd-pname">${esc(o.supplier.company) || '—'}</div>
          ${o.supplier.address ? `<div>${esc(o.supplier.address)}</div>` : ''}
          ${o.supplier.tin ? `<div>TIN: ${esc(o.supplier.tin)}</div>` : ''}
          ${o.supplier.phone ? `<div>Tel: ${esc(o.supplier.phone)}</div>` : ''}
          ${o.supplier.email ? `<div>${esc(o.supplier.email)}</div>` : ''}
        </div>
        <div class="pd-facts">
          <div class="pd-fact"><span>PO Number</span><strong>${esc(o.number)}</strong></div>
          <div class="pd-fact"><span>Date</span><strong>${fmtDate(o.date)}</strong></div>
          <div class="pd-fact"><span>Expected Delivery</span><strong>${o.expectedDelivery ? fmtDate(o.expectedDelivery) : 'TBD'}</strong></div>
          <div class="pd-fact"><span>Payment Terms</span><strong>${esc(o.paymentTerms) || '—'}</strong></div>
        </div>
      </div>
      <table class="pd-items">
        <thead><tr><th class="c">#</th><th>Item Code</th><th>Brand</th><th>Description</th><th class="c">UOM</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="c muted">No items</td></tr>'}</tbody>
      </table>
      <div class="pd-bottom">
        <div>
          <div class="pd-words"><div class="pd-lbl">Amount in words</div><div>${esc(amountInWords(Math.round(t.grand), cur))}</div></div>
          ${o.notes ? `<div class="pd-notes"><div class="pd-lbl">Notes</div><div>${esc(o.notes)}</div></div>` : ''}
        </div>
        <div class="pd-totals">
          <div class="pd-trow"><span>Subtotal</span><strong>${fmtMoney(t.subtotal, cur)}</strong></div>
          <div class="pd-trow"><span>VAT @ 18%${t.mode === 'inclusive' ? ' (incl.)' : ''}</span><strong>${t.mode === 'none' ? '—' : fmtMoney(t.vat, cur)}</strong></div>
          <div class="pd-trow pd-grand"><span>Grand Total</span><strong>${fmtMoney(t.grand, cur)}</strong></div>
        </div>
      </div>
      <div class="pd-prepared">Prepared by: <strong>${esc(o.preparedBy) || '—'}</strong> (digital copy)</div>
      <div class="pd-sign pd-sign-3">
        <div class="pd-sigbox"><div class="pd-lbl">Requested By</div><div class="pd-signame">${esc(o.requestedBy) || ''}</div><div class="pd-sigline"></div><div class="pd-sigmeta">Name &amp; Date</div></div>
        <div class="pd-sigbox"><div class="pd-lbl">Approved By</div><div class="pd-signame">${esc(o.approvedBy) || ''}</div><div class="pd-sigline"></div><div class="pd-sigmeta">Name &amp; Date</div></div>
        <div class="pd-sigbox"><div class="pd-lbl">Supplier Acknowledgement</div><div class="pd-signame"></div><div class="pd-sigline"></div><div class="pd-sigmeta">Name, Signature &amp; Date</div></div>
      </div>
      <div class="pd-terms">
        <div class="pd-lbl">Terms &amp; Conditions</div>
        <ol>
          <li>All items must be delivered to the address above in good condition and to the agreed specification.</li>
          <li>This PO number must be quoted on all invoices, delivery notes and correspondence.</li>
          <li>Payment terms: ${esc(o.paymentTerms) || 'as agreed'}. Invoices without a signed Goods Received Note will not be processed.</li>
          <li>${esc(COMPANY.name)} reserves the right to reject goods that do not meet the agreed specifications.</li>
          <li>Delivery date to be confirmed in writing by the supplier.</li>
        </ol>
      </div>
      <div class="pd-foot">${esc(COMPANY.name)} · ${esc(COMPANY.address)} · ${esc(COMPANY.phone)} · ${esc(COMPANY.web)} · TIN ${esc(COMPANY.tin)}<br />System-generated purchase order.</div>
    </div>`;
  }
  const buildLPOHTML = (o, copies) => (copies || ['ORIGINAL']).map((c) => buildLPOPage(o, c)).join('');

  function printDoc(html, fileName) {
    const root = document.getElementById('pps-print-root');
    const prevTitle = document.title;
    if (fileName) document.title = fileName;
    if (!root) { window.print(); return; }
    root.innerHTML = html;
    const done = () => { window.removeEventListener('afterprint', done); setTimeout(() => { root.innerHTML = ''; document.title = prevTitle; }, 400); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 60);
  }
  const printDelivery = (n) => printDoc(buildDeliveryHTML(n, ['ORIGINAL', 'COPY']), n.number);
  const printLPO = (o) => printDoc(buildLPOHTML(o, ['ORIGINAL', 'COPY']), o.number);

  Object.assign(window, {
    DeliveryStore, LPOStore, useDeliveries, useLPOs,
    buildDeliveryHTML, buildLPOHTML, printDelivery, printLPO,
    D_lpoTotals: lpoTotals, D_amountInWords: amountInWords, D_todayISO: todayISO,
  });
})();
