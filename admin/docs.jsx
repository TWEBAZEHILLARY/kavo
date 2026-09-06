// docs.jsx — Deliveries (delivery notes) and LPO (local purchase orders)
// sections: list, builder, preview, print-to-PDF. Mirrors the Quotes section's
// patterns and reuses the shared admin UI primitives.
(function () {
  const { Icon } = window;
  const T = window.ADMIN_T, F = window.ADMIN_F;
  const { Card, PageHead, Button, IconBtn, Search, Select, Table, Td, Row, Empty,
    Field, Input, Textarea, Modal, ConfirmStore, ToastStore, useData, useAuth, A_field,
    Q_fmtMoney, Q_fmtDate, Q_todayISO, PPS_PAYMENT_TERMS, PPS_CURRENCIES,
    DeliveryStore, LPOStore, useDeliveries, useLPOs, buildDeliveryHTML, buildLPOHTML,
    printDelivery, printLPO, D_lpoTotals, D_amountInWords } = window;

  const UOMS = ['Pcs', 'Mtrs', 'Kg', 'Set', 'Box', 'Roll', 'Unit', 'Pair', 'Lot'];
  const DN_STATUSES = ['Draft', 'Dispatched', 'Delivered'];
  const LPO_STATUSES = ['Draft', 'Issued', 'Received', 'Cancelled'];
  const TONE = {
    Draft: { fg: T.sub, bg: T.surface }, Dispatched: { fg: T.blueDk, bg: T.blueWash },
    Delivered: { fg: T.green, bg: T.greenWash }, Issued: { fg: T.blueDk, bg: T.blueWash },
    Received: { fg: T.green, bg: T.greenWash }, Cancelled: { fg: T.red, bg: T.redWash },
  };
  function DStatus({ status }) {
    const c = TONE[status] || { fg: T.sub, bg: T.surface };
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: c.fg, background: c.bg, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: 999, background: c.fg }} />{status}</span>;
  }

  const cell = { ...A_field, padding: '8px 9px', fontSize: 13, borderRadius: 8 };
  const numCell = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const head = { fontSize: 10.5, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.4, padding: '10px 8px', textAlign: 'left' };
  const ErrBar = ({ err }) => err ? <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.redWash, border: '1px solid #F6C9CB', color: T.red, borderRadius: 11, padding: '10px 13px', fontSize: 13, fontWeight: 700, marginBottom: 16 }}><Icon name="minus" size={15} color={T.red} stroke={2.6} />{err}</div> : null;
  const RemoveBtn = ({ onClick, can }) => (
    <button onClick={onClick} title="Remove" style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.line}`, background: '#fff', cursor: can ? 'pointer' : 'not-allowed', opacity: can ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="minus" size={15} color={T.red} stroke={2.6} /></button>
  );

  // ═══════════════════════ DELIVERY NOTE BUILDER ════════════════════════════
  function DeliveryBuilder({ existing, onClose }) {
    const auth = useAuth();
    const d = useData();
    const blank = () => {
      const { seq, number } = DeliveryStore.nextNumber();
      return { id: 'dn_' + Math.random().toString(36).slice(2, 9), seq, number, date: Q_todayISO(),
        client: { company: '', tin: '', phone: '', address: '', email: '' }, customerRef: '',
        preparedBy: auth.signature || auth.name, notes: '',
        items: [{ code: '', itemNo: '', description: '', qty: 1, uom: 'Pcs' }],
        status: 'Draft', createdAt: new Date().toISOString() };
    };
    const [n, setN] = React.useState(() => existing ? JSON.parse(JSON.stringify(existing)) : blank());
    const [err, setErr] = React.useState('');
    const clientLabel = (c) => (c && (c.companyName || c.name)) || '';
    const onCompany = (e) => {
      const v = e.target.value;
      setN((s) => {
        const m = d.clients.find((c) => clientLabel(c).trim().toLowerCase() === v.trim().toLowerCase());
        const client = { ...s.client, company: v };
        if (m) Object.assign(client, { tin: m.tin || '', address: m.address || '', phone: m.phone || '', email: m.email || '' });
        return { ...s, client };
      });
    };
    const setClient = (k) => (e) => setN((s) => ({ ...s, client: { ...s.client, [k]: e.target.value } }));
    const setItem = (i, k, v) => setN((s) => { const items = s.items.slice(); items[i] = { ...items[i], [k]: v }; return { ...s, items }; });
    const addItem = () => setN((s) => ({ ...s, items: [...s.items, { code: '', itemNo: '', description: '', qty: 1, uom: 'Pcs' }] }));
    const removeItem = (i) => setN((s) => ({ ...s, items: s.items.length > 1 ? s.items.filter((_, x) => x !== i) : s.items }));

    const validate = () => {
      if (!n.client.company.trim()) { setErr('Enter the client / company the goods are delivered to.'); return false; }
      if (!n.items.some((it) => it.description.trim())) { setErr('Add at least one line item with a description.'); return false; }
      setErr(''); return true;
    };
    const persist = (status) => {
      const clean = { ...n, status: status || n.status, client: { ...n.client, company: n.client.company.trim() }, items: n.items.filter((it) => it.description.trim() || Number(it.qty)) };
      DeliveryStore.save(clean); return clean;
    };
    const save = () => { if (!validate()) return; persist(); onClose(); ToastStore.push(`${n.number} saved.`, { title: 'Delivery note saved', icon: 'check', tone: 'ok' }); };
    const pdf = () => { if (!validate()) return; printDelivery(persist()); ToastStore.push('Original + copy queued — choose “Save as PDF”.', { title: 'PDF ready', icon: 'download', tone: 'info' }); };

    return (
      <Modal title={existing ? `Edit ${n.number}` : 'Create Delivery Note'} sub={existing ? n.client.company : n.number + ' · draft'} width={1100} onClose={onClose}
        footer={<React.Fragment>
          <div style={{ marginRight: 'auto', fontSize: 12.5, fontWeight: 700, color: T.sub }}>{n.items.length} line{n.items.length === 1 ? '' : 's'}</div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="ghost" icon="download" onClick={pdf}>Download PDF</Button>
          <Button variant="primary" icon="check" onClick={save}>Save</Button>
        </React.Fragment>}>
        <ErrBar err={err} />
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18 }}>
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>Deliver To · Client</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Company name" hint="type to auto-fill" full><Input value={n.client.company} onChange={onCompany} placeholder="Start typing a client company…" list="pps-dn-clients" autoComplete="off" /></Field>
              <Field label="TIN" hint="optional"><Input value={n.client.tin} onChange={setClient('tin')} /></Field>
              <Field label="Phone" hint="optional"><Input value={n.client.phone} onChange={setClient('phone')} /></Field>
              <Field label="Address" hint="optional" full><Input value={n.client.address} onChange={setClient('address')} /></Field>
            </div>
            <datalist id="pps-dn-clients">{d.clients.map((c) => <option key={c.id} value={clientLabel(c)} />)}</datalist>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, display: 'grid', gap: 12, alignContent: 'start' }}>
            <Field label="Date"><Input type="date" value={n.date} onChange={(e) => setN((s) => ({ ...s, date: e.target.value }))} /></Field>
            <Field label="Customer reference" hint="their PO no."><Input value={n.customerRef} onChange={(e) => setN((s) => ({ ...s, customerRef: e.target.value }))} placeholder="PO.No: …" /></Field>
            <Field label="Prepared by"><Input value={n.preparedBy} onChange={(e) => setN((s) => ({ ...s, preparedBy: e.target.value }))} /></Field>
            <Field label="Status"><Select value={n.status} onChange={(v) => setN((s) => ({ ...s, status: v }))} options={DN_STATUSES} /></Field>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>Items delivered</span>
            <div style={{ flex: 1 }} /><Button size="sm" variant="ghost" icon="plus" onClick={addItem}>Add row</Button>
          </div>
          <div style={{ overflowX: 'auto', border: `1px solid ${T.line}`, borderRadius: 14 }}>
            <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontFamily: F }}>
              <thead><tr style={{ background: T.surface }}>
                <th style={{ ...head, paddingLeft: 12, width: 150 }}>Product code</th>
                <th style={head}>Description</th>
                <th style={{ ...head, width: 90, textAlign: 'right' }}>Qty</th>
                <th style={{ ...head, width: 100 }}>UOM</th>
                <th style={{ ...head, width: 46 }}></th>
              </tr></thead>
              <tbody>
                {n.items.map((it, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={{ padding: '7px 6px 7px 10px' }}><input value={it.code} onChange={(e) => setItem(i, 'code', e.target.value)} placeholder="—" style={{ ...cell, fontWeight: 700 }} /></td>
                    <td style={{ padding: '7px 6px' }}><input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Item description" style={cell} /></td>
                    <td style={{ padding: '7px 6px' }}><input type="number" min="0" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} style={numCell} /></td>
                    <td style={{ padding: '7px 6px' }}><select value={it.uom} onChange={(e) => setItem(i, 'uom', e.target.value)} style={{ ...cell, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', fontWeight: 700 }}>{UOMS.map((u) => <option key={u} value={u}>{u}</option>)}</select></td>
                    <td style={{ padding: '7px 10px 7px 6px', textAlign: 'center' }}><RemoveBtn onClick={() => removeItem(i)} can={n.items.length > 1} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ marginTop: 16 }}><Field label="Notes" hint="printed on the note"><Textarea rows={2} value={n.notes} onChange={(e) => setN((s) => ({ ...s, notes: e.target.value }))} placeholder="e.g. Payment in 7 days." /></Field></div>
      </Modal>
    );
  }

  // ═══════════════════════════ LPO BUILDER ══════════════════════════════════
  function LPOBuilder({ existing, onClose }) {
    const auth = useAuth();
    const lpos = useLPOs();
    const blank = () => {
      const { seq, number } = LPOStore.nextNumber();
      return { id: 'lpo_' + Math.random().toString(36).slice(2, 9), seq, number, date: Q_todayISO(),
        supplier: { company: '', tin: '', phone: '', address: '', email: '' },
        expectedDelivery: '', paymentTerms: 'Cash on Delivery', currency: 'UGX', vatMode: 'inclusive',
        items: [{ code: '', brand: '', description: '', uom: 'Pcs', qty: 1, unitPrice: 0 }],
        requestedBy: '', approvedBy: '', preparedBy: auth.signature || auth.name, notes: '',
        status: 'Draft', createdAt: new Date().toISOString() };
    };
    const [o, setO] = React.useState(() => existing ? JSON.parse(JSON.stringify(existing)) : blank());
    const [err, setErr] = React.useState('');
    const suppliers = Array.from(new Set(lpos.map((x) => x.supplier && x.supplier.company).filter(Boolean)));
    const onSupplier = (e) => {
      const v = e.target.value;
      setO((s) => {
        const m = lpos.find((x) => (x.supplier.company || '').trim().toLowerCase() === v.trim().toLowerCase());
        const supplier = { ...s.supplier, company: v };
        if (m) Object.assign(supplier, { tin: m.supplier.tin || '', address: m.supplier.address || '', phone: m.supplier.phone || '', email: m.supplier.email || '' });
        return { ...s, supplier };
      });
    };
    const setSup = (k) => (e) => setO((s) => ({ ...s, supplier: { ...s.supplier, [k]: e.target.value } }));
    const setItem = (i, k, v) => setO((s) => { const items = s.items.slice(); items[i] = { ...items[i], [k]: v }; return { ...s, items }; });
    const addItem = () => setO((s) => ({ ...s, items: [...s.items, { code: '', brand: '', description: '', uom: 'Pcs', qty: 1, unitPrice: 0 }] }));
    const removeItem = (i) => setO((s) => ({ ...s, items: s.items.length > 1 ? s.items.filter((_, x) => x !== i) : s.items }));
    const t = D_lpoTotals(o), cur = o.currency;

    const validate = () => {
      if (!o.supplier.company.trim()) { setErr('Enter the supplier name.'); return false; }
      if (!o.items.some((it) => it.description.trim())) { setErr('Add at least one line item with a description.'); return false; }
      setErr(''); return true;
    };
    const persist = (status) => {
      const clean = { ...o, status: status || o.status, supplier: { ...o.supplier, company: o.supplier.company.trim() }, items: o.items.filter((it) => it.description.trim() || Number(it.qty) || Number(it.unitPrice)) };
      LPOStore.save(clean); return clean;
    };
    const save = () => { if (!validate()) return; persist(); onClose(); ToastStore.push(`${o.number} saved.`, { title: 'Purchase order saved', icon: 'check', tone: 'ok' }); };
    const pdf = () => { if (!validate()) return; printLPO(persist()); ToastStore.push('Original + copy queued — choose “Save as PDF”.', { title: 'PDF ready', icon: 'download', tone: 'info' }); };
    const VatOpt = ({ v, label }) => (
      <span onClick={() => setO((s) => ({ ...s, vatMode: v }))} style={{ flex: 1, textAlign: 'center', padding: '7px 4px', fontSize: 12, fontWeight: 800, cursor: 'pointer', borderRadius: 999, background: o.vatMode === v ? T.blue : 'transparent', color: o.vatMode === v ? '#fff' : T.sub, transition: 'background .15s, color .15s' }}>{label}</span>
    );

    return (
      <Modal title={existing ? `Edit ${o.number}` : 'Create Local Purchase Order'} sub={existing ? o.supplier.company : o.number + ' · draft'} width={1200} onClose={onClose}
        footer={<React.Fragment>
          <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.sub }}>Grand total</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{Q_fmtMoney(t.grand, cur)}</span>
          </div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="ghost" icon="download" onClick={pdf}>Download PDF</Button>
          <Button variant="primary" icon="check" onClick={save}>Save</Button>
        </React.Fragment>}>
        <ErrBar err={err} />
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18 }}>
          <div style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>Supplier</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Supplier name" hint="type to auto-fill" full><Input value={o.supplier.company} onChange={onSupplier} placeholder="Supplier company…" list="pps-lpo-suppliers" autoComplete="off" /></Field>
              <Field label="TIN" hint="optional"><Input value={o.supplier.tin} onChange={setSup('tin')} /></Field>
              <Field label="Phone" hint="optional"><Input value={o.supplier.phone} onChange={setSup('phone')} /></Field>
              <Field label="Email" hint="optional"><Input value={o.supplier.email} onChange={setSup('email')} type="email" /></Field>
              <Field label="Address" hint="optional"><Input value={o.supplier.address} onChange={setSup('address')} /></Field>
            </div>
            <datalist id="pps-lpo-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignContent: 'start' }}>
            <Field label="Date"><Input type="date" value={o.date} onChange={(e) => setO((s) => ({ ...s, date: e.target.value }))} /></Field>
            <Field label="Expected delivery" hint="blank = TBD"><Input type="date" value={o.expectedDelivery} onChange={(e) => setO((s) => ({ ...s, expectedDelivery: e.target.value }))} /></Field>
            <Field label="Payment terms"><Select value={o.paymentTerms} onChange={(v) => setO((s) => ({ ...s, paymentTerms: v }))} options={PPS_PAYMENT_TERMS} /></Field>
            <Field label="Currency"><Select value={o.currency} onChange={(v) => setO((s) => ({ ...s, currency: v }))} options={Object.keys(PPS_CURRENCIES)} /></Field>
            <Field label="Requested by"><Input value={o.requestedBy} onChange={(e) => setO((s) => ({ ...s, requestedBy: e.target.value }))} /></Field>
            <Field label="Status"><Select value={o.status} onChange={(v) => setO((s) => ({ ...s, status: v }))} options={LPO_STATUSES} /></Field>
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>Items ordered</span>
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: T.sub }}>· amount calculates automatically</span>
            <div style={{ flex: 1 }} /><Button size="sm" variant="ghost" icon="plus" onClick={addItem}>Add row</Button>
          </div>
          <div style={{ overflowX: 'auto', border: `1px solid ${T.line}`, borderRadius: 14 }}>
            <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', fontFamily: F }}>
              <thead><tr style={{ background: T.surface }}>
                <th style={{ ...head, paddingLeft: 12, width: 130 }}>Item code</th>
                <th style={{ ...head, width: 130 }}>Brand</th>
                <th style={head}>Description</th>
                <th style={{ ...head, width: 90 }}>UOM</th>
                <th style={{ ...head, width: 74, textAlign: 'right' }}>Qty</th>
                <th style={{ ...head, width: 130, textAlign: 'right' }}>Unit price</th>
                <th style={{ ...head, width: 130, textAlign: 'right' }}>Amount</th>
                <th style={{ ...head, width: 46 }}></th>
              </tr></thead>
              <tbody>
                {o.items.map((it, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                    <td style={{ padding: '7px 6px 7px 10px' }}><input value={it.code} onChange={(e) => setItem(i, 'code', e.target.value)} placeholder="—" style={{ ...cell, fontWeight: 700 }} /></td>
                    <td style={{ padding: '7px 6px' }}><input value={it.brand} onChange={(e) => setItem(i, 'brand', e.target.value)} placeholder="—" style={cell} /></td>
                    <td style={{ padding: '7px 6px' }}><input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Item description" style={cell} /></td>
                    <td style={{ padding: '7px 6px' }}><select value={it.uom} onChange={(e) => setItem(i, 'uom', e.target.value)} style={{ ...cell, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', fontWeight: 700 }}>{UOMS.map((u) => <option key={u} value={u}>{u}</option>)}</select></td>
                    <td style={{ padding: '7px 6px' }}><input type="number" min="0" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} style={numCell} /></td>
                    <td style={{ padding: '7px 6px' }}><input type="number" min="0" value={it.unitPrice} onChange={(e) => setItem(i, 'unitPrice', e.target.value)} style={numCell} /></td>
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: T.ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{Q_fmtMoney((Number(it.qty) || 0) * (Number(it.unitPrice) || 0), cur)}</td>
                    <td style={{ padding: '7px 10px 7px 6px', textAlign: 'center' }}><RemoveBtn onClick={() => removeItem(i)} can={o.items.length > 1} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 18, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 300px', maxWidth: 420 }}>
            <Field label="Notes" hint="optional"><Textarea rows={2} value={o.notes} onChange={(e) => setO((s) => ({ ...s, notes: e.target.value }))} /></Field>
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: T.sub }}>In words: <span style={{ color: T.ink }}>{D_amountInWords(Math.round(t.grand), cur)}</span></div>
          </div>
          <div style={{ flex: '1 1 320px', maxWidth: 400, marginLeft: 'auto', border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 15px' }}>
              <span style={{ fontWeight: 700, color: T.sub, fontSize: 13.5 }}>VAT</span>
              <div style={{ display: 'flex', background: T.surface, border: `1px solid ${T.line}`, borderRadius: 999, padding: 3, userSelect: 'none', width: 250 }}>
                <VatOpt v="inclusive" label="Incl." /><VatOpt v="exclusive" label="+18%" /><VatOpt v="none" label="No VAT" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 15px', fontSize: 13.5, borderTop: `1px solid ${T.lineSoft}` }}><span style={{ fontWeight: 700, color: T.sub }}>Subtotal</span><strong style={{ color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{Q_fmtMoney(t.subtotal, cur)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 15px', fontSize: 13.5, borderTop: `1px solid ${T.lineSoft}` }}><span style={{ fontWeight: 700, color: T.sub }}>VAT @ 18%</span><strong style={{ color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{t.mode === 'none' ? '—' : Q_fmtMoney(t.vat, cur)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 15px', background: T.navy, color: '#fff' }}><span style={{ fontWeight: 800 }}>Grand Total</span><strong style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{Q_fmtMoney(t.grand, cur)}</strong></div>
          </div>
        </div>
      </Modal>
    );
  }

  // ══════════════════════════════ PREVIEW ═══════════════════════════════════
  function DocPreview({ title, sub, html, onClose, onEdit, onPrint }) {
    return (
      <Modal title={title} sub={sub} width={1100} onClose={onClose}
        footer={<React.Fragment>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="ghost" icon="doc" onClick={() => { onClose(); onEdit(); }}>Edit</Button>
          <Button variant="primary" icon="download" onClick={onPrint}>Download PDF</Button>
        </React.Fragment>}>
        <div style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: html }} />
      </Modal>
    );
  }

  // ═════════════════════════ DELIVERIES SECTION ═════════════════════════════
  function Deliveries() {
    const list0 = useDeliveries();
    const auth = useAuth();
    const [q, setQ] = React.useState('');
    const [status, setStatus] = React.useState('All');
    const [building, setBuilding] = React.useState(null);
    const [preview, setPreview] = React.useState(null);
    const isAdmin = !!auth && auth.role === 'admin';
    const del = (x) => {
      if (!isAdmin) { ToastStore.push('Only admins can delete delivery notes.', { title: 'Access denied', icon: 'lock', tone: 'error' }); return; }
      ConfirmStore.open({ title: 'Delete delivery note', sub: x.number, body: `Permanently delete this delivery note for ${x.client.company}?`, confirmLabel: 'Delete', danger: true, onConfirm: () => { DeliveryStore.remove(x.id); ToastStore.push(`${x.number} deleted.`, { title: 'Delivery note deleted', icon: 'minus', tone: 'warn' }); } });
    };
    const list = list0.filter((x) => {
      if (status !== 'All' && x.status !== status) return false;
      if (q.trim() && !(x.number + ' ' + x.client.company + ' ' + (x.customerRef || '')).toLowerCase().includes(q.trim().toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    const cols = [{ label: 'Note #' }, { label: 'Delivered to' }, { label: 'Date' }, { label: 'Items', align: 'right' }, { label: 'Status', align: 'center' }, { label: 'Actions', align: 'right', width: 150 }];
    return (
      <div>
        <PageHead title="Deliveries" sub={`${list0.length} delivery note${list0.length === 1 ? '' : 's'} · issue, print & track`}>
          <Button icon="plus" onClick={() => setBuilding({})}>Create Delivery Note</Button>
        </PageHead>
        <Card pad={14} style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Search value={q} onChange={setQ} placeholder="Search note #, client or ref…" width={300} />
          <Select value={status} onChange={setStatus} options={['All', ...DN_STATUSES]} width={160} />
          <div style={{ flex: 1 }} /><div style={{ fontSize: 13, fontWeight: 700, color: T.sub }}>{list.length} shown</div>
        </Card>
        {list.length === 0 ? <Card><Empty icon="doc" title="No delivery notes yet" sub="Click “Create Delivery Note” to issue one." /></Card> : (
          <Table columns={cols}>
            {list.map((x, i) => (
              <Row key={x.id} i={i} onClick={() => setPreview(x)}>
                <Td><span style={{ fontSize: 13, fontWeight: 800, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{x.number}</span></Td>
                <Td>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.client.company}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: T.sub }}>{x.customerRef || 'No customer ref'}</div>
                </Td>
                <Td><span style={{ fontSize: 12.5, fontWeight: 600, color: T.sub }}>{Q_fmtDate(x.date)}</span></Td>
                <Td align="right"><span style={{ fontSize: 13.5, fontWeight: 800, color: T.ink }}>{x.items.length}</span></Td>
                <Td align="center"><DStatus status={x.status} /></Td>
                <Td align="right">
                  <div style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <IconBtn icon="doc" tone="blue" title="View / Edit" onClick={() => setBuilding({ existing: x })} />
                    <IconBtn icon="download" tone="ink" title="Download PDF" onClick={() => printDelivery(x)} />
                    {isAdmin && <IconBtn icon="minus" tone="danger" title="Delete" onClick={() => del(x)} />}
                  </div>
                </Td>
              </Row>
            ))}
          </Table>
        )}
        {building && <DeliveryBuilder existing={building.existing} onClose={() => setBuilding(null)} />}
        {preview && <DocPreview title={preview.number} sub={`${preview.client.company} · ${preview.status}`} html={buildDeliveryHTML(preview, ['ORIGINAL'])} onClose={() => setPreview(null)} onEdit={() => setBuilding({ existing: preview })} onPrint={() => printDelivery(preview)} />}
      </div>
    );
  }

  // ════════════════════════════ LPO SECTION ═════════════════════════════════
  function LPOs() {
    const list0 = useLPOs();
    const auth = useAuth();
    const [q, setQ] = React.useState('');
    const [status, setStatus] = React.useState('All');
    const [building, setBuilding] = React.useState(null);
    const [preview, setPreview] = React.useState(null);
    const isAdmin = !!auth && auth.role === 'admin';
    const del = (x) => {
      if (!isAdmin) { ToastStore.push('Only admins can delete purchase orders.', { title: 'Access denied', icon: 'lock', tone: 'error' }); return; }
      ConfirmStore.open({ title: 'Delete purchase order', sub: x.number, body: `Permanently delete this LPO for ${x.supplier.company}?`, confirmLabel: 'Delete', danger: true, onConfirm: () => { LPOStore.remove(x.id); ToastStore.push(`${x.number} deleted.`, { title: 'Purchase order deleted', icon: 'minus', tone: 'warn' }); } });
    };
    const list = list0.filter((x) => {
      if (status !== 'All' && x.status !== status) return false;
      if (q.trim() && !(x.number + ' ' + x.supplier.company).toLowerCase().includes(q.trim().toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    const cols = [{ label: 'PO #' }, { label: 'Supplier' }, { label: 'Date' }, { label: 'Total', align: 'right' }, { label: 'Status', align: 'center' }, { label: 'Actions', align: 'right', width: 150 }];
    return (
      <div>
        <PageHead title="LPO" sub={`${list0.length} local purchase order${list0.length === 1 ? '' : 's'} · raise, print & track`}>
          <Button icon="plus" onClick={() => setBuilding({})}>Create LPO</Button>
        </PageHead>
        <Card pad={14} style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Search value={q} onChange={setQ} placeholder="Search PO # or supplier…" width={300} />
          <Select value={status} onChange={setStatus} options={['All', ...LPO_STATUSES]} width={160} />
          <div style={{ flex: 1 }} /><div style={{ fontSize: 13, fontWeight: 700, color: T.sub }}>{list.length} shown</div>
        </Card>
        {list.length === 0 ? <Card><Empty icon="doc" title="No purchase orders yet" sub="Click “Create LPO” to raise one." /></Card> : (
          <Table columns={cols}>
            {list.map((x, i) => {
              const t = D_lpoTotals(x);
              return (
                <Row key={x.id} i={i} onClick={() => setPreview(x)}>
                  <Td><span style={{ fontSize: 13, fontWeight: 800, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{x.number}</span></Td>
                  <Td>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.supplier.company}</div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: T.sub }}>{x.items.length} item{x.items.length === 1 ? '' : 's'} · {x.currency}</div>
                  </Td>
                  <Td><span style={{ fontSize: 12.5, fontWeight: 600, color: T.sub }}>{Q_fmtDate(x.date)}</span></Td>
                  <Td align="right"><span style={{ fontSize: 13.5, fontWeight: 800, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{Q_fmtMoney(t.grand, x.currency)}</span></Td>
                  <Td align="center"><DStatus status={x.status} /></Td>
                  <Td align="right">
                    <div style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <IconBtn icon="doc" tone="blue" title="View / Edit" onClick={() => setBuilding({ existing: x })} />
                      <IconBtn icon="download" tone="ink" title="Download PDF" onClick={() => printLPO(x)} />
                      {isAdmin && <IconBtn icon="minus" tone="danger" title="Delete" onClick={() => del(x)} />}
                    </div>
                  </Td>
                </Row>
              );
            })}
          </Table>
        )}
        {building && <LPOBuilder existing={building.existing} onClose={() => setBuilding(null)} />}
        {preview && <DocPreview title={preview.number} sub={`${preview.supplier.company} · ${preview.status}`} html={buildLPOHTML(preview, ['ORIGINAL'])} onClose={() => setPreview(null)} onEdit={() => setBuilding({ existing: preview })} onPrint={() => printLPO(preview)} />}
      </div>
    );
  }

  Object.assign(window, { AdminDeliveries: Deliveries, AdminLPOs: LPOs });
})();
