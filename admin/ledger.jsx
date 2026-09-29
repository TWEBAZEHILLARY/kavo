// ledger.jsx — Accounts receivable. Every delivered order and every delivered
// delivery note becomes an invoice that sits in "Pending payments" until an
// admin approves payment (part or full). Each approved payment is saved as a
// receipt in pps_receipts (linked by sourceKey), so Reports, Receipts and the
// balance always come from the same records.
(function () {
  const { Icon } = window;
  const T = window.ADMIN_T, F = window.ADMIN_F;

  const PAY_METHODS = ['Cash', 'Bank Transfer', 'Mobile Money', 'EFT', 'Cheque', 'Card'];
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const dayDiff = (iso) => { const t = new Date(iso).getTime(); return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86400000)); };
  const fmt = (n, cur) => (!cur || cur === 'UGX' ? window.A_money(n) : window.Q_fmtMoney(n, cur));
  const isoDate = (v) => String(v || '').slice(0, 10);

  const STATUS_TONE = {
    'Pending payment': { c: T.amberInk || '#9A6700', b: '#FFF3DC' },
    'Partially paid': { c: T.blueDk || T.blue, b: T.blueWash },
    Paid: { c: T.green, b: T.greenWash },
    'Amount needed': { c: T.red, b: T.redWash },
  };
  function PayPill({ status }) {
    const t = STATUS_TONE[status] || { c: T.sub, b: T.surface };
    return <span style={{ fontSize: 11.5, fontWeight: 800, color: t.c, background: t.b, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{status}</span>;
  }

  // ── Build invoices + payments from live data ────────────────────────────
  function buildLedger(d, receipts, quotes, deliveries) {
    const clientOf = (id, name) => d.clients.find((c) => c.id === id) || d.clients.find((c) => (c.companyName || c.name || '').toLowerCase() === String(name || '').toLowerCase()) || {};
    const payments = [];
    const invoices = [];

    d.orders.filter((o) => o.status === 'Delivered').forEach((o) => {
      const key = 'order:' + o.id;
      const c = clientOf(o.clientId, o.clientName);
      const total = Number(o.total) || 0;
      const mine = receipts.filter((r) => r.sourceKey === key || (!r.sourceKey && r.orderId && r.orderId === o.id));
      let prepaid = 0;
      if (o.paymentStatus === 'Verified') {
        prepaid = o.payOnDelivery === true ? total : Math.min(total, Number(o.amountDueNow) || total);
        payments.push({ id: 'pv_' + o.id, date: isoDate(o.paymentVerifiedAt || o.date), number: 'Online', clientName: o.clientName, ref: o.id, key, method: o.payment || 'Online', reference: 'Verified checkout payment', amount: prepaid, type: prepaid >= total ? 'Full' : 'Part', currency: 'UGX' });
      }
      invoices.push({ key, type: 'order', ref: o.id, label: 'Order ' + o.id, clientId: o.clientId || c.id || '', clientName: o.clientName || c.name || '—',
        clientPhone: c.phone || o.phone || '', clientEmail: c.email || o.email || '', clientAddress: c.address || o.address || '',
        date: isoDate(o.deliveredAt || (o.timeline && o.timeline.Delivered) || o.date), total, currency: 'UGX', prepaid, receipts: mine,
        lines: (o.items || []).map((it) => ({ name: it.name || it.sku || 'Item', qty: Number(it.qty) || 0, price: Number(it.price) || 0 })) });
    });

    deliveries.filter((x) => x.status === 'Delivered').forEach((x) => {
      const key = 'dn:' + x.id;
      const q = x.fromQuote ? quotes.find((qq) => qq.number === x.fromQuote) : null;
      const mine = receipts.filter((r) => r.sourceKey === key);
      const set = mine.map((r) => Number(r.invoiceTotal) || 0).filter(Boolean);
      const c = clientOf(x.client && x.client.clientId, x.client && x.client.company);
      let total = 0, lines = [];
      if (q) {
        const t = window.Q_totalsOf(q);
        total = t.grand;
        lines = (q.items || []).filter((it) => String(it.description || '').trim()).map((it) => ({ name: [it.code, it.description].filter(Boolean).join(' — '), qty: Number(it.qty) || 0, price: Number(it.unitPrice) || 0 }));
        const gross = lines.reduce((s, l) => s + l.qty * l.price, 0);
        if (total - gross > 0.5) lines.push({ name: 'VAT 18%', qty: 1, price: Math.round(total - gross) });
      } else if (Number(x.invoiceTotal) > 0 || set.length) {
        total = Number(x.invoiceTotal) || set[set.length - 1];
      }
      if (!lines.length) lines = [{ name: 'Goods supplied per delivery note ' + x.number, qty: 1, price: total }];
      invoices.push({ key, type: 'dn', ref: x.number, id: x.id, label: 'Delivery ' + x.number, quote: q ? q.number : '', clientId: c.id || '',
        clientName: (x.client && x.client.company) || '—', clientPhone: (x.client && x.client.phone) || c.phone || '', clientEmail: (x.client && x.client.email) || c.email || '',
        clientAddress: (x.client && x.client.address) || c.address || '', date: isoDate(x.deliveredAt || x.date), total, currency: (q && q.currency) || 'UGX', prepaid: 0, receipts: mine, lines });
    });

    invoices.forEach((inv) => {
      const received = inv.receipts.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0);
      inv.paid = inv.prepaid + received;
      inv.balance = Math.max(0, inv.total - inv.paid);
      inv.status = inv.total <= 0 ? 'Amount needed' : inv.balance < 1 ? 'Paid' : inv.paid > 0 ? 'Partially paid' : 'Pending payment';
      inv.age = dayDiff(inv.date);
      inv.lastPaid = inv.receipts.reduce((m, r) => (r.date > m ? r.date : m), '');
    });

    const byKey = {}; invoices.forEach((i) => { byKey[i.key] = i; });
    receipts.forEach((r) => {
      const inv = r.sourceKey ? byKey[r.sourceKey] : (r.orderId ? byKey['order:' + r.orderId] : null);
      payments.push({ id: r.id, date: isoDate(r.date), number: r.number, clientName: r.clientName, ref: inv ? inv.ref : (r.orderId || '—'), key: inv ? inv.key : '',
        method: r.method || '—', reference: r.reference || '', amount: Number(r.amountPaid) || 0, type: r.paymentType || ((Number(r.balance) || 0) > 0 ? 'Part' : 'Full'), receipt: r, currency: (inv && inv.currency) || 'UGX' });
    });
    invoices.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    payments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { invoices, payments };
  }

  function useLedger() {
    const d = window.useData();
    const receipts = window.useReceipts();
    const quotes = window.useQuotes ? window.useQuotes() : [];
    const deliveries = window.useDeliveries ? window.useDeliveries() : [];
    return React.useMemo(() => buildLedger(d, receipts, quotes, deliveries), [d, receipts, quotes, deliveries]);
  }

  // ── Approve payment → receipt ───────────────────────────────────────────
  function RecordPaymentModal({ inv, onClose }) {
    const { Modal, Button, Field, Input, Select, Textarea, ToastStore, ReceiptStore, A_uid, A_fmtDate, useAuth, IconBtn } = window;
    const auth = useAuth();
    const isAdmin = !!auth && auth.role === 'admin';
    const needTotal = inv.total <= 0;
    const [f, setF] = React.useState({ date: todayISO(), amount: inv.balance > 0 ? String(Math.round(inv.balance)) : '', method: PAY_METHODS[0], reference: '', notes: '', invoiceTotal: '' });
    const [err, setErr] = React.useState('');
    const set = (k) => (e) => setF((s) => ({ ...s, [k]: e && e.target ? e.target.value : e }));
    const total = needTotal ? Number(f.invoiceTotal) || 0 : inv.total;
    const balance = Math.max(0, total - inv.paid);
    const amt = Number(f.amount) || 0;
    const after = Math.max(0, balance - amt);
    const open = inv.status !== 'Paid' && isAdmin;

    const approve = (print) => {
      if (needTotal && total <= 0) return setErr('Enter the invoice amount for this delivery.');
      if (amt <= 0) return setErr('Enter the amount received.');
      if (amt > balance + 0.5) return setErr(`Amount is more than the balance of ${fmt(balance, inv.currency)}.`);
      if (f.method !== 'Cash' && !f.reference.trim()) return setErr(`Enter the ${f.method} reference / transaction ID.`);
      setErr('');
      const lines = needTotal ? [{ name: inv.lines[0].name, qty: 1, price: total }] : inv.lines;
      const gross = lines.reduce((s, l) => s + l.qty * l.price, 0);
      const diff = Math.round(total - gross);
      const r = {
        id: A_uid('r_'), number: ReceiptStore.nextNumber(), date: f.date,
        clientId: inv.clientId || '', clientName: inv.clientName, clientPhone: inv.clientPhone, clientEmail: inv.clientEmail, clientAddress: inv.clientAddress,
        method: f.method, reference: f.reference.trim(), orderId: inv.ref, notes: f.notes.trim(),
        discount: diff < 0 ? -diff : 0, discountMode: 'amount', discountAmount: diff < 0 ? -diff : 0, deliveryFee: diff > 0 ? diff : 0,
        items: lines, total, amountPaid: amt, previouslyPaid: inv.paid, balance: after,
        invoiceTotal: total, sourceKey: inv.key, sourceType: inv.type, quoteRef: inv.quote || '',
        paymentType: after < 1 ? 'Full' : 'Part', approvedBy: auth.name || '', issuedBy: auth.signature || auth.name || '',
        savedAt: new Date().toISOString(),
      };
      ReceiptStore.save(r);
      ToastStore.push(`${r.number} issued · ${fmt(amt, inv.currency)} via ${f.method}. ${after < 1 ? inv.ref + ' is now fully paid.' : 'Balance ' + fmt(after, inv.currency) + '.'}`, { title: after < 1 ? 'Payment complete' : 'Part payment recorded', icon: 'check', tone: 'ok' });
      if (print && window.KG_printReceipt) window.KG_printReceipt(r);
      onClose();
    };

    const Sum = ({ k, v, strong, color }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderTop: `1px solid ${T.lineSoft}`, fontSize: 13.5 }}>
        <span style={{ fontWeight: 700, color: T.sub }}>{k}</span><strong style={{ color: color || T.ink, fontSize: strong ? 15 : 13.5, fontVariantNumeric: 'tabular-nums' }}>{v}</strong></div>
    );

    return (
      <Modal title={open ? 'Approve payment' : 'Payment history'} sub={`${inv.label} · ${inv.clientName}`} width={760} onClose={onClose}
        footer={<React.Fragment>
          <Button variant="ghost" onClick={onClose}>{open ? 'Cancel' : 'Close'}</Button>
          {open && <Button variant="dark" icon="check" onClick={() => approve(false)}>Approve payment</Button>}
          {open && <Button variant="primary" icon="download" onClick={() => approve(true)}>Approve &amp; print receipt</Button>}
        </React.Fragment>}>
        {err && <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.redWash, color: T.red, borderRadius: 11, padding: '10px 13px', fontSize: 13, fontWeight: 700, marginBottom: 14 }}><Icon name="minus" size={15} color={T.red} stroke={2.6} />{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: open ? 'minmax(0,1fr) 280px' : '1fr', gap: 18, alignItems: 'start' }} className="kg-led-grid">
          {open && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {needTotal && <Field label="Invoice amount (UGX)" hint="not linked to a quotation" full><Input type="number" min="0" value={f.invoiceTotal} onChange={(e) => setF((s) => ({ ...s, invoiceTotal: e.target.value, amount: s.amount || e.target.value }))} placeholder="Total value delivered" /></Field>}
            <Field label="Amount received"><Input type="number" min="0" value={f.amount} onChange={set('amount')} /></Field>
            <Field label="Payment date"><Input type="date" value={f.date} onChange={set('date')} /></Field>
            <Field label="Payment method" full>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PAY_METHODS.map((m) => {
                  const on = f.method === m;
                  return <button key={m} onClick={() => setF((s) => ({ ...s, method: m }))} style={{ padding: '9px 14px', borderRadius: 999, border: `1.5px solid ${on ? T.blue : T.line}`, background: on ? T.blue : '#fff', color: on ? '#fff' : T.ink, fontFamily: F, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{m}</button>;
                })}
              </div>
            </Field>
            <Field label={f.method === 'Cash' ? 'Reference' : f.method + ' reference'} hint={f.method === 'Cash' ? 'optional' : 'required'} full><Input value={f.reference} onChange={set('reference')} placeholder={f.method === 'Mobile Money' ? 'Transaction ID' : f.method === 'Cheque' ? 'Cheque no. & bank' : f.method === 'Cash' ? 'Cash book ref.' : 'Bank transaction ref.'} /></Field>
            <Field label="Notes" hint="optional" full><Input value={f.notes} onChange={set('notes')} placeholder="e.g. 1st instalment" /></Field>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              <Button size="sm" variant="ghost" onClick={() => setF((s) => ({ ...s, amount: String(Math.round(balance)) }))}>Full balance</Button>
              <Button size="sm" variant="ghost" onClick={() => setF((s) => ({ ...s, amount: String(Math.round(balance / 2)) }))}>Half</Button>
            </div>
          </div>}
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '11px 14px', background: T.surface, fontSize: 12, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>Account<PayPill status={inv.status} /></div>
            <Sum k="Invoice total" v={total > 0 ? fmt(total, inv.currency) : '—'} />
            <Sum k="Paid so far" v={fmt(inv.paid, inv.currency)} color={T.green} />
            <Sum k="Balance" v={fmt(balance, inv.currency)} color={balance > 0 ? T.red : T.green} strong />
            {open && amt > 0 && <React.Fragment>
              <Sum k="This payment" v={fmt(amt, inv.currency)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: T.navy, color: '#fff', fontSize: 13.5 }}>
                <span style={{ fontWeight: 800 }}>{after < 1 ? 'Full payment' : 'Part payment · balance after'}</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{after < 1 ? 'Paid' : fmt(after, inv.currency)}</strong></div>
            </React.Fragment>}
          </div>
        </div>
        {!isAdmin && inv.status !== 'Paid' && <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: T.sub }}>Only an admin can approve payments.</div>}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 8 }}>Payments received</div>
          {inv.receipts.length === 0 && !inv.prepaid
            ? <div style={{ border: `1px dashed ${T.line}`, borderRadius: 12, padding: '16px', textAlign: 'center', color: T.sub, fontSize: 13, fontWeight: 700, background: T.surface }}>No payments yet.</div>
            : <div style={{ border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
              {inv.prepaid > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', fontSize: 13 }}>
                <span style={{ fontWeight: 800, minWidth: 90 }}>Online</span><span style={{ flex: 1, color: T.sub, fontWeight: 600 }}>Verified checkout payment</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.prepaid, inv.currency)}</strong><span style={{ width: 34 }}></span></div>}
              {inv.receipts.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', fontSize: 13, borderTop: (i || inv.prepaid) ? `1px solid ${T.lineSoft}` : 'none' }}>
                  <span style={{ fontWeight: 800, minWidth: 90 }}>{r.number}</span>
                  <span style={{ flex: 1, minWidth: 0, color: T.sub, fontWeight: 600 }}>{A_fmtDate(r.date)} · {r.method}{r.reference ? ' · ' + r.reference : ''}</span>
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.amountPaid, inv.currency)}</strong>
                  <IconBtn icon="download" tone="blue" title="Print receipt" onClick={() => window.KG_printReceipt && window.KG_printReceipt(r)} />
                </div>
              ))}
            </div>}
        </div>
      </Modal>
    );
  }

  if (!document.getElementById('kg-led-css')) {
    const s = document.createElement('style'); s.id = 'kg-led-css';
    s.textContent = '@media (max-width: 760px){ .kg-led-grid{grid-template-columns:1fr!important} }';
    document.head.appendChild(s);
  }

  Object.assign(window, { KG_useLedger: useLedger, KG_RecordPaymentModal: RecordPaymentModal, KG_PayPill: PayPill, KG_PAY_METHODS: PAY_METHODS, KG_fmtLedger: fmt });
})();
