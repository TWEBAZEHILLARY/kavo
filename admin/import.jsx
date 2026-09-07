// import.jsx — Bulk product import: Excel/CSV template download, upload, validate, commit.
(function () {
  const { Icon } = window;
  const T = window.ADMIN_T, F = window.ADMIN_F;
  const { Button, Modal, DataStore, ToastStore, A_CATEGORIES, A_CAT_ICON, A_PAYMENT_TERMS, A_TAG_OPTIONS, A_uid, A_money } = window;

  // Column contract — order here is the order in the template sheet.
  const COLS = [
    { key: 'name', head: 'Product Name*', width: 34, note: 'Required. Shown on the storefront.' },
    { key: 'sku', head: 'SKU', width: 18, note: 'Optional. Matching an existing SKU updates that product instead of creating a new one.' },
    { key: 'brand', head: 'Brand', width: 14, note: 'e.g. ABB, Schneider.' },
    { key: 'category', head: 'Category*', width: 22, note: 'Must be one of the categories on the Reference sheet.' },
    { key: 'stock', head: 'Stock Quantity*', width: 15, note: 'Whole number, 0 or more.' },
    { key: 'regularPrice', head: 'Regular Price (UGX)*', width: 19, note: 'Numbers only, no commas or "UGX".' },
    { key: 'salePrice', head: 'Sale Price (UGX)', width: 17, note: 'Optional. Leave blank if not on offer.' },
    { key: 'description', head: 'Description', width: 40, note: 'Short marketing description.' },
    { key: 'specs', head: 'Specifications', width: 40, note: 'One "Key: Value" per line, or separated by " | ".' },
    { key: 'image', head: 'Image URL', width: 34, note: 'Direct link to a product photo (https://…).' },
    { key: 'tags', head: 'Tags', width: 26, note: 'Comma separated, e.g. "Flash Deals, New Arrival".' },
    { key: 'home_bested', head: 'Home Bested (Yes/No)', width: 19, note: 'Yes = locally available.' },
    { key: 'imported', head: 'Imported (Yes/No)', width: 17, note: 'Yes = charges a per-unit importation fee.' },
    { key: 'import_fee', head: 'Importation Fee (UGX)', width: 20, note: 'Per unit. Only used when Imported = Yes.' },
    { key: 'payment_terms', head: 'Payment Terms', width: 20, note: 'On Delivery · Advance Payment · Deposit Payment. Blank = Advance Payment.' },
    { key: 'deposit_pct', head: 'Deposit %', width: 11, note: '1–100. Only used when Payment Terms = Deposit Payment.' },
    { key: 'featured', head: 'Customised Product (Yes/No)', width: 25, note: 'Yes = made to order, delivered within 7 working days.' },
  ];

  const SAMPLE = [
    { name: 'Tmax XT 3-Pole MCCB 63A', sku: 'ABB-XT1S160-63', brand: 'ABB', category: A_CATEGORIES[0], stock: 24, regularPrice: 545000, salePrice: 486000, description: 'Moulded case circuit breaker for distribution boards.', specs: 'Rating: 63A | Poles: 3P | Breaking: 36kA', image: 'https://', tags: 'Flash Deals', home_bested: 'Yes', imported: 'No', import_fee: '', payment_terms: 'Advance Payment', deposit_pct: '', featured: 'No' },
    { name: 'Acti9 iC60N 2-Pole MCB 32A', sku: '', brand: 'Schneider', category: A_CATEGORIES[Math.min(1, A_CATEGORIES.length - 1)], stock: 60, regularPrice: 98000, salePrice: '', description: 'Miniature circuit breaker, C-curve.', specs: 'Rating: 32A | Poles: 2P | Curve: C', image: '', tags: '', home_bested: 'No', imported: 'Yes', import_fee: 5000, payment_terms: 'Deposit Payment', deposit_pct: 50, featured: 'No' },
  ];

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const HEAD_MAP = (() => {
    const m = {};
    COLS.forEach((c) => { m[norm(c.head)] = c.key; m[norm(c.key)] = c.key; });
    // Tolerated aliases
    Object.assign(m, { product: 'name', productname: 'name', title: 'name', price: 'regularPrice', regularprice: 'regularPrice', saleprice: 'salePrice', qty: 'stock', quantity: 'stock', stockquantity: 'stock', code: 'sku', itemcode: 'sku', spec: 'specs', specification: 'specs', specifications: 'specs', image: 'image', imageurl: 'image', photo: 'image', tag: 'tags', homebested: 'home_bested', local: 'home_bested', importfee: 'import_fee', importationfee: 'import_fee', paymentterms: 'payment_terms', terms: 'payment_terms', deposit: 'deposit_pct', depositpercent: 'deposit_pct', customised: 'featured', customisedproduct: 'featured', customized: 'featured' });
    return m;
  })();

  const yes = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return s === 'yes' || s === 'y' || s === 'true' || s === '1' || s === 'x'; };
  const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
  const txt = (v) => String(v == null ? '' : v).trim();

  function matchCategory(v) {
    const n = norm(v); if (!n) return null;
    return A_CATEGORIES.find((c) => norm(c) === n) || A_CATEGORIES.find((c) => norm(c).includes(n) || n.includes(norm(c))) || null;
  }
  function matchTerms(v) {
    const n = norm(v); if (!n) return 'Advance Payment';
    return A_PAYMENT_TERMS.find((t) => norm(t) === n) || A_PAYMENT_TERMS.find((t) => norm(t).includes(n)) || null;
  }

  // ── Template generation ───────────────────────────────────────────────────
  function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  function buildTemplate() {
    const stamp = new Date().toISOString().slice(0, 10);
    const X = window.XLSX;
    if (!X) {
      const rows = [COLS.map((c) => c.head), ...SAMPLE.map((r) => COLS.map((c) => r[c.key]))];
      downloadBlob(new Blob(['\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `KAVO-Product-Import-Template-${stamp}.csv`);
      return 'csv';
    }
    const wb = X.utils.book_new();

    const aoa = [COLS.map((c) => c.head), ...SAMPLE.map((r) => COLS.map((c) => (r[c.key] === undefined ? '' : r[c.key])))];
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = COLS.map((c) => ({ wch: c.width }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: COLS.length - 1 } }) };
    COLS.forEach((c, i) => {
      const ref = X.utils.encode_cell({ r: 0, c: i });
      if (ws[ref]) ws[ref].c = [{ a: 'KAVO', t: c.note }];
    });
    X.utils.book_append_sheet(wb, ws, 'Products');

    const guide = [
      ['KAVO · PRODUCT IMPORT TEMPLATE'],
      ['Fill in the "Products" sheet — one product per row. Columns marked * are required.'],
      ['Delete the two example rows before you upload. Prices are plain numbers in UGX (no commas, no "UGX").'],
      [],
      ['COLUMN', 'REQUIRED', 'WHAT TO ENTER'],
      ...COLS.map((c) => [c.head.replace('*', ''), c.head.includes('*') ? 'Yes' : 'No', c.note]),
      [],
      ['ALLOWED CATEGORIES'], ...A_CATEGORIES.map((c) => [c]),
      [],
      ['ALLOWED PAYMENT TERMS'], ...A_PAYMENT_TERMS.map((t) => [t]),
      [],
      ['SUGGESTED TAGS (comma separated in the Tags column)'], ...A_TAG_OPTIONS.map((t) => [t]),
    ];
    const wsG = X.utils.aoa_to_sheet(guide);
    wsG['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 82 }];
    X.utils.book_append_sheet(wb, wsG, 'Instructions');

    X.writeFile(wb, `KAVO-Product-Import-Template-${stamp}.xlsx`);
    return 'xlsx';
  }

  // ── Parsing ───────────────────────────────────────────────────────────────
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function sheetToRows(file) {
    return new Promise((resolve, reject) => {
      const isCsv = /\.csv$/i.test(file.name);
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.onload = () => {
        try {
          if (isCsv || !window.XLSX) {
            const text = typeof reader.result === 'string' ? reader.result : new TextDecoder().decode(reader.result);
            resolve(parseCSV(text.replace(/^\uFEFF/, '')));
          } else {
            const wb = window.XLSX.read(new Uint8Array(reader.result), { type: 'array' });
            const name = wb.SheetNames.find((n) => norm(n) === 'products') || wb.SheetNames[0];
            resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, raw: true, defval: '' }));
          }
        } catch (e) { reject(new Error('That file could not be read as a spreadsheet.')); }
      };
      if (isCsv && !window.XLSX) reader.readAsText(file); else reader.readAsArrayBuffer(file);
    });
  }

  function buildRecords(aoa, existing) {
    if (!aoa || aoa.length < 2) throw new Error('The sheet has no data rows under the header.');
    let hi = 0;
    for (let i = 0; i < Math.min(aoa.length, 8); i++) { if ((aoa[i] || []).some((c) => HEAD_MAP[norm(c)] === 'name')) { hi = i; break; } }
    const header = (aoa[hi] || []).map((c) => HEAD_MAP[norm(c)] || null);
    if (!header.includes('name')) throw new Error('No "Product Name" column found — please use the downloaded template.');

    const bySku = {}; existing.forEach((p) => { if (p.sku) bySku[String(p.sku).trim().toLowerCase()] = p; });
    const seen = {};
    const out = [];
    for (let r = hi + 1; r < aoa.length; r++) {
      const raw = aoa[r] || {};
      const o = {};
      header.forEach((k, c) => { if (k) o[k] = raw[c]; });
      if (!Object.values(o).some((v) => txt(v) !== '')) continue;

      const errs = [], warns = [];
      const name = txt(o.name);
      if (!name) errs.push('Product name is missing');
      const reg = num(o.regularPrice);
      if (reg == null || reg <= 0) errs.push('Regular price must be a number above 0');
      const stock = num(o.stock);
      if (stock == null || stock < 0) errs.push('Stock quantity must be 0 or more');
      const sale = num(o.salePrice);
      if (sale != null && reg != null && sale > reg) warns.push('Sale price is above the regular price');
      let cat = matchCategory(o.category);
      if (!cat) { cat = A_CATEGORIES[0]; if (txt(o.category)) warns.push(`Unknown category “${txt(o.category)}” → ${cat}`); else warns.push(`Category blank → ${cat}`); }
      let terms = matchTerms(o.payment_terms);
      if (!terms) { warns.push(`Unknown payment terms “${txt(o.payment_terms)}” → Advance Payment`); terms = 'Advance Payment'; }

      const skuIn = txt(o.sku);
      const skuKey = skuIn.toLowerCase();
      if (skuKey && seen[skuKey]) errs.push('Duplicate SKU inside this file');
      if (skuKey) seen[skuKey] = true;
      const match = skuKey ? bySku[skuKey] : null;

      const imported = yes(o.imported);
      const specs = txt(o.specs).replace(/\s*\|\s*/g, '\n');
      const tags = txt(o.tags).split(/[,;]/).map((t) => t.trim()).filter(Boolean);

      const prod = {
        id: match ? match.id : A_uid('p'),
        name, sku: skuIn || (txt(o.brand).slice(0, 3).toUpperCase() || 'PPS') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
        brand: txt(o.brand), category: cat,
        regularPrice: reg || 0, salePrice: sale == null ? null : sale,
        stock: stock == null ? 0 : Math.round(stock),
        description: txt(o.description), specs,
        image: txt(o.image), tags,
        home_bested: yes(o.home_bested), imported,
        import_fee: imported ? (num(o.import_fee) || 0) : 0,
        payment_terms: terms,
        deposit_pct: terms === 'Deposit Payment' ? Math.min(100, Math.max(1, num(o.deposit_pct) || 50)) : null,
        featured: yes(o.featured),
        icon: (match && match.icon) || A_CAT_ICON[cat] || 'box',
        rating: (match && match.rating) || 4.5, reviews: (match && match.reviews) || 0,
      };
      out.push({ line: r + 1, prod, errs, warns, mode: match ? 'update' : 'new' });
    }
    if (!out.length) throw new Error('No product rows found — the sheet only contains a header.');
    return out;
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function BulkImportModal({ onClose }) {
    const [rows, setRows] = React.useState(null);
    const [fileName, setFileName] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [drag, setDrag] = React.useState(false);
    const inputRef = React.useRef(null);

    const handleFile = (file) => {
      if (!file) return;
      setBusy(true); setError(''); setFileName(file.name);
      sheetToRows(file)
        .then((aoa) => { setRows(buildRecords(aoa, DataStore.get().products)); })
        .catch((e) => { setRows(null); setError(e.message || 'That file could not be read.'); })
        .then(() => setBusy(false));
    };

    const ok = rows ? rows.filter((r) => !r.errs.length) : [];
    const bad = rows ? rows.filter((r) => r.errs.length) : [];
    const news = ok.filter((r) => r.mode === 'new').length;
    const upd = ok.length - news;

    const commit = () => {
      if (!ok.length) return;
      ok.forEach((r) => DataStore.saveProduct(r.prod));
      onClose();
      ToastStore.push(`${news} added${upd ? ` · ${upd} updated` : ''}${bad.length ? ` · ${bad.length} skipped` : ''} — live on the storefront.`, { title: 'Import complete', icon: 'check', tone: 'ok' });
    };

    const download = () => {
      const kind = buildTemplate();
      ToastStore.push(kind === 'xlsx' ? 'KAVO-Product-Import-Template.xlsx downloaded — fill in the Products sheet.' : 'CSV template downloaded — Excel opens it directly.', { title: 'Template ready', icon: 'download', tone: 'ok' });
    };

    const box = { border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, background: '#fff' };

    return (
      <Modal title="Bulk Import Products" sub={rows ? `${fileName} · ${rows.length} rows read` : 'Add or update many catalogue items from one spreadsheet'} width={880} onClose={onClose}
        footer={<React.Fragment>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {rows && <Button variant="ghost" icon="doc" onClick={() => { setRows(null); setFileName(''); setError(''); }}>Choose another file</Button>}
          <Button variant="primary" icon="check" onClick={commit} style={!ok.length ? { opacity: .45, pointerEvents: 'none' } : null}>
            {ok.length ? `Import ${ok.length} product${ok.length > 1 ? 's' : ''}` : 'Import products'}
          </Button>
        </React.Fragment>}>

        {!rows && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ ...box, display: 'flex', gap: 14, alignItems: 'flex-start', background: T.blueWash, borderColor: T.blue }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="download" size={18} color={T.blue} stroke={2.2} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Step 1 · Download the template</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: T.sub, lineHeight: 1.55, marginTop: 3 }}>An Excel workbook with every product field, two example rows and an Instructions sheet listing the allowed categories, payment terms and tags.</div>
              </div>
              <Button size="sm" icon="download" onClick={download}>Download template</Button>
            </div>

            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginBottom: 8 }}>Step 2 · Upload the completed file</div>
              <label
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, border: `1.5px dashed ${drag ? T.blue : T.line}`, background: drag ? T.blueWash : T.surface, borderRadius: 14, padding: '30px 20px', cursor: 'pointer', textAlign: 'center' }}>
                <Icon name="doc" size={22} color={T.blue} stroke={2.2} />
                <div style={{ fontSize: 13.5, fontWeight: 800, color: T.ink }}>{busy ? 'Reading file…' : 'Drop your .xlsx, .xls or .csv here'}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.sub }}>or click to browse — nothing is saved until you review the preview</div>
                <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { handleFile(e.target.files && e.target.files[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              </label>
              {error && <div style={{ marginTop: 10, background: T.redWash, color: T.red, border: `1px solid ${T.red}`, borderRadius: 11, padding: '10px 13px', fontSize: 12.5, fontWeight: 700 }}>{error}</div>}
            </div>

            <div style={box}>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 8 }}>What the template covers</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px 14px' }}>
                {COLS.map((c) => <div key={c.key} style={{ fontSize: 12, fontWeight: 700, color: c.head.includes('*') ? T.ink : T.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.head}</div>)}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: T.faint, marginTop: 10 }}>Rows whose SKU already exists update that product; everything else is added as new.</div>
            </div>
          </div>
        )}

        {rows && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[{ n: news, l: 'New products', c: T.green, b: T.greenWash }, { n: upd, l: 'Updates by SKU', c: T.blueDk, b: T.blueWash }, { n: bad.length, l: 'Rows with errors', c: bad.length ? T.red : T.sub, b: bad.length ? T.redWash : T.surface }].map((s) => (
                <div key={s.l} style={{ border: `1px solid ${T.line}`, borderRadius: 13, padding: '12px 14px', background: s.b }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.c, fontVariantNumeric: 'tabular-nums' }}>{s.n}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.sub }}>{s.l}</div>
                </div>
              ))}
            </div>
            {bad.length > 0 && <div style={{ background: T.redWash, border: `1px solid ${T.red}`, borderRadius: 11, padding: '10px 13px', fontSize: 12.5, fontWeight: 700, color: T.red }}>Rows with errors are skipped. Fix them in the spreadsheet and upload again.</div>}

            <div style={{ maxHeight: 340, overflow: 'auto', border: `1px solid ${T.line}`, borderRadius: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Row', 'Product', 'SKU', 'Category', 'Price', 'Stock', 'Status'].map((h, i) => (
                    <th key={h} style={{ position: 'sticky', top: 0, background: T.surface, textAlign: i > 3 && i < 6 ? 'right' : 'left', fontSize: 11, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: .5, padding: '10px 12px', borderBottom: `1px solid ${T.line}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const bad0 = r.errs.length > 0;
                    return (
                      <tr key={r.line} style={{ background: bad0 ? T.redWash : i % 2 ? '#FBFCFE' : '#fff', borderBottom: `1px solid ${T.lineSoft}` }}>
                        <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: T.faint, fontVariantNumeric: 'tabular-nums' }}>{r.line}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 800, color: T.ink, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.prod.name || <span style={{ color: T.red }}>— missing —</span>}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: T.sub, whiteSpace: 'nowrap' }}>{r.prod.sku}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: T.sub, whiteSpace: 'nowrap' }}>{r.prod.category}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 700, color: T.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.prod.regularPrice ? A_money(r.prod.regularPrice) : '—'}</td>
                        <td style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 700, color: T.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.prod.stock}</td>
                        <td style={{ padding: '9px 12px', fontSize: 11.5, fontWeight: 700 }}>
                          {bad0
                            ? <span style={{ color: T.red }}>{r.errs.join(' · ')}</span>
                            : <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ color: r.mode === 'update' ? T.blueDk : T.green, fontWeight: 800 }}>{r.mode === 'update' ? 'Will update' : 'Will add'}</span>
                                {r.warns.length > 0 && <span style={{ color: T.amberInk }}>{r.warns.join(' · ')}</span>}
                              </span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    );
  }

  Object.assign(window, { AdminBulkImportModal: BulkImportModal });
})();
