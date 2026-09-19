// receipts.jsx — admin Payment Receipts: raise a branded receipt for any
// payment (counter, bank transfer, mobile money) against a saved client or a
// new walk-in. Stored in pps_receipts; printed to PDF via a hidden iframe so
// the admin console's own styles never interfere with the printed sheet.
(function () {
  const { Icon } = window;
  const T = window.ADMIN_T, F = window.ADMIN_F;
  const { Card, PageHead, Button, IconBtn, Search, Select, Table, Td, Row, Empty,
    Field, Input, Textarea, Modal, ConfirmStore, ToastStore, useData, DataStore,
    ReceiptStore, useReceipts, A_money, A_fmtDate, A_uid, A_PAYMENTS } = window;

  const COMPANY = {
    name: 'Kavo Grid (U) Ltd.',
    address: 'Plot 24, Ntinda Industrial Area, Kampala, Uganda',
    phone: '+256764250125',
    email: 'kavogrid@gmail.com',
    web: 'kavogrid.org',
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => 'USh ' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const today = () => new Date().toISOString().slice(0, 10);
  const lineTotal = (l) => (Number(l.qty) || 0) * (Number(l.price) || 0);
  const sumLines = (ls) => ls.reduce((s, l) => s + lineTotal(l), 0);
  const totalOf = (r) => sumLines(r.items || []) - (Number(r.discount) || 0) + (Number(r.deliveryFee) || 0);

  // ── Printable receipt sheet ──────────────────────────────────────────────
  function receiptHTML(r) {
    const rows = (r.items || []).map((l, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(l.name)}</td>
      <td class="r">${(Number(l.qty) || 0).toLocaleString('en-US')}</td>
      <td class="r">${money(l.price)}</td><td class="r">${money(lineTotal(l))}</td></tr>`).join('');
    const total = totalOf(r);
    const paid = Number(r.amountPaid) || 0;
    const balance = Math.max(0, total - paid);
    const extra = [
      (Number(r.discount) || 0) > 0 ? ['Discount', '\u2212 ' + money(r.discount)] : null,
      (Number(r.deliveryFee) || 0) > 0 ? ['Delivery fee', money(r.deliveryFee)] : null,
    ].filter(Boolean).map(([k, v]) => `<div class="trow"><span>${k}</span><strong>${v}</strong></div>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.number)}</title><style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{margin:0;font-family:'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,sans-serif;color:#0B1A33;font-size:12px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #0B1A33;padding-bottom:14px}
.logo{height:52px}
.co{text-align:right;font-size:10.5px;color:#5A6B85;line-height:1.7}
.bar{display:flex;justify-content:space-between;align-items:baseline;margin:18px 0 16px}
.ttl{font-size:26px;font-weight:800;letter-spacing:2px}
.num{font-size:13px;font-weight:800;color:#1457E6}
.meta{display:flex;justify-content:space-between;gap:28px;margin-bottom:18px}
.lbl{font-size:9.5px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:#8A98B0;margin-bottom:5px}
.cl{font-size:14px;font-weight:800;margin-bottom:3px}
.to div{line-height:1.65;color:#5A6B85}
.facts{min-width:230px}
.fact{display:flex;justify-content:space-between;gap:20px;padding:4px 0;border-bottom:1px solid #EDF1F7;font-size:11px}
.fact span{color:#5A6B85;font-weight:700}
.fact strong{font-weight:800}
table.items{width:100%;border-collapse:collapse;margin-bottom:16px}
table.items th{background:#F4F7FC;border-bottom:1.5px solid #E4E9F2;padding:9px 10px;font-size:9.5px;letter-spacing:.7px;text-transform:uppercase;color:#5A6B85;text-align:left}
table.items td{padding:9px 10px;border-bottom:1px solid #EDF1F7;font-size:11.5px}
.c{text-align:center}.r{text-align:right}
.bottom{display:flex;gap:26px;align-items:flex-start}
.note{flex:1;font-size:10.5px;color:#5A6B85;line-height:1.7}
.tot{width:280px;flex:none}
.trow{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #EDF1F7;font-size:11.5px}
.trow span{color:#5A6B85;font-weight:700}
.grand{border-top:2px solid #0B1A33;border-bottom:none;padding-top:10px;margin-top:4px;font-size:15px}
.grand span,.grand strong{color:#0B1A33;font-weight:800}
.paid{color:#119C5B}.bal{color:#E5484D}
.stamp{margin-top:16px;display:inline-block;border:2px solid #119C5B;color:#119C5B;font-weight:800;letter-spacing:2px;padding:6px 16px;border-radius:6px;font-size:13px;transform:rotate(-3deg)}
.sign{margin-top:30px;display:flex;justify-content:space-between;gap:40px}
.sigbox{flex:1;border-top:1px solid #8A98B0;padding-top:6px;font-size:10px;color:#5A6B85;font-weight:700}
.foot{margin-top:24px;padding-top:10px;border-top:1px solid #E4E9F2;text-align:center;font-size:9.5px;color:#8A98B0}
</style></head><body>
<div class="top"><img class="logo" src="${window.COMPANY_LOGO}" alt="${esc(COMPANY.name)}" />
<div class="co"><div>${esc(COMPANY.address)}</div><div>${esc(COMPANY.phone)}</div><div>${esc(COMPANY.email)} &middot; ${esc(COMPANY.web)}</div></div></div>
<div class="bar"><div class="ttl">PAYMENT RECEIPT</div><div class="num">No. ${esc(r.number)}</div></div>
<div class="meta"><div class="to"><div class="lbl">Received From</div><div class="cl">${esc(r.clientName)}</div>
${r.clientPhone ? `<div>${esc(r.clientPhone)}</div>` : ''}${r.clientEmail ? `<div>${esc(r.clientEmail)}</div>` : ''}${r.clientAddress ? `<div>${esc(r.clientAddress)}</div>` : ''}</div>
<div class="facts">
<div class="fact"><span>Date</span><strong>${esc(A_fmtDate(r.date))}</strong></div>
<div class="fact"><span>Payment method</span><strong>${esc(r.method || '\u2014')}</strong></div>
${r.reference ? `<div class="fact"><span>Reference</span><strong>${esc(r.reference)}</strong></div>` : ''}
${r.orderId ? `<div class="fact"><span>Order</span><strong>${esc(r.orderId)}</strong></div>` : ''}
<div class="fact"><span>Issued by</span><strong>${esc(r.issuedBy || 'KAVO')}</strong></div></div></div>
<table class="items"><thead><tr><th class="c">#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="c">No items</td></tr>'}</tbody></table>
<div class="bottom"><div class="note"><div class="lbl">Notes</div>
${r.notes ? `<p>${esc(r.notes).replace(/\n/g, '<br>')}</p>` : ''}
<p>This receipt acknowledges the payment recorded above${balance > 0 ? `, with an outstanding balance of <strong>${money(balance)}</strong>` : ' in full'}. Goods supplied carry the applicable manufacturer warranty, handled through ${esc(COMPANY.name)}.</p>
${balance === 0 ? '<div class="stamp">PAID IN FULL</div>' : ''}
<div class="sign"><div class="sigbox">Received by (signature &amp; date)</div><div class="sigbox">For ${esc(COMPANY.name)}</div></div></div>
<div class="tot"><div class="trow"><span>Subtotal</span><strong>${money(sumLines(r.items || []))}</strong></div>${extra}
<div class="trow grand"><span>Total</span><strong>${money(total)}</strong></div>
<div class="trow"><span>Amount paid</span><strong class="paid">${money(paid)}</strong></div>
${balance > 0 ? `<div class="trow"><span>Balance due</span><strong class="bal">${money(balance)}</strong></div>` : ''}</div></div>
<div class="foot">${esc(COMPANY.name)} &middot; ${esc(COMPANY.address)} &middot; ${esc(COMPANY.phone)} &middot; ${esc(COMPANY.email)} &middot; ${esc(COMPANY.web)}</div>
</body></html>`;
  }

  function printReceipt(r) {
    const old = document.getElementById('kg-rcpt-print');
    if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = 'kg-rcpt-print';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open(); doc.write(receiptHTML(r)); doc.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} }, 320);
  }

  // ── Editor ───────────────────────────────────────────────────────────────
  const blankLine = () => ({ key: A_uid('l_'), name: '', qty: 1, price: '' });

  function ReceiptModal({ initial, onClose }) {
    const d = useData();
    const editing = !!initial;
    const [f, setF] = React.useState(() => initial ? {
      ...initial, items: (initial.items || []).map((l) => ({ key: A_uid('l_'), ...l })),
    } : {
      id: A_uid('r_'), number: ReceiptStore.nextNumber(), date: today(),
      clientId: '', clientName: '', clientPhone: '', clientEmail: '', clientAddress: '',
      method: A_PAYMENTS[0], reference: '', orderId: '', notes: '',
      discount: '', deliveryFee: '', amountPaid: '', issuedBy: '',
      items: [blankLine()],
    });
    const [touched, setTouched] = React.useState(false);
    const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
    const setLine = (key, k, v) => setF((s) => ({ ...s, items: s.items.map((l) => (l.key === key ? { ...l, [k]: v } : l)) }));
    const addLine = () => setF((s) => ({ ...s, items: [...s.items, blankLine()] }));
    const delLine = (key) => setF((s) => ({ ...s, items: s.items.length > 1 ? s.items.filter((l) => l.key !== key) : s.items }));

    // Pick a saved client — fills name, phone, email and address from the registry.
    const pickClient = (id) => {
      if (!id) { setF((s) => ({ ...s, clientId: '' })); return; }
      const c = d.clients.find((x) => x.id === id);
      if (!c) return;
      setF((s) => ({ ...s, clientId: c.id, clientName: c.name, clientPhone: c.phone || '', clientEmail: c.email || '', clientAddress: c.address || '' }));
    };

    const subtotal = sumLines(f.items);
    const total = subtotal - (Number(f.discount) || 0) + (Number(f.deliveryFee) || 0);
    const paid = f.amountPaid === '' ? total : Number(f.amountPaid) || 0;
    const balance = Math.max(0, total - paid);
    const validName = !!String(f.clientName).trim();
    const validItems = f.items.some((l) => String(l.name).trim() && lineTotal(l) > 0);

    const clean = () => ({
      ...f,
      clientName: String(f.clientName).trim(),
      items: f.items.filter((l) => String(l.name).trim()).map((l) => ({ name: String(l.name).trim(), qty: Number(l.qty) || 0, price: Number(l.price) || 0 })),
      discount: Number(f.discount) || 0, deliveryFee: Number(f.deliveryFee) || 0,
      amountPaid: paid, total, balance,
      savedAt: new Date().toISOString(),
    });

    const commit = (then) => {
      setTouched(true);
      if (!validName || !validItems) { ToastStore.push('Add the client name and at least one line with a quantity and price.', { title: 'Incomplete receipt', icon: 'doc', tone: 'error' }); return; }
      const rec = clean();
      ReceiptStore.save(rec);
      // A walk-in typed by hand is added to the client registry so the next
      // receipt can pick them from the dropdown.
      if (!rec.clientId && rec.clientName) {
        const exists = d.clients.some((c) => c.name.toLowerCase() === rec.clientName.toLowerCase());
        if (!exists) DataStore.saveClient({ id: A_uid('c_'), name: rec.clientName, email: rec.clientEmail || '', phone: rec.clientPhone || '', address: rec.clientAddress || '', registered: today(), status: 'Active' });
      }
      ToastStore.push(`${rec.number} saved${then === 'print' ? ' — opening the print dialog.' : '.'}`, { title: editing ? 'Receipt updated' : 'Receipt issued', icon: 'check', tone: 'ok' });
      if (then === 'print') printReceipt(rec);
      onClose();
    };

    const cellIn = { width: '100%', border: `1.5px solid ${T.line}`, borderRadius: 9, padding: '9px 10px', fontSize: 13.5, fontFamily: F, color: T.ink, outline: 'none', background: '#fff', boxSizing: 'border-box' };
    const th = { padding: '8px 10px', fontSize: 11, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'left' };

    return (
      <Modal title={editing ? 'Edit receipt' : 'New payment receipt'} sub={f.number} onClose={onClose} width={860}
        footer={(
          <React.Fragment>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="ghost" icon="check" onClick={() => commit('save')}>Save</Button>
            <Button variant="primary" icon="download" onClick={() => commit('print')}>Save &amp; print PDF</Button>
          </React.Fragment>
        )}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Saved client" hint="Pick a client on record, or leave blank and type a new one below.">
            <Select value={f.clientId} onChange={pickClient}
              options={[{ value: '', label: '— New / walk-in client —' }].concat(d.clients.map((c) => ({ value: c.id, label: c.name })))} />
          </Field>
          <Field label="Client name">
            <Input value={f.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="Full name or company" style={touched && !validName ? { borderColor: T.red } : undefined} />
          </Field>
          <Field label="Phone"><Input value={f.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} placeholder="+256 …" /></Field>
          <Field label="Email"><Input value={f.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} placeholder="name@company.com" /></Field>
          <Field label="Address" full><Input value={f.clientAddress} onChange={(e) => set('clientAddress', e.target.value)} placeholder="Plot, area, town" /></Field>
          <Field label="Receipt no."><Input value={f.number} onChange={(e) => set('number', e.target.value)} /></Field>
          <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} style={cellIn} /></Field>
          <Field label="Payment method">
            <Select value={f.method} onChange={(v) => set('method', v)} options={A_PAYMENTS.map((p) => ({ value: p, label: p }))} />
          </Field>
          <Field label="Reference" hint="MoMo / bank transaction ID"><Input value={f.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Optional" /></Field>
          <Field label="Against order" hint="Optional order number"><Input value={f.orderId} onChange={(e) => set('orderId', e.target.value)} placeholder="#KG-1042" /></Field>
          <Field label="Issued by"><Input value={f.issuedBy} onChange={(e) => set('issuedBy', e.target.value)} placeholder="Staff name" /></Field>
        </div>

        <div style={{ marginTop: 20, border: `1px solid ${T.line}`, borderRadius: 13, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr style={{ background: T.surface, borderBottom: `1px solid ${T.line}` }}>
              <th style={{ ...th, width: '46%' }}>Description</th><th style={{ ...th, width: 90 }}>Qty</th>
              <th style={{ ...th, width: 140 }}>Unit price</th><th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={{ ...th, width: 44 }}></th>
            </tr></thead>
            <tbody>
              {f.items.map((l) => (
                <tr key={l.key} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                  <td style={{ padding: '8px 10px' }}><input value={l.name} onChange={(e) => setLine(l.key, 'name', e.target.value)} placeholder="Item or service supplied" style={cellIn} /></td>
                  <td style={{ padding: '8px 10px' }}><input type="number" min="0" value={l.qty} onChange={(e) => setLine(l.key, 'qty', e.target.value)} style={cellIn} /></td>
                  <td style={{ padding: '8px 10px' }}><input type="number" min="0" value={l.price} onChange={(e) => setLine(l.key, 'price', e.target.value)} placeholder="0" style={cellIn} /></td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 13.5, fontWeight: 800, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{A_money(lineTotal(l))}</td>
                  <td style={{ padding: '8px 10px' }}><IconBtn icon="minus" tone="danger" title="Remove line" onClick={() => delLine(l.key)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: 10, borderTop: `1px solid ${T.line}`, background: T.surface }}>
            <Button variant="ghost" size="sm" icon="plus" onClick={addLine}>Add line</Button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18, marginTop: 18, alignItems: 'start' }} className="adm-rcpt-grid">
          <Field label="Notes">
            <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={4} placeholder="Anything to print on the receipt — terms, warranty, thanks." />
          </Field>
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 13, padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <Field label="Discount"><Input value={f.discount} onChange={(e) => set('discount', e.target.value)} placeholder="0" /></Field>
              <Field label="Delivery fee"><Input value={f.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} placeholder="0" /></Field>
            </div>
            <Field label="Amount paid" hint="Leave blank for paid in full."><Input value={f.amountPaid} onChange={(e) => set('amountPaid', e.target.value)} placeholder={String(total)} /></Field>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
              {[['Subtotal', A_money(subtotal)], ['Total', A_money(total)], ['Paid', A_money(paid)]].map(([k, v], i) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: i === 1 ? 15 : 13, fontWeight: 800, color: i === 1 ? T.ink : T.sub }}>
                  <span>{k}</span><span style={{ color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{v}</span></div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 0', marginTop: 6, borderTop: `1px solid ${T.line}`, fontSize: 13.5, fontWeight: 800, color: balance > 0 ? T.red : T.green }}>
                <span>{balance > 0 ? 'Balance due' : 'Paid in full'}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{balance > 0 ? A_money(balance) : '✓'}</span></div>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  function Receipts() {
    const list = useReceipts();
    const [q, setQ] = React.useState('');
    const [open, setOpen] = React.useState(null); // 'new' | receipt object

    const filtered = list.filter((r) => {
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return [r.number, r.clientName, r.reference, r.orderId, r.method].some((v) => String(v || '').toLowerCase().includes(s));
    });
    const totalIssued = list.reduce((s, r) => s + totalOf(r), 0);
    const outstanding = list.reduce((s, r) => s + Math.max(0, totalOf(r) - (Number(r.amountPaid) || 0)), 0);

    const del = (r) => ConfirmStore.open({
      title: 'Delete receipt', sub: r.number + ' · ' + r.clientName, confirmLabel: 'Delete', danger: true,
      body: 'Remove this receipt from the records? Printed copies already given to the client are unaffected.',
      onConfirm: () => { ReceiptStore.remove(r.id); ToastStore.push('Receipt deleted.', { title: 'Removed', icon: 'minus', tone: 'warn' }); },
    });

    const Stat = ({ label, value, color }) => (
      <Card style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: color || T.ink, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      </Card>
    );

    return (
      <div>
        <PageHead title="Receipts" sub="Raise and print payment receipts for saved clients or walk-in customers">
          <Search value={q} onChange={setQ} placeholder="Search receipts, clients, references…" />
          <Button variant="primary" icon="plus" onClick={() => setOpen('new')}>New receipt</Button>
        </PageHead>

        <div style={{ display: 'flex', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
          <Stat label="Receipts issued" value={list.length} />
          <Stat label="Total receipted" value={A_money(totalIssued)} />
          <Stat label="Outstanding balance" value={A_money(outstanding)} color={outstanding > 0 ? T.red : T.green} />
        </div>

        {filtered.length === 0 ? (
          <Card><Empty icon="doc" title={list.length ? 'No matching receipts' : 'No receipts yet'}
            sub={list.length ? 'Try a different search term.' : 'Click “New receipt” to record a payment and print it as a PDF.'} /></Card>
        ) : (
          <Table columns={[{ label: 'Receipt' }, { label: 'Client' }, { label: 'Date' }, { label: 'Method' }, { label: 'Total', align: 'right' }, { label: 'Balance', align: 'right' }, { label: '', align: 'right' }]}>
            {filtered.map((r, i) => {
              const total = totalOf(r);
              const bal = Math.max(0, total - (Number(r.amountPaid) || 0));
              return (
                <Row key={r.id} i={i}>
                  <Td style={{ fontWeight: 800 }}>{r.number}</Td>
                  <Td>{r.clientName}</Td>
                  <Td style={{ color: T.sub, fontWeight: 600 }}>{A_fmtDate(r.date)}</Td>
                  <Td style={{ color: T.sub, fontWeight: 600 }}>{r.method}</Td>
                  <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{A_money(total)}</Td>
                  <Td align="right">
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: bal > 0 ? T.red : T.green, background: bal > 0 ? T.redWash : T.greenWash, padding: '4px 10px', borderRadius: 999 }}>
                      {bal > 0 ? A_money(bal) : 'Paid'}</span>
                  </Td>
                  <Td align="right">
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <IconBtn icon="download" tone="blue" title="Print / save PDF" onClick={() => printReceipt(r)} />
                      <IconBtn icon="doc" title="Edit" onClick={() => setOpen(r)} />
                      <IconBtn icon="minus" tone="danger" title="Delete" onClick={() => del(r)} />
                    </div>
                  </Td>
                </Row>
              );
            })}
          </Table>
        )}

        {open && <ReceiptModal initial={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
      </div>
    );
  }

  if (!document.getElementById('adm-rcpt-css')) {
    const s = document.createElement('style'); s.id = 'adm-rcpt-css';
    s.textContent = '@media (max-width: 760px){ .adm-rcpt-grid{grid-template-columns:1fr!important} }';
    document.head.appendChild(s);
  }

  window.AdminReceipts = Receipts;
})();
