// reports.jsx — Advanced Reports module: filterable tables + CSV export.
// Wraps the existing analytics charts (AdminReportsOverview) as the Overview tab
// and adds Clients, Delivered, Pending, Products & Stock, Payments and Accounts
// reports. Overrides window.AdminReports (loaded after dashboard.jsx).
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

  // ════════════════════════════════ SHELL ══════════════════════════════════
  const TABS = [
    { id: 'overview', label: 'Overview', icon: 'filter' },
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
