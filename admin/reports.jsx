// reports.jsx — Advanced Reports module: filterable tables + CSV export.
// Wraps the existing analytics charts (AdminReportsOverview) as the Overview tab
// and adds Client Ledgers (statements of account), Clients, Delivered, Pending,
// Products & Stock, Payments and Accounts reports. Overrides window.AdminReports (loaded after dashboard.jsx).
(function () {
  const { Icon } = window;
  const T = window.ADMIN_T, F = window.ADMIN_F;
  const { Card, PageHead, Button, Search, Select, Table, Td, Row, Empty, Pill, Thumb,
    useData, DataStore, ToastStore, A_money, A_fmtDate } = window;

  // ── CSV download (native, no libraries) ──────────────────────────────────
  function downloadCSV(filename, headers, rows) {
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(',')];
    rows.forEach((r) => lines.push(r.map(esc).join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 120);
    ToastStore.push(filename + ' downloaded (' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ').', { title: 'Export ready', icon: 'download', tone: 'ok' });
  }
  const plain = (n) => Math.round(n || 0); // unformatted number for CSV cells

  // ── Small controls ───────────────────────────────────────────────────────
  function DateRange({ from, to, onFrom, onTo }) {
    const input = { height: 42, border: `1.5px solid ${T.line}`, borderRadius: 11, padding: '0 12px', fontFamily: F, fontSize: 13.5, fontWeight: 700, color: T.ink, background: '#fff', outline: 'none' };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} style={input} aria-label="From date" />
        <span style={{ fontSize: 13, fontWeight: 700, color: T.sub }}>to</span>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)} style={input} aria-label="To date" />
        {(from || to) && <button onClick={() => { onFrom(''); onTo(''); }} style={{ border: `1.5px solid ${T.line}`, background: '#fff', color: T.sub, cursor: 'pointer', fontFamily: F, fontSize: 13, fontWeight: 800, height: 42, padding: '0 12px', borderRadius: 11 }}>Clear</button>}
      </div>
    );
  }
  const inRange = (iso, from, to) => {
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  };

  // Section shell: title + controls + export, then a table or empty state.
  function ReportSection({ title, sub, controls, onExport, exportDisabled, children }) {
    return (
      <Card pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '16px 18px', borderBottom: `1px solid ${T.line}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: T.ink }}>{title}</div>
            {sub && <div style={{ fontSize: 12.5, fontWeight: 600, color: T.sub, marginTop: 2 }}>{sub}</div>}
          </div>
          <div style={{ flex: 1 }} />
          {controls}
          <Button icon="download" variant="dark" size="sm" onClick={onExport} style={exportDisabled ? { opacity: 0.5, pointerEvents: 'none' } : null}>Export CSV</Button>
        </div>
        {children}
      </Card>
    );
  }

  // ════════════════════════════════ CLIENTS ════════════════════════════════
  function ClientsReport({ d }) {
    const [q, setQ] = React.useState('');
    const L = window.KG_useLedger();
    const receipts = window.useReceipts();
    const quotes = window.useQuotes ? window.useQuotes() : [];
    const deliveries = window.useDeliveries ? window.useDeliveries() : [];
    const rows = React.useMemo(() => {
      const valid = d.orders.filter((o) => o.status !== 'Cancelled');
      return d.clients.map((c) => {
        const mine = valid.filter((o) => o.clientId === c.id);
        const h = window.KG_clientHistory(c, d, L, quotes, deliveries, receipts);
        return { c, count: mine.length, spent: mine.reduce((s, o) => s + o.total, 0), h };
      }).sort((a, b) => (b.h.delivered + b.spent) - (a.h.delivered + a.spent));
    }, [d, L, quotes, deliveries, receipts]);
    const term = q.trim().toLowerCase();
    const filtered = term ? rows.filter((r) => (r.c.name + ' ' + r.c.email + ' ' + r.c.phone).toLowerCase().includes(term)) : rows;
    const exp = () => downloadCSV('client-list.csv',
      ['Client', 'Email', 'Phone', 'Status', 'Orders', 'Total Spent (UGX)', 'Quotations', 'Deliveries', 'Quoted (UGX)', 'Delivered (UGX)', 'Paid (UGX)', 'Outstanding (UGX)'],
      filtered.map((r) => [r.c.name, r.c.email, r.c.phone, r.c.status, r.count, plain(r.spent), r.h.quotes.length, r.h.deliveries.length, plain(r.h.quoted), plain(r.h.delivered), plain(r.h.paid), plain(r.h.outstanding)]));
    return (
      <ReportSection title="Client List" sub={`${filtered.length} client${filtered.length === 1 ? '' : 's'} · orders, deliveries, payments & balance`}
        controls={<Search value={q} onChange={setQ} placeholder="Search name, email…" width={240} />}
        onExport={exp} exportDisabled={!filtered.length}>
        {filtered.length === 0 ? <Empty title="No clients match" sub="Try another search term." /> : (
          <Table columns={[{ label: 'Client' }, { label: 'Contact' }, { label: 'Status' }, { label: 'Orders', align: 'right' }, { label: 'Total Spent', align: 'right' }, { label: 'Delivered', align: 'right' }, { label: 'Paid', align: 'right' }, { label: 'Outstanding', align: 'right' }]}>
            {filtered.map((r, i) => (
              <Row key={r.c.id} i={i}>
                <Td><div style={{ fontWeight: 800 }}>{r.c.name}</div><div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 2 }}>{r.c.address}</div></Td>
                <Td><div style={{ fontWeight: 700 }}>{r.c.email}</div><div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 2 }}>{r.c.phone}</div></Td>
                <Td><Pill status={r.c.status} small /></Td>
                <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.count}</Td>
                <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{A_money(r.spent)}</Td>
                <Td align="right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{A_money(r.h.delivered)}<div style={{ fontSize: 11.5, color: T.sub, fontWeight: 600 }}>{r.h.deliveries.length} note{r.h.deliveries.length === 1 ? '' : 's'} · {r.h.quotes.length} quote{r.h.quotes.length === 1 ? '' : 's'}</div></Td>
                <Td align="right" style={{ fontWeight: 700, color: T.green, fontVariantNumeric: 'tabular-nums' }}>{A_money(r.h.paid)}</Td>
                <Td align="right" style={{ fontWeight: 800, color: r.h.outstanding > 0 ? T.red : T.ink, fontVariantNumeric: 'tabular-nums' }}>{A_money(r.h.outstanding)}</Td>
              </Row>
            ))}
          </Table>
        )}
      </ReportSection>
    );
  }

  // ══════════════════════════════ DELIVERED ════════════════════════════════
  // Delivered orders + delivered delivery notes, with their payment status.
  function DeliveredReport() {
    const L = window.KG_useLedger();
    const fmt = window.KG_fmtLedger, PayPill = window.KG_PayPill;
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const rows = L.invoices.filter((x) => inRange(x.date, from, to));
    const total = rows.filter((x) => x.currency === 'UGX').reduce((s, x) => s + x.total, 0);
    const exp = () => downloadCSV('delivered.csv',
      ['Reference', 'Source', 'Client', 'Delivered', 'Currency', 'Total', 'Paid', 'Balance', 'Payment status'],
      rows.map((x) => [x.ref, x.type === 'order' ? 'Order' : 'Delivery note', x.clientName, x.date, x.currency, plain(x.total), plain(x.paid), plain(x.balance), x.status]));
    return (
      <ReportSection title="Delivered" sub={`${rows.length} deliver${rows.length === 1 ? 'y' : 'ies'} · ${A_money(total)} delivered`}
        controls={<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />} onExport={exp} exportDisabled={!rows.length}>
        {rows.length === 0 ? <Empty icon="truck" title="Nothing delivered" sub="Orders and delivery notes marked Delivered appear here." /> : (
          <Table columns={[{ label: 'Reference' }, { label: 'Client' }, { label: 'Delivered' }, { label: 'Total', align: 'right' }, { label: 'Balance', align: 'right' }, { label: 'Payment', align: 'right' }]}>
            {rows.map((x, i) => (
              <Row key={x.key} i={i}>
                <Td><div style={{ fontWeight: 800 }}>{x.ref}</div><div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 2 }}>{x.type === 'order' ? 'Online order' : 'Delivery note' + (x.quote ? ' · ' + x.quote : '')}</div></Td>
                <Td style={{ fontWeight: 700 }}>{x.clientName}</Td>
                <Td style={{ color: T.sub, fontWeight: 600 }}>{A_fmtDate(x.date)}</Td>
                <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{x.total > 0 ? fmt(x.total, x.currency) : '—'}</Td>
                <Td align="right" style={{ fontWeight: 800, color: x.balance > 0 ? T.red : T.green, fontVariantNumeric: 'tabular-nums' }}>{fmt(x.balance, x.currency)}</Td>
                <Td align="right"><PayPill status={x.status} /></Td>
              </Row>
            ))}
          </Table>
        )}
      </ReportSection>
    );
  }

  // ═══════════════════════════ PENDING PAYMENTS ════════════════════════════
  // Accounts receivable: everything delivered that isn't fully paid. An admin
  // approves part or full payment; each approval issues a receipt.
  function ReceivablesReport() {
    const L = window.KG_useLedger();
    const fmt = window.KG_fmtLedger, PayPill = window.KG_PayPill, PayModal = window.KG_RecordPaymentModal;
    const [q, setQ] = React.useState('');
    const [st, setSt] = React.useState('Outstanding');
    const [src, setSrc] = React.useState('All');
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const [open, setOpen] = React.useState(null);
    const term = q.trim().toLowerCase();
    const rows = L.invoices.filter((x) => {
      if (st === 'Outstanding' ? x.status === 'Paid' : (st !== 'All' && x.status !== st)) return false;
      if (src !== 'All' && x.type !== (src === 'Orders' ? 'order' : 'dn')) return false;
      if (term && !(x.ref + ' ' + x.clientName + ' ' + (x.quote || '')).toLowerCase().includes(term)) return false;
      return inRange(x.date, from, to);
    }).sort((a, b) => b.age - a.age);
    const ugx = L.invoices.filter((x) => x.currency === 'UGX');
    const outstanding = ugx.reduce((s, x) => s + x.balance, 0);
    const month = new Date().toISOString().slice(0, 7);
    const collectedMonth = L.payments.filter((p) => p.currency === 'UGX' && (p.date || '').startsWith(month)).reduce((s, p) => s + p.amount, 0);
    const overdue = L.invoices.filter((x) => x.status !== 'Paid' && x.age > 30).length;
    const cards = [
      { label: 'Outstanding balance', value: A_money(outstanding), c: outstanding > 0 ? T.red : T.green },
      { label: 'Pending payment', value: L.invoices.filter((x) => x.status === 'Pending payment' || x.status === 'Amount needed').length, c: T.ink },
      { label: 'Partially paid', value: L.invoices.filter((x) => x.status === 'Partially paid').length, c: T.ink },
      { label: 'Over 30 days', value: overdue, c: overdue ? T.red : T.ink },
      { label: 'Collected this month', value: A_money(collectedMonth), c: T.green },
    ];
    const exp = () => downloadCSV('pending-payments.csv',
      ['Reference', 'Source', 'Client', 'Delivered', 'Days outstanding', 'Currency', 'Total', 'Paid', 'Balance', 'Status'],
      rows.map((x) => [x.ref, x.type === 'order' ? 'Order' : 'Delivery note', x.clientName, x.date, x.age, x.currency, plain(x.total), plain(x.paid), plain(x.balance), x.status]));
    const cur = open ? L.invoices.find((x) => x.key === open) : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {cards.map((c) => (
            <Card key={c.label} style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.c, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{c.value}</div>
            </Card>
          ))}
        </div>
        <ReportSection title="Pending Payments" sub={`${rows.length} shown · delivered orders and delivery notes awaiting payment approval`}
          controls={<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Search value={q} onChange={setQ} placeholder="Search ref, client…" width={200} />
            <Select value={st} onChange={setSt} options={['Outstanding', 'Pending payment', 'Partially paid', 'Amount needed', 'Paid', 'All']} width={170} />
            <Select value={src} onChange={setSrc} options={['All', 'Orders', 'Delivery notes']} width={150} />
            <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </div>} onExport={exp} exportDisabled={!rows.length}>
          {rows.length === 0 ? <Empty icon="check" title={st === 'Outstanding' ? 'All payments are up to date' : 'Nothing matches'} sub="Delivered orders and delivery notes wait here until payment is approved." /> : (
            <Table columns={[{ label: 'Reference' }, { label: 'Client' }, { label: 'Delivered' }, { label: 'Total', align: 'right' }, { label: 'Paid', align: 'right' }, { label: 'Balance', align: 'right' }, { label: 'Status' }, { label: '', align: 'right', width: 170 }]}>
              {rows.map((x, i) => (
                <Row key={x.key} i={i} onClick={() => setOpen(x.key)}>
                  <Td><div style={{ fontWeight: 800 }}>{x.ref}</div><div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 2 }}>{x.type === 'order' ? 'Online order' : 'Delivery note' + (x.quote ? ' · ' + x.quote : '')}</div></Td>
                  <Td style={{ fontWeight: 700 }}>{x.clientName}</Td>
                  <Td><div style={{ color: T.sub, fontWeight: 600 }}>{A_fmtDate(x.date)}</div>{x.status !== 'Paid' && <div style={{ fontSize: 11.5, fontWeight: 800, color: x.age > 30 ? T.red : T.faint, marginTop: 2 }}>{x.age} day{x.age === 1 ? '' : 's'}</div>}</Td>
                  <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{x.total > 0 ? fmt(x.total, x.currency) : '—'}</Td>
                  <Td align="right" style={{ fontWeight: 700, color: T.green, fontVariantNumeric: 'tabular-nums' }}>{fmt(x.paid, x.currency)}</Td>
                  <Td align="right" style={{ fontWeight: 800, color: x.balance > 0 ? T.red : T.green, fontVariantNumeric: 'tabular-nums' }}>{fmt(x.balance, x.currency)}</Td>
                  <Td><PayPill status={x.status} /></Td>
                  <Td align="right"><div onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                    {x.status === 'Paid'
                      ? <Button size="sm" variant="ghost" icon="doc" onClick={() => setOpen(x.key)}>History</Button>
                      : <Button size="sm" variant="primary" icon="check" onClick={() => setOpen(x.key)}>Record payment</Button>}
                  </div></Td>
                </Row>
              ))}
            </Table>
          )}
        </ReportSection>
        {cur && <PayModal inv={cur} onClose={() => setOpen(null)} />}
      </div>
    );
  }

  // ═══════════════════════════════ PENDING ═════════════════════════════════
  const PENDING_SET = ['Pending', 'Packed'];
  function PendingReport({ d }) {
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const rows = d.orders.filter((o) => PENDING_SET.includes(o.status) && inRange(o.date, from, to))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const total = rows.reduce((s, o) => s + o.total, 0);
    const update = (id, v) => {
      DataStore.setOrderStatus(id, v);
      ToastStore.push(`${id} marked ${v}.`, { title: 'Status updated', icon: 'truck', tone: v === 'Cancelled' ? 'warn' : 'ok' });
    };
    const exp = () => downloadCSV('pending-orders.csv',
      ['Order ID', 'Client', 'Date', 'Status', 'Items', 'Total (UGX)'],
      rows.map((o) => [o.id, o.clientName, o.date, o.status, o.items.reduce((s, it) => s + it.qty, 0), plain(o.total)]));
    const statusOpts = window.A_ORDER_STATUSES.map((s) => ({ value: s, label: s }));
    return (
      <ReportSection title="Pending Orders" sub={`${rows.length} awaiting fulfilment · ${A_money(total)} in pipeline`}
        controls={<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />} onExport={exp} exportDisabled={!rows.length}>
        {rows.length === 0 ? <Empty icon="check" title="Nothing pending" sub="All orders in this range are fulfilled or cancelled." /> : (
          <Table columns={[{ label: 'Order ID' }, { label: 'Client' }, { label: 'Date' }, { label: 'Total', align: 'right' }, { label: 'Update status', align: 'right', width: 190 }]}>
            {rows.map((o, i) => (
              <Row key={o.id} i={i}>
                <Td style={{ fontWeight: 800 }}>{o.id}</Td>
                <Td style={{ fontWeight: 700 }}>{o.clientName}</Td>
                <Td style={{ color: T.sub, fontWeight: 600 }}>{A_fmtDate(o.date)}</Td>
                <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{A_money(o.total)}</Td>
                <Td align="right" style={{ width: 190 }}><div style={{ display: 'inline-block', minWidth: 150 }}><Select value={o.status} onChange={(v) => update(o.id, v)} options={statusOpts} /></div></Td>
              </Row>
            ))}
          </Table>
        )}
      </ReportSection>
    );
  }

  // ═══════════════════════════ PRODUCTS & STOCK ════════════════════════════
  function ProductsReport({ d }) {
    const [q, setQ] = React.useState('');
    const [lowOnly, setLowOnly] = React.useState(false);
    const term = q.trim().toLowerCase();
    let rows = d.products.slice().sort((a, b) => a.stock - b.stock);
    if (term) rows = rows.filter((p) => (p.name + ' ' + p.sku + ' ' + p.brand + ' ' + p.category).toLowerCase().includes(term));
    if (lowOnly) rows = rows.filter((p) => p.stock < 5);
    const lowCount = d.products.filter((p) => p.stock < 5).length;
    const stat = (n) => n === 0 ? { t: 'Out of stock', c: T.red, b: T.redWash } : n < 5 ? { t: 'Low stock', c: T.amberInk, b: '#FFF3DC' } : { t: 'In stock', c: T.green, b: T.greenWash };
    const exp = () => downloadCSV('products-stock.csv',
      ['SKU', 'Product', 'Brand', 'Category', 'Stock', 'Status', 'Price (UGX)'],
      rows.map((p) => [p.sku, p.name, p.brand, p.category, p.stock, stat(p.stock).t, plain(p.salePrice || p.regularPrice)]));
    return (
      <ReportSection title="Products & Stock" sub={`${d.products.length} products · ${lowCount} below 5 units`}
        controls={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setLowOnly((v) => !v)} style={{ height: 42, padding: '0 14px', borderRadius: 11, border: `1.5px solid ${lowOnly ? T.red : T.line}`, background: lowOnly ? T.redWash : '#fff', color: lowOnly ? T.red : T.ink, fontFamily: F, fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="bolt" size={15} color={lowOnly ? T.red : T.sub} stroke={2.2} />Low stock</button>
          <Search value={q} onChange={setQ} placeholder="Search SKU, name…" width={230} />
        </div>} onExport={exp} exportDisabled={!rows.length}>
        {rows.length === 0 ? <Empty title="No products match" /> : (
          <Table columns={[{ label: 'Product' }, { label: 'SKU' }, { label: 'Category' }, { label: 'Stock', align: 'right' }, { label: 'Status', align: 'right' }, { label: 'Price', align: 'right' }]}>
            {rows.map((p, i) => {
              const s = stat(p.stock);
              return (
                <Row key={p.id} i={i}>
                  <Td><div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><Thumb p={p} size={38} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div><div style={{ fontSize: 12, color: T.sub, fontWeight: 700, marginTop: 2 }}>{p.brand}</div></div></div></Td>
                  <Td style={{ fontWeight: 700, color: T.sub, fontVariantNumeric: 'tabular-nums' }}>{p.sku}</Td>
                  <Td style={{ fontWeight: 700 }}>{p.category}</Td>
                  <Td align="right" style={{ fontWeight: 800, color: s.c, fontVariantNumeric: 'tabular-nums' }}>{p.stock}</Td>
                  <Td align="right"><span style={{ fontSize: 11.5, fontWeight: 800, color: s.c, background: s.b, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{s.t}</span></Td>
                  <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{A_money(p.salePrice || p.regularPrice)}</Td>
                </Row>
              );
            })}
          </Table>
        )}
      </ReportSection>
    );
  }

  // ═══════════════════════════════ PAYMENTS ════════════════════════════════
  // Every approved payment (receipt) plus verified online checkout payments.
  function PaymentsReport() {
    const L = window.KG_useLedger();
    const fmt = window.KG_fmtLedger;
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const [method, setMethod] = React.useState('All');
    const inDates = L.payments.filter((p) => inRange(p.date, from, to));
    const rows = method === 'All' ? inDates : inDates.filter((p) => p.method === method);
    const total = rows.filter((p) => p.currency === 'UGX').reduce((s, p) => s + p.amount, 0);
    const methods = ['All', ...Array.from(new Set([...(window.KG_PAY_METHODS || []), ...L.payments.map((p) => p.method)]))];
    const byMethod = {}; inDates.filter((p) => p.currency === 'UGX').forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; });
    const exp = () => downloadCSV('payments.csv',
      ['Receipt', 'Date', 'Client', 'For', 'Method', 'Reference', 'Type', 'Currency', 'Amount'],
      rows.map((p) => [p.number, p.date, p.clientName, p.ref, p.method, p.reference, p.type, p.currency, plain(p.amount)]));
    return (
      <ReportSection title="Payments" sub={`${rows.length} payment${rows.length === 1 ? '' : 's'} · ${A_money(total)} received`}
        controls={<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Select value={method} onChange={setMethod} options={methods.map((m) => ({ value: m, label: m === 'All' ? 'All methods' : m }))} width={170} />
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        </div>} onExport={exp} exportDisabled={!rows.length}>
        {Object.keys(byMethod).length > 0 && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '14px 18px', borderBottom: `1px solid ${T.line}` }}>
          {Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
            <button key={m} onClick={() => setMethod(method === m ? 'All' : m)} style={{ border: `1.5px solid ${method === m ? T.blue : T.line}`, background: method === m ? T.blueWash : '#fff', borderRadius: 12, padding: '8px 12px', cursor: 'pointer', fontFamily: F, textAlign: 'left' }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: T.sub }}>{m}</div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: T.ink, fontVariantNumeric: 'tabular-nums' }}>{A_money(v)}</div>
            </button>
          ))}
        </div>}
        {rows.length === 0 ? <Empty icon="shield" title="No payments" sub="Approved payments from Pending Payments appear here." /> : (
          <Table columns={[{ label: 'Receipt' }, { label: 'Date' }, { label: 'Client' }, { label: 'For' }, { label: 'Method' }, { label: 'Type' }, { label: 'Amount', align: 'right' }, { label: '', align: 'right' }]}>
            {rows.map((p, i) => (
              <Row key={p.id} i={i}>
                <Td style={{ fontWeight: 800 }}>{p.number}</Td>
                <Td style={{ color: T.sub, fontWeight: 600 }}>{A_fmtDate(p.date)}</Td>
                <Td style={{ fontWeight: 700 }}>{p.clientName}</Td>
                <Td style={{ fontWeight: 700 }}>{p.ref}</Td>
                <Td><div style={{ fontWeight: 700 }}>{p.method}</div>{p.reference && <div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 2 }}>{p.reference}</div>}</Td>
                <Td><span style={{ fontSize: 11.5, fontWeight: 800, color: p.type === 'Full' ? T.green : T.blueDk || T.blue, background: p.type === 'Full' ? T.greenWash : T.blueWash, padding: '4px 10px', borderRadius: 999 }}>{p.type === 'Full' ? 'Full' : 'Part'}</span></Td>
                <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(p.amount, p.currency)}</Td>
                <Td align="right">{p.receipt && window.KG_printReceipt && <window.IconBtn icon="download" tone="blue" title="Print receipt" onClick={() => window.KG_printReceipt(p.receipt)} />}</Td>
              </Row>
            ))}
          </Table>
        )}
      </ReportSection>
    );
  }

  // ═══════════════════════════════ ACCOUNTS ════════════════════════════════
  function AccountsReport({ d }) {
    const L = window.KG_useLedger();
    const ugxInv = L.invoices.filter((x) => x.currency === 'UGX');
    const invoiced = ugxInv.reduce((s, x) => s + x.total, 0);
    const collected = L.payments.filter((p) => p.currency === 'UGX').reduce((s, p) => s + p.amount, 0);
    const outstanding = ugxInv.reduce((s, x) => s + x.balance, 0);
    const openInv = L.invoices.filter((x) => x.status !== 'Paid');
    const overdue = openInv.filter((x) => x.age > 30);
    const valid = d.orders.filter((o) => o.status !== 'Cancelled');
    const pipeline = valid.filter((o) => o.status !== 'Delivered').reduce((s, o) => s + o.total, 0);
    const cancelled = d.orders.filter((o) => o.status === 'Cancelled');
    const lowStock = d.products.filter((p) => p.stock < 5).length;
    const rate = invoiced ? Math.round((collected / invoiced) * 100) : 0;
    const cards = [
      { icon: 'truck', label: 'Delivered (invoiced)', value: A_money(invoiced), accent: T.blue, note: `${L.invoices.length} orders & delivery notes` },
      { icon: 'check', label: 'Collected', value: A_money(collected), accent: T.green, note: `${L.payments.length} payments · ${rate}% of invoiced` },
      { icon: 'clock', label: 'Outstanding', value: A_money(outstanding), accent: T.amber, note: `${openInv.length} awaiting payment` },
      { icon: 'bolt', label: 'Over 30 days', value: A_money(overdue.filter((x) => x.currency === 'UGX').reduce((s, x) => s + x.balance, 0)), accent: T.red, note: `${overdue.length} account${overdue.length === 1 ? '' : 's'}` },
      { icon: 'cart', label: 'Orders in pipeline', value: A_money(pipeline), accent: T.purple, note: `Not yet delivered · ${cancelled.length} cancelled` },
      { icon: 'user', label: 'Active Clients', value: d.clients.filter((c) => c.status === 'Active').length, accent: T.teal, note: `${d.clients.length} total` },
      { icon: 'package', label: 'Catalogue Size', value: d.products.length, accent: T.blue, note: `${lowStock} low on stock` },
      { icon: 'box', label: 'Avg. Delivery Value', value: A_money(ugxInv.length ? invoiced / ugxInv.length : 0), accent: T.blueDk, note: 'Per delivered order / note' },
    ];
    const exp = () => downloadCSV('accounts-summary.csv', ['Metric', 'Value'],
      [['Delivered / Invoiced (UGX)', plain(invoiced)], ['Collected (UGX)', plain(collected)], ['Outstanding (UGX)', plain(outstanding)],
       ['Accounts awaiting payment', openInv.length], ['Over 30 days', overdue.length], ['Collection rate %', rate],
       ['Orders in pipeline (UGX)', plain(pipeline)], ['Cancelled Orders', cancelled.length],
       ['Active Clients', d.clients.filter((c) => c.status === 'Active').length], ['Total Clients', d.clients.length],
       ['Catalogue Size', d.products.length], ['Low Stock Items', lowStock]]);
    return (
      <ReportSection title="Accounts Summary" sub="Deliveries, collections and outstanding balances — updates as payments are approved" onExport={exp}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, padding: 18 }}>
          {cards.map((c) => (
            <div key={c.label} style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: '16px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: c.accent + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={c.icon} size={18} color={c.accent} stroke={2} /></div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: T.sub }}>{c.label}</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: T.ink, letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{c.value}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: T.faint, marginTop: 4 }}>{c.note}</div>
            </div>
          ))}
        </div>
      </ReportSection>
    );
  }

  // ═══════════════════════════ CLIENT LEDGERS ══════════════════════════════
  // Statement of account per client: every delivered order / delivery note is a
  // debit, every approved payment (receipt or verified online payment) is a
  // credit, with opening balance brought forward and a running balance.
  // Filter by client, period, currency, entry type and text; print a branded
  // statement (PDF) or export CSV. "All clients" shows the debtors summary.
  const LEDGER_CO = {
    name: 'Kavo Grid (U) Ltd.',
    address: 'Plot 24, Ntinda Industrial Area, Kampala, Uganda',
    postal: 'P.O. Box 219047, Kampala – Uganda',
    phone: '+256764250125',
    email: 'kavogrid@gmail.com',
    web: 'kavogrid.org',
    tin: '1059988191',
  };
  const lNorm = (v) => String(v || '').trim().toLowerCase();
  const lEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lToday = () => { const x = new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const lMoney = (n, cur) => (!cur || cur === 'UGX') ? 'USh ' + Math.round(Number(n) || 0).toLocaleString('en-US') : (window.Q_fmtMoney ? window.Q_fmtMoney(n, cur) : cur + ' ' + Math.round(Number(n) || 0).toLocaleString('en-US'));
  const lBal = (n, cur) => (n < -0.5 ? lMoney(-n, cur) + ' CR' : lMoney(Math.max(0, n), cur));
  const lDays = (from, to) => { const a = new Date(from).getTime(), b = new Date(to).getTime(); return isNaN(a) || isNaN(b) ? 0 : Math.max(0, Math.floor((b - a) / 86400000)); };
  const accName = (c) => c.companyName || c.name || '—';

  // Registered clients plus any walk-in / unregistered names found on
  // delivered invoices or receipts, so no account is left out.
  function ledgerAccounts(d, L, receipts) {
    const known = new Set();
    d.clients.forEach((c) => [c.name, c.companyName].filter(Boolean).forEach((n) => known.add(lNorm(n))));
    const ids = new Set(d.clients.map((c) => c.id));
    const extra = {};
    const add = (id, name, x) => {
      const n = lNorm(name);
      if ((id && ids.has(id)) || !n || n === '—' || known.has(n) || extra[n]) return;
      extra[n] = { id: 'name:' + n, name: String(name).trim(), phone: x.phone || '', email: x.email || '', address: x.address || '', status: 'Unregistered', unregistered: true };
    };
    L.invoices.forEach((i) => add(i.clientId, i.clientName, { phone: i.clientPhone, email: i.clientEmail, address: i.clientAddress }));
    receipts.forEach((r) => add(r.clientId, r.clientName, { phone: r.clientPhone, email: r.clientEmail, address: r.clientAddress }));
    return [...d.clients, ...Object.values(extra)].sort((a, b) => accName(a).localeCompare(accName(b)));
  }

  function ledgerEntries(c, d, L, quotes, deliveries, receipts) {
    const h = window.KG_clientHistory(c, d, L, quotes, deliveries, receipts);
    const rIds = new Set(h.receipts.map((r) => r.id)), invKeys = new Set(h.invoices.map((i) => i.key));
    const entries = [];
    h.invoices.forEach((i) => entries.push({
      id: 'i_' + i.key, kind: 'Invoice', date: i.date || '', ref: i.ref, currency: i.currency || 'UGX', debit: Number(i.total) || 0, credit: 0, inv: i,
      desc: (i.type === 'order' ? 'Goods delivered · online order' : 'Goods delivered · delivery note') + (i.quote ? ' · Qtn ' + i.quote : '') + (i.parts > 1 ? ` · part ${i.part} of ${i.parts}` : '') + (i.total <= 0 ? ' · amount to be confirmed' : ''),
    }));
    L.payments.filter((p) => rIds.has(p.id) || (p.number === 'Online' && invKeys.has(p.key))).forEach((p) => entries.push({
      id: 'p_' + p.id, kind: 'Payment', date: p.date || '', ref: p.number === 'Online' ? 'ONLINE' : p.number, currency: p.currency || 'UGX', debit: 0, credit: Number(p.amount) || 0, receipt: p.receipt,
      desc: 'Payment received · ' + (p.method || '—') + (p.reference ? ' (' + p.reference + ')' : '') + (p.ref && p.ref !== '—' ? ' · for ' + p.ref : '') + (p.type === 'Part' ? ' · part' : ''),
    }));
    entries.sort((a, b) => a.date.localeCompare(b.date) || ((b.debit > 0) - (a.debit > 0)) || String(a.ref).localeCompare(String(b.ref)));
    return { h, entries };
  }

  // Opening balance b/f, period rows with running balance, closing balance and
  // ageing of unpaid invoices (as at the end of the period).
  function ledgerStatement(entries, cur, from, to) {
    const es = entries.filter((e) => e.currency === cur);
    let opening = 0;
    es.forEach((e) => { if (from && e.date < from) opening += e.debit - e.credit; });
    let bal = opening, debits = 0, credits = 0;
    const rows = [];
    es.forEach((e) => {
      if ((from && e.date < from) || (to && e.date > to)) return;
      bal += e.debit - e.credit; debits += e.debit; credits += e.credit;
      rows.push({ ...e, balance: bal });
    });
    const asOf = to || lToday();
    const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
    es.filter((e) => e.inv && e.date <= asOf && e.inv.balance > 0).forEach((e) => {
      const age = lDays(e.date, asOf), b = e.inv.balance;
      if (age <= 30) aging.current += b; else if (age <= 60) aging.d30 += b; else if (age <= 90) aging.d60 += b; else aging.d90 += b;
    });
    return { opening, rows, debits, credits, closing: bal, aging, asOf };
  }

  const PERIODS = ['All time', 'This month', 'Last month', 'This quarter', 'This year', 'Last year', 'Custom'];
  function periodRange(p) {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    const iso = (dt) => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (p === 'This month') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    if (p === 'Last month') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (p === 'This quarter') { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))]; }
    if (p === 'This year') return [y + '-01-01', y + '-12-31'];
    if (p === 'Last year') return [(y - 1) + '-01-01', (y - 1) + '-12-31'];
    return ['', ''];
  }
  const periodLabel = (from, to) => from || to ? (from ? A_fmtDate(from) : 'Start') + ' – ' + (to ? A_fmtDate(to) : A_fmtDate(lToday())) : 'All transactions to ' + A_fmtDate(lToday());

  // ── Printable documents (hidden iframe, same approach as receipts) ──────
  const LEDGER_CSS = `@page{size:A4;margin:13mm}
*{box-sizing:border-box}
body{margin:0;font-family:'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,sans-serif;color:#0B1A33;font-size:11.5px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #0B1A33;padding-bottom:14px}
.logo{height:52px}
.co{text-align:right;font-size:10.5px;color:#5A6B85;line-height:1.7}
.bar{display:flex;justify-content:space-between;align-items:flex-end;margin:18px 0 16px}
.ttl{font-size:24px;font-weight:800;letter-spacing:2.4px;color:#1457E6}
.num{font-size:12.5px;font-weight:800;text-align:right}.num span{display:block;font-size:10.5px;color:#8A98B0;font-weight:700;margin-top:2px}
.meta{display:grid;grid-template-columns:1.2fr 1fr;gap:24px;margin-bottom:16px}
.lbl{font-size:9.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#8A98B0;margin-bottom:5px}
.cl{font-size:14.5px;font-weight:800;margin-bottom:3px}
.to div{line-height:1.65;color:#5A6B85}
.facts{border:1px solid #E4E9F2;border-radius:9px;overflow:hidden;align-self:start}
.fact{display:flex;justify-content:space-between;gap:14px;padding:6px 11px;font-size:11px}
.fact:not(:last-child){border-bottom:1px solid #EDF1F7}
.fact span{color:#8A98B0;font-weight:700}.fact strong{text-align:right}
.sum{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #E4E9F2;border-radius:9px;overflow:hidden;margin-bottom:16px}
.sum div{padding:9px 12px}.sum div:not(:last-child){border-right:1px solid #EDF1F7}
.sum span{display:block;font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#8A98B0}
.sum strong{display:block;font-size:13.5px;margin-top:3px;font-variant-numeric:tabular-nums}
.sum .due{background:#0B1A33}.sum .due span{color:#B8C4D9}.sum .due strong{color:#fff}
table.items{width:100%;border-collapse:collapse}
table.items th{background:#0B1A33;color:#fff;font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:8px 9px;text-align:left}
table.items td{padding:7px 9px;border-bottom:1px solid #EDF1F7;font-size:11px;vertical-align:top}
table.items tbody tr:nth-child(even){background:#F7F9FC}
table.items tr.bf td{font-style:italic;color:#5A6B85;background:#F4F7FC}
table.items tfoot td{border-top:2px solid #0B1A33;border-bottom:none;font-weight:800;font-size:11.5px;padding-top:9px}
.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.c{text-align:center}.mono{font-weight:700;white-space:nowrap}
.muted{color:#8A98B0}.red{color:#C9373C}.green{color:#119C5B}
.age{margin-top:16px}
.age table{width:100%;border-collapse:collapse;border:1px solid #E4E9F2}
.age th{font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#5A6B85;background:#F4F7FC;padding:7px 9px;text-align:right;border-bottom:1px solid #E4E9F2}
.age td{padding:8px 9px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
.note{margin-top:16px;font-size:10.5px;color:#5A6B85;line-height:1.7}
.stamp{display:inline-block;border:2px solid #119C5B;color:#119C5B;font-weight:800;letter-spacing:2px;padding:5px 14px;border-radius:6px;font-size:12px;transform:rotate(-3deg);margin-top:6px}
.sign{margin-top:30px;display:flex;justify-content:space-between;gap:40px}
.sigbox{flex:1;border-top:1px solid #8A98B0;padding-top:6px;font-size:10px;color:#5A6B85;font-weight:700}
.foot{margin-top:22px;padding-top:10px;border-top:1px solid #E4E9F2;text-align:center;font-size:9.5px;color:#8A98B0}
.page{break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}`;

  const ledgerHead = (title, numHtml) => `<div class="top"><img class="logo" src="${window.COMPANY_LOGO || ''}" alt="${lEsc(LEDGER_CO.name)}" />
<div class="co"><div><strong style="color:#0B1A33">${lEsc(LEDGER_CO.name)}</strong></div><div>${lEsc(LEDGER_CO.address)}</div><div>${lEsc(LEDGER_CO.postal)}</div><div>${lEsc(LEDGER_CO.phone)}</div><div>${lEsc(LEDGER_CO.email)} &middot; ${lEsc(LEDGER_CO.web)}</div><div><strong>TIN: ${lEsc(LEDGER_CO.tin)}</strong></div></div></div>
<div class="bar"><div class="ttl">${title}</div><div class="num">${numHtml}</div></div>`;
  const ledgerFoot = () => `<div class="foot">${lEsc(LEDGER_CO.name)} &middot; ${lEsc(LEDGER_CO.address)} &middot; ${lEsc(LEDGER_CO.postal)} &middot; ${lEsc(LEDGER_CO.phone)} &middot; ${lEsc(LEDGER_CO.email)} &middot; ${lEsc(LEDGER_CO.web)} &middot; TIN ${lEsc(LEDGER_CO.tin)}</div>`;

  function statementBody(acc, st, cur, from, to, by) {
    const stNo = 'SOA-' + String(acc.id || '').replace(/^name:/, '').replace(/[^0-9A-Za-z]/g, '').slice(-6).toUpperCase() + '-' + lToday().replace(/-/g, '');
    const rows = st.rows.map((e) => `<tr><td class="mono">${lEsc(A_fmtDate(e.date))}</td><td class="mono">${lEsc(e.ref)}</td><td>${lEsc(e.desc)}</td>
<td class="r">${e.debit ? lMoney(e.debit, cur) : ''}</td><td class="r">${e.credit ? lMoney(e.credit, cur) : ''}</td><td class="r"><strong>${lBal(e.balance, cur)}</strong></td></tr>`).join('');
    const a = st.aging;
    const settled = st.closing < 1 && st.rows.length > 0;
    return `${ledgerHead('STATEMENT OF ACCOUNT', `No. ${lEsc(stNo)}<span>Issued ${lEsc(A_fmtDate(lToday()))}</span>`)}
<div class="meta"><div class="to"><div class="lbl">Statement For</div><div class="cl">${lEsc(accName(acc))}</div>
${acc.companyName && acc.name && acc.companyName !== acc.name ? `<div>Attn: ${lEsc(acc.name)}</div>` : ''}${acc.address ? `<div>${lEsc(acc.address)}</div>` : ''}${acc.phone ? `<div>${lEsc(acc.phone)}</div>` : ''}${acc.email ? `<div>${lEsc(acc.email)}</div>` : ''}</div>
<div class="facts"><div class="fact"><span>Account</span><strong>${lEsc(acc.unregistered ? 'Walk-in / unregistered' : (acc.id || '—'))}</strong></div>
<div class="fact"><span>Period</span><strong>${lEsc(periodLabel(from, to))}</strong></div>
<div class="fact"><span>Currency</span><strong>${lEsc(cur)}</strong></div>
<div class="fact"><span>Transactions</span><strong>${st.rows.length}</strong></div></div></div>
<div class="sum"><div><span>Opening balance</span><strong>${lBal(st.opening, cur)}</strong></div><div><span>Invoiced (debits)</span><strong>${lMoney(st.debits, cur)}</strong></div>
<div><span>Payments (credits)</span><strong class="green">${lMoney(st.credits, cur)}</strong></div><div class="due"><span>${st.closing < -0.5 ? 'Credit balance' : 'Balance due'}</span><strong>${lBal(st.closing, cur)}</strong></div></div>
<table class="items"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
<tbody><tr class="bf"><td>${lEsc(from ? A_fmtDate(from) : '')}</td><td></td><td>Opening balance brought forward</td><td></td><td></td><td class="r">${lBal(st.opening, cur)}</td></tr>
${rows || '<tr><td colspan="6" class="c muted">No transactions in this period</td></tr>'}</tbody>
<tfoot><tr><td colspan="3">Totals for the period</td><td class="r">${lMoney(st.debits, cur)}</td><td class="r">${lMoney(st.credits, cur)}</td><td class="r">${lBal(st.closing, cur)}</td></tr></tfoot></table>
<div class="age"><div class="lbl">Ageing of unpaid invoices as at ${lEsc(A_fmtDate(st.asOf))}</div><table><thead><tr><th>Current (0–30 days)</th><th>31–60 days</th><th>61–90 days</th><th>Over 90 days</th><th>Total unpaid</th></tr></thead>
<tbody><tr><td>${lMoney(a.current, cur)}</td><td>${lMoney(a.d30, cur)}</td><td class="${a.d60 > 0 ? 'red' : ''}">${lMoney(a.d60, cur)}</td><td class="${a.d90 > 0 ? 'red' : ''}">${lMoney(a.d90, cur)}</td><td>${lMoney(a.current + a.d30 + a.d60 + a.d90, cur)}</td></tr></tbody></table></div>
<div class="note">${settled ? '<div class="stamp">ACCOUNT SETTLED</div>' : ''}
<p>Please review this statement and report any discrepancy within 14 days of the issue date; otherwise the balance shown will be taken as correct. Kindly quote the invoice / delivery note reference with every payment.${st.closing > 0.5 ? ` <strong>Amount now due: ${lMoney(st.closing, cur)}.</strong>` : ''}</p></div>
<div class="sign"><div class="sigbox">Prepared by: ${lEsc(by || '')}</div><div class="sigbox">For ${lEsc(LEDGER_CO.name)}</div><div class="sigbox">Client confirmation (signature &amp; date)</div></div>
${ledgerFoot()}`;
  }

  function summaryBody(list, cur, from, to, by) {
    const t = list.reduce((s, r) => ({ o: s.o + r.st.opening, d: s.d + r.st.debits, c: s.c + r.st.credits, b: s.b + r.st.closing, a: s.a + r.st.aging.d30 + r.st.aging.d60 + r.st.aging.d90 }), { o: 0, d: 0, c: 0, b: 0, a: 0 });
    const rows = list.map((r, i) => `<tr><td class="c">${i + 1}</td><td><strong>${lEsc(accName(r.acc))}</strong>${r.acc.phone ? `<div class="muted">${lEsc(r.acc.phone)}</div>` : ''}</td>
<td class="r">${lBal(r.st.opening, cur)}</td><td class="r">${lMoney(r.st.debits, cur)}</td><td class="r">${lMoney(r.st.credits, cur)}</td>
<td class="r">${lMoney(r.st.aging.d30 + r.st.aging.d60 + r.st.aging.d90, cur)}</td><td class="r"><strong>${lBal(r.st.closing, cur)}</strong></td></tr>`).join('');
    return `${ledgerHead('CLIENT LEDGER SUMMARY', `${lEsc(periodLabel(from, to))}<span>Issued ${lEsc(A_fmtDate(lToday()))} · ${lEsc(cur)}</span>`)}
<div class="sum"><div><span>Opening balances</span><strong>${lBal(t.o, cur)}</strong></div><div><span>Invoiced</span><strong>${lMoney(t.d, cur)}</strong></div>
<div><span>Collected</span><strong class="green">${lMoney(t.c, cur)}</strong></div><div class="due"><span>Total receivable</span><strong>${lBal(t.b, cur)}</strong></div></div>
<table class="items"><thead><tr><th class="c">#</th><th>Client</th><th class="r">Opening</th><th class="r">Invoiced</th><th class="r">Paid</th><th class="r">Over 30 days</th><th class="r">Closing balance</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" class="c muted">No accounts</td></tr>'}</tbody>
<tfoot><tr><td></td><td>Totals · ${list.length} account${list.length === 1 ? '' : 's'}</td><td class="r">${lBal(t.o, cur)}</td><td class="r">${lMoney(t.d, cur)}</td><td class="r">${lMoney(t.c, cur)}</td><td class="r">${lMoney(t.a, cur)}</td><td class="r">${lBal(t.b, cur)}</td></tr></tfoot></table>
<div class="sign"><div class="sigbox">Prepared by: ${lEsc(by || '')}</div><div class="sigbox">Checked by</div><div class="sigbox">Approved by</div></div>
${ledgerFoot()}`;
  }

  function printLedgerDoc(title, pages) {
    const old = document.getElementById('kg-ledger-print');
    if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = 'kg-ledger-print';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${lEsc(title)}</title><style>${LEDGER_CSS}</style></head><body>${pages.map((p) => `<div class="page">${p}</div>`).join('')}</body></html>`);
    doc.close();
    const prevTitle = document.title;
    document.title = title;
    const restore = () => { document.title = prevTitle; };
    try { f.contentWindow.addEventListener('afterprint', () => setTimeout(restore, 400)); } catch (e) {}
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { restore(); } }, 350);
  }

  function ClientLedgerReport({ d }) {
    const L = window.KG_useLedger();
    const receipts = window.useReceipts();
    const quotes = window.useQuotes ? window.useQuotes() : [];
    const deliveries = window.useDeliveries ? window.useDeliveries() : [];
    const auth = window.useAuth ? window.useAuth() : null;
    const by = auth ? auth.name : '';
    const fmt = window.KG_fmtLedger, PayPill = window.KG_PayPill;
    const [clientId, setClientId] = React.useState('all');
    const [period, setPeriod] = React.useState('All time');
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const [cur, setCur] = React.useState('UGX');
    const [kind, setKind] = React.useState('All entries');
    const [bal, setBal] = React.useState('All accounts');
    const [q, setQ] = React.useState('');

    const accounts = React.useMemo(() => ledgerAccounts(d, L, receipts), [d, L, receipts]);
    const all = React.useMemo(() => accounts.map((acc) => ({ acc, ...ledgerEntries(acc, d, L, quotes, deliveries, receipts) })), [accounts, d, L, quotes, deliveries, receipts]);
    const currencies = React.useMemo(() => {
      const s = new Set(['UGX']); all.forEach((a) => a.entries.forEach((e) => s.add(e.currency))); return Array.from(s);
    }, [all]);
    const pickPeriod = (p) => { setPeriod(p); if (p !== 'Custom') { const [a, b] = periodRange(p); setFrom(a); setTo(b); } };
    const setFromC = (v) => { setFrom(v); setPeriod(v || to ? 'Custom' : 'All time'); };
    const setToC = (v) => { setTo(v); setPeriod(from || v ? 'Custom' : 'All time'); };
    const term = q.trim().toLowerCase();
    const sel = clientId === 'all' ? null : all.find((a) => a.acc.id === clientId);

    const controls = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Select value={clientId} onChange={(v) => { setClientId(v); setQ(''); setKind('All entries'); }} width={230}
          options={[{ value: 'all', label: 'All clients (summary)' }, ...accounts.map((a) => ({ value: a.id, label: accName(a) + (a.unregistered ? ' · walk-in' : '') }))]} />
        <Select value={period} onChange={pickPeriod} options={PERIODS} width={150} />
        <DateRange from={from} to={to} onFrom={setFromC} onTo={setToC} />
        {currencies.length > 1 && <Select value={cur} onChange={setCur} options={currencies} width={100} />}
      </div>
    );
    const tile = (label, value, color, dark) => (
      <div style={{ border: `1px solid ${dark ? T.navy : T.line}`, background: dark ? T.navy : '#fff', borderRadius: 14, padding: '13px 15px' }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: dark ? 'rgba(255,255,255,.65)' : T.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: dark ? '#fff' : (color || T.ink), marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      </div>
    );
    const tfoot = (cells) => (
      <tr style={{ background: T.surface, borderTop: `2px solid ${T.ink}` }}>{cells.map((c, i) => <td key={i} style={{ padding: '13px 16px', fontSize: 13.5, fontWeight: 800, color: T.ink, textAlign: c.align || 'left', fontVariantNumeric: 'tabular-nums' }}>{c.v}</td>)}</tr>
    );

    // ── All clients: debtors summary ──
    if (!sel) {
      let list = all.map((a) => ({ ...a, st: ledgerStatement(a.entries, cur, from, to) }))
        .filter((r) => r.st.rows.length || Math.abs(r.st.opening) > 0.5);
      if (term) list = list.filter((r) => (accName(r.acc) + ' ' + (r.acc.name || '') + ' ' + (r.acc.email || '') + ' ' + (r.acc.phone || '')).toLowerCase().includes(term));
      if (bal === 'With balance due') list = list.filter((r) => r.st.closing > 0.5);
      else if (bal === 'Overdue (30+ days)') list = list.filter((r) => r.st.aging.d30 + r.st.aging.d60 + r.st.aging.d90 > 0.5);
      else if (bal === 'Settled') list = list.filter((r) => Math.abs(r.st.closing) <= 0.5);
      else if (bal === 'Credit balance') list = list.filter((r) => r.st.closing < -0.5);
      list.sort((a, b) => b.st.closing - a.st.closing || accName(a.acc).localeCompare(accName(b.acc)));
      const t = list.reduce((s, r) => ({ o: s.o + r.st.opening, d: s.d + r.st.debits, c: s.c + r.st.credits, b: s.b + r.st.closing, a: s.a + r.st.aging.d30 + r.st.aging.d60 + r.st.aging.d90 }), { o: 0, d: 0, c: 0, b: 0, a: 0 });
      const exp = () => downloadCSV('client-ledgers-summary.csv',
        ['Client', 'Phone', 'Email', 'Currency', 'Period from', 'Period to', 'Opening balance', 'Invoiced', 'Paid', 'Over 30 days', 'Closing balance'],
        list.map((r) => [accName(r.acc), r.acc.phone, r.acc.email, cur, from, to || lToday(), plain(r.st.opening), plain(r.st.debits), plain(r.st.credits), plain(r.st.aging.d30 + r.st.aging.d60 + r.st.aging.d90), plain(r.st.closing)]));
      const printAll = () => printLedgerDoc('Client-ledger-summary-' + lToday(), [summaryBody(list, cur, from, to, by)]);
      const printStatements = () => printLedgerDoc('Statements-' + lToday(), list.map((r) => statementBody(r.acc, r.st, cur, from, to, by)));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {tile('Accounts', list.length)}
            {tile('Opening balances', lBal(t.o, cur))}
            {tile('Invoiced in period', lMoney(t.d, cur))}
            {tile('Collected in period', lMoney(t.c, cur), T.green)}
            {tile('Over 30 days', lMoney(t.a, cur), t.a > 0 ? T.red : T.ink)}
            {tile('Total receivable', lBal(t.b, cur), null, true)}
          </div>
          <ReportSection title="Client Ledgers" sub={`${periodLabel(from, to)} · ${cur} · pick a client to open their full ledger`}
            controls={controls} onExport={exp} exportDisabled={!list.length}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 18px', borderBottom: `1px solid ${T.line}` }}>
              <Search value={q} onChange={setQ} placeholder="Search client, phone, email…" width={250} />
              <Select value={bal} onChange={setBal} options={['All accounts', 'With balance due', 'Overdue (30+ days)', 'Settled', 'Credit balance']} width={190} />
              <div style={{ flex: 1 }} />
              <Button icon="doc" variant="ghost" size="sm" onClick={printAll} style={!list.length ? { opacity: 0.5, pointerEvents: 'none' } : null}>Print summary</Button>
              <Button icon="download" variant="primary" size="sm" onClick={printStatements} style={!list.length ? { opacity: 0.5, pointerEvents: 'none' } : null}>Print all statements</Button>
            </div>
            {list.length === 0 ? <Empty icon="user" title="No client ledgers match" sub="Ledgers come from delivered orders, delivery notes and approved payments. Try another period or filter." /> : (
              <Table columns={[{ label: 'Client' }, { label: 'Opening', align: 'right' }, { label: 'Invoiced', align: 'right' }, { label: 'Paid', align: 'right' }, { label: 'Over 30 days', align: 'right' }, { label: 'Closing balance', align: 'right' }, { label: '', align: 'right' }]}>
                {list.map((r, i) => {
                  const over = r.st.aging.d30 + r.st.aging.d60 + r.st.aging.d90;
                  return (
                    <Row key={r.acc.id} i={i} onClick={() => setClientId(r.acc.id)}>
                      <Td><div style={{ fontWeight: 800 }}>{accName(r.acc)}</div><div style={{ fontSize: 12, color: T.sub, fontWeight: 600, marginTop: 2 }}>{r.acc.unregistered ? 'Walk-in / unregistered' : (r.acc.phone || r.acc.email || '')} · {r.st.rows.length} entr{r.st.rows.length === 1 ? 'y' : 'ies'}</div></Td>
                      <Td align="right" style={{ fontWeight: 700, color: T.sub, fontVariantNumeric: 'tabular-nums' }}>{lBal(r.st.opening, cur)}</Td>
                      <Td align="right" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{lMoney(r.st.debits, cur)}</Td>
                      <Td align="right" style={{ fontWeight: 700, color: T.green, fontVariantNumeric: 'tabular-nums' }}>{lMoney(r.st.credits, cur)}</Td>
                      <Td align="right" style={{ fontWeight: 800, color: over > 0 ? T.red : T.faint, fontVariantNumeric: 'tabular-nums' }}>{lMoney(over, cur)}</Td>
                      <Td align="right" style={{ fontWeight: 800, color: r.st.closing > 0.5 ? T.red : T.green, fontVariantNumeric: 'tabular-nums' }}>{lBal(r.st.closing, cur)}</Td>
                      <Td align="right"><div onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', gap: 6 }}>
                        <window.IconBtn icon="download" tone="blue" title="Print statement" onClick={() => printLedgerDoc(accName(r.acc) + ' statement ' + lToday(), [statementBody(r.acc, r.st, cur, from, to, by)])} />
                        <Button size="sm" variant="ghost" icon="doc" onClick={() => setClientId(r.acc.id)}>Ledger</Button>
                      </div></Td>
                    </Row>
                  );
                })}
                {tfoot([{ v: `Totals · ${list.length}` }, { v: lBal(t.o, cur), align: 'right' }, { v: lMoney(t.d, cur), align: 'right' }, { v: lMoney(t.c, cur), align: 'right' }, { v: lMoney(t.a, cur), align: 'right' }, { v: lBal(t.b, cur), align: 'right' }, { v: '' }])}
              </Table>
            )}
          </ReportSection>
        </div>
      );
    }

    // ── One client: full ledger / statement ──
    const acc = sel.acc;
    const st = ledgerStatement(sel.entries, cur, from, to);
    const shown = st.rows.filter((e) => {
      if (kind === 'Invoices' && !e.debit && !e.inv) return false;
      if (kind === 'Payments' && !e.credit) return false;
      if (kind === 'Unpaid invoices' && !(e.inv && e.inv.balance > 0)) return false;
      if (term && !(e.ref + ' ' + e.desc).toLowerCase().includes(term)) return false;
      return true;
    });
    const filtered = kind !== 'All entries' || !!term;
    const a = st.aging;
    const exp = () => downloadCSV(accName(acc).replace(/[^\w-]+/g, '-') + '-ledger.csv',
      ['Date', 'Reference', 'Type', 'Description', 'Currency', 'Debit', 'Credit', 'Balance'],
      [[from || '', '', 'Opening', 'Opening balance brought forward', cur, '', '', plain(st.opening)],
        ...shown.map((e) => [e.date, e.ref, e.kind, e.desc, cur, e.debit ? plain(e.debit) : '', e.credit ? plain(e.credit) : '', plain(e.balance)]),
        ['', '', 'Closing', 'Closing balance', cur, plain(st.debits), plain(st.credits), plain(st.closing)]]);
    const print = () => printLedgerDoc(accName(acc) + ' statement ' + lToday(), [statementBody(acc, { ...st, rows: filtered ? shown : st.rows }, cur, from, to, by)]);
    const idx = all.findIndex((x) => x.acc.id === acc.id);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: T.blueWash, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="user" size={22} color={T.blue} stroke={2} /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>{accName(acc)}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.sub, marginTop: 3, lineHeight: 1.6 }}>
                {[acc.companyName && acc.name !== acc.companyName ? 'Attn: ' + acc.name : '', acc.phone, acc.email, acc.address].filter(Boolean).join(' · ') || (acc.unregistered ? 'Walk-in / unregistered client' : '')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" size="sm" icon="user" onClick={() => setClientId('all')}>All clients</Button>
              <Button variant="ghost" size="sm" onClick={() => idx > 0 && setClientId(all[idx - 1].acc.id)} style={idx <= 0 ? { opacity: 0.45, pointerEvents: 'none' } : null}>‹ Prev</Button>
              <Button variant="ghost" size="sm" onClick={() => idx < all.length - 1 && setClientId(all[idx + 1].acc.id)} style={idx >= all.length - 1 ? { opacity: 0.45, pointerEvents: 'none' } : null}>Next ›</Button>
              <Button variant="primary" size="sm" icon="download" onClick={print}>Print statement</Button>
            </div>
          </div>
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {tile('Opening balance', lBal(st.opening, cur))}
          {tile('Invoiced (debits)', lMoney(st.debits, cur))}
          {tile('Paid (credits)', lMoney(st.credits, cur), T.green)}
          {tile(st.closing < -0.5 ? 'Credit balance' : 'Balance due', lBal(st.closing, cur), null, true)}
        </div>
        <ReportSection title="Client Ledger" sub={`${periodLabel(from, to)} · ${cur} · ${shown.length} of ${st.rows.length} entr${st.rows.length === 1 ? 'y' : 'ies'}`}
          controls={controls} onExport={exp}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 18px', borderBottom: `1px solid ${T.line}` }}>
            <Select value={kind} onChange={setKind} options={['All entries', 'Invoices', 'Payments', 'Unpaid invoices']} width={170} />
            <Search value={q} onChange={setQ} placeholder="Search ref, method, quotation…" width={250} />
            {filtered && <span style={{ fontSize: 12, fontWeight: 700, color: T.sub }}>Balance column still counts every entry</span>}
          </div>
          <Table columns={[{ label: 'Date' }, { label: 'Reference' }, { label: 'Description' }, { label: 'Debit', align: 'right' }, { label: 'Credit', align: 'right' }, { label: 'Balance', align: 'right' }, { label: '', align: 'right' }]}>
            <tr style={{ background: T.surface, borderBottom: `1px solid ${T.lineSoft}` }}>
              <Td style={{ color: T.sub, fontWeight: 600 }}>{from ? A_fmtDate(from) : ''}</Td><Td /><Td style={{ fontStyle: 'italic', color: T.sub, fontWeight: 700 }}>Opening balance brought forward</Td><Td /><Td />
              <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{lBal(st.opening, cur)}</Td><Td />
            </tr>
            {shown.length === 0 ? <tr><td colSpan={7} style={{ padding: 0 }}><Empty icon="doc" title="No entries" sub="Nothing in this period matches the filters." /></td></tr> : shown.map((e, i) => (
              <Row key={e.id} i={i}>
                <Td style={{ color: T.sub, fontWeight: 600, whiteSpace: 'nowrap' }}>{A_fmtDate(e.date)}</Td>
                <Td><div style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{e.ref}</div><div style={{ fontSize: 11.5, fontWeight: 800, color: e.debit ? T.blue : T.green, marginTop: 2 }}>{e.kind}</div></Td>
                <Td style={{ fontWeight: 600, color: T.ink, maxWidth: 360 }}>{e.desc}{e.inv && <div style={{ marginTop: 4 }}><PayPill status={e.inv.status} /></div>}</Td>
                <Td align="right" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{e.debit ? fmt(e.debit, cur) : ''}</Td>
                <Td align="right" style={{ fontWeight: 800, color: T.green, fontVariantNumeric: 'tabular-nums' }}>{e.credit ? fmt(e.credit, cur) : ''}</Td>
                <Td align="right" style={{ fontWeight: 800, color: e.balance > 0.5 ? T.red : T.green, fontVariantNumeric: 'tabular-nums' }}>{lBal(e.balance, cur)}</Td>
                <Td align="right">{e.receipt && window.KG_printReceipt && <window.IconBtn icon="download" tone="blue" title="Print receipt" onClick={() => window.KG_printReceipt(e.receipt)} />}</Td>
              </Row>
            ))}
            {tfoot([{ v: 'Closing balance' }, { v: '' }, { v: `as at ${A_fmtDate(to || lToday())}` }, { v: lMoney(st.debits, cur), align: 'right' }, { v: lMoney(st.credits, cur), align: 'right' }, { v: lBal(st.closing, cur), align: 'right' }, { v: '' }])}
          </Table>
          <div style={{ padding: '14px 18px', borderTop: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: T.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Ageing of unpaid invoices · as at {A_fmtDate(st.asOf)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {[['0–30 days', a.current, false], ['31–60 days', a.d30, false], ['61–90 days', a.d60, true], ['Over 90 days', a.d90, true]].map(([k, v, warn]) => (
                <div key={k} style={{ border: `1px solid ${T.line}`, borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: T.sub }}>{k}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: warn && v > 0 ? T.red : T.ink, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{lMoney(v, cur)}</div>
                </div>
              ))}
            </div>
          </div>
        </ReportSection>
      </div>
    );
  }

  // ════════════════════════════════ SHELL ══════════════════════════════════
  const TABS = [
    { id: 'overview', label: 'Overview', icon: 'filter' },
    { id: 'ledgers', label: 'Client Ledgers', icon: 'doc' },
    { id: 'receivables', label: 'Pending Payments', icon: 'clock' },
    { id: 'payments', label: 'Payments', icon: 'shield' },
    { id: 'delivered', label: 'Delivered', icon: 'truck' },
    { id: 'pending', label: 'Pending Orders', icon: 'cart' },
    { id: 'clients', label: 'Client List', icon: 'user' },
    { id: 'products', label: 'Products & Stock', icon: 'package' },
    { id: 'accounts', label: 'Accounts', icon: 'box' },
  ];

  function Reports() {
    const d = useData();
    const [tab, setTab] = React.useState('overview');
    return (
      <div>
        <PageHead title="Reports" sub="Filter, review and export live order, client and stock data" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {TABS.map((t) => {
            const on = t.id === tab;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1.5px solid ${on ? T.blue : T.line}`, background: on ? T.blue : '#fff', color: on ? '#fff' : T.ink, cursor: 'pointer', fontFamily: F, padding: '9px 14px', borderRadius: 999, fontSize: 13.5, fontWeight: 800, transition: 'background .15s, color .15s' }}>
                <Icon name={t.icon} size={16} color={on ? '#fff' : T.sub} stroke={2.1} />{t.label}
              </button>
            );
          })}
        </div>
        {tab === 'overview' && (window.AdminReportsOverview ? <window.AdminReportsOverview embedded /> : null)}
        {tab === 'ledgers' && <ClientLedgerReport d={d} />}
        {tab === 'clients' && <ClientsReport d={d} />}
        {tab === 'receivables' && <ReceivablesReport />}
        {tab === 'delivered' && <DeliveredReport d={d} />}
        {tab === 'pending' && <PendingReport d={d} />}
        {tab === 'products' && <ProductsReport d={d} />}
        {tab === 'payments' && <PaymentsReport d={d} />}
        {tab === 'accounts' && <AccountsReport d={d} />}
      </div>
    );
  }

  window.AdminReports = Reports;
})();
