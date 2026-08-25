import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const NAVIGATION = [
  ['dashboard', 'داشبورد', 'نمای زنده'],
  ['orders', 'سفارش‌ها', 'سفارش و پرداخت'],
  ['tables', 'میزها', 'سالن، QR و رزرو'],
  ['kitchen', 'آشپزخانه', 'KDS و ایستگاه‌ها'],
  ['catalog', 'کاتالوگ', 'انبار و کنترل هزینه'],
  ['club', 'باشگاه مشتریان', 'CRM، بازاریابی و بازخورد'],
  ['finance', 'مالی', 'حسابداری و کارکنان'],
  ['settings', 'تنظیمات مجموعه', 'عملیات، امنیت و لاگ'],
];

const money = (value) => `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
const number = (value) => Number(value || 0).toLocaleString('fa-IR');
const dateTime = (value) => value ? new Date(value).toLocaleString('fa-IR') : '—';

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('نشست شما منقضی شده است');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'خطا در دریافت اطلاعات');
  return data;
}

function Shell({ session, active, onNavigate, children }) {
  return <div className="app-shell">
    <aside className="sidebar" aria-label="ناوبری مدیریت WESTO">
      <div className="brand"><span>W</span><div><b>WESTO</b><small>مدیریت یکپارچه</small></div></div>
      <nav>{NAVIGATION.map(([id, label, hint]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => onNavigate(id)}><b>{label}</b><small>{hint}</small></button>)}</nav>
      <div className="account"><b>{session.user?.name || session.user?.phone}</b><small>{session.user?.roleLabel || session.user?.role || 'کاربر'}</small></div>
    </aside>
    <main className="content"><header><div><small>WESTO / عملیات</small><h1>{NAVIGATION.find((item) => item[0] === active)?.[1]}</h1></div><div className="branch">{session.branches?.find((b) => b.id === session.branchId)?.name || 'همه شعب'}</div></header>{children}</main>
  </div>;
}

function Stat({ label, value, tone = '' }) { return <article className={`stat ${tone}`}><span>{label}</span><b>{value}</b></article>; }

function Dashboard() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/v2/overview').then(setData).catch(() => setData({ error: true })); }, []);
  if (!data) return <Loading />;
  if (data.error) return <ErrorState />;
  return <><section className="hero"><div><small>وضعیت لحظه‌ای مجموعه</small><h2>عملیات امروز در یک نگاه</h2><p>داده‌ها از سفارش‌ها، پرداخت‌ها، میزها و آشپزخانه WESTO خوانده می‌شوند.</p></div><span className="live">● زنده</span></section>
    <section className="stats"><Stat label="فروش امروز" value={money(data.metrics.salesToday)} tone="accent" /><Stat label="سفارش‌های فعال" value={number(data.metrics.activeOrders)} /><Stat label="میزهای درگیر" value={`${number(data.metrics.busyTables)} / ${number(data.metrics.totalTables)}`} /><Stat label="فراخوان باز" value={number(data.metrics.openWaiterCalls)} tone={data.metrics.openWaiterCalls ? 'warn' : ''} /></section>
    <section className="grid two"><Panel title="صف آشپزخانه"><OrderList orders={data.kitchenTickets} compact /></Panel><Panel title="کارهای فوری">{data.alerts.length ? data.alerts.map((item) => <div className="alert" key={item.id}><b>{item.title}</b><span>{item.detail}</span></div>) : <Empty text="کار فوری ثبت نشده است" />}</Panel></section>
  </>;
}

function Orders() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const refresh = () => api('/api/admin/v2/orders').then(setData).catch((e) => setError(e.message));
  useEffect(refresh, []);
  if (!data) return <Loading />;
  const move = async (order, status) => { try { await api(`/api/v2/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); refresh(); } catch (e) { setError(e.message); } };
  return <><Subnav items={['همه سفارش‌ها', 'فعال', 'تکمیل‌شده']} /><section className="toolbar"><input placeholder="جست‌وجوی شماره، نام یا موبایل" /><span>{number(data.orders.length)} سفارش</span></section>{error && <Notice text={error} />}
    <section className="table-card"><table><thead><tr><th>سفارش</th><th>مشتری / میز</th><th>مبلغ</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>{data.orders.map((order) => <tr key={order.id}><td><b>{order.orderNo}</b><small>{dateTime(order.createdAt)}</small></td><td>{order.name || order.phone || 'مهمان'}<small>{order.tableNo ? `میز ${order.tableNo}` : order.fulfillment}</small></td><td>{money(order.total)}</td><td><Status status={order.status} /></td><td>{order.allowed?.[0] ? <button className="text-button" onClick={() => move(order, order.allowed[0])}>مرحله بعد</button> : '—'}</td></tr>)}</tbody></table></section>
  </>;
}

function Tables() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/v2/floor').then(setData); }, []);
  if (!data) return <Loading />;
  return <><section className="hero compact"><div><small>سالن و سفارش روی میز</small><h2>میزها، QR و رزرو</h2><p>QRهای عمومی WESTO بدون تغییر باقی مانده‌اند.</p></div><a className="button" href="/menu" target="_blank" rel="noreferrer">مشاهده منو</a></section><section className="stats"><Stat label="کل میزها" value={number(data.summary.total)} /><Stat label="اشغال" value={number(data.summary.busy)} tone="accent" /><Stat label="رزرو امروز" value={number(data.summary.reservations)} /><Stat label="فراخوان باز" value={number(data.summary.waiterCalls)} tone="warn" /></section><section className="floor">{data.tables.map((table) => <article key={table.id} className={`table-node ${table.state}`}><b>{table.label}</b><span>{table.zone}</span><small>{table.stateLabel} · {table.seats} نفر</small></article>)}</section></>;
}

function Kitchen() {
  const [data, setData] = useState(null);
  useEffect(() => { const load = () => api('/api/admin/v2/kitchen').then(setData); load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);
  if (!data) return <Loading />;
  return <><section className="hero compact"><div><small>KDS WESTO</small><h2>آشپزخانه و ایستگاه‌ها</h2><p>فقط سفارش پرداخت‌شده وارد صف آماده‌سازی می‌شود.</p></div></section><section className="kanban">{data.lanes.map((lane) => <article key={lane.id}><header><b>{lane.label}</b><span>{lane.tickets.length}</span></header>{lane.tickets.length ? lane.tickets.map((ticket) => <div className="ticket" key={ticket.id}><b>{ticket.orderNo}</b><small>{ticket.tableNo ? `میز ${ticket.tableNo}` : ticket.fulfillment} · {ticket.ageMinutes} دقیقه</small><p>{ticket.items.map((item) => `${item.qty}× ${item.name}`).join('، ')}</p></div>) : <Empty text="سفارشی نیست" />}</article>)}</section></>;
}

function Catalog() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/v2/catalog').then(setData); }, []);
  if (!data) return <Loading />;
  return <><Subnav items={['کنترل هزینه', 'انبار', 'مهندسی منو']} /><section className="stats"><Stat label="فروش دوره" value={money(data.cost.sales)} /><Stat label="بهای برآوردی" value={money(data.cost.estimatedCogs)} tone="warn" /><Stat label="حاشیه ناخالص" value={`${number(data.cost.grossMarginPct)}٪`} tone="accent" /><Stat label="کالای کم‌موجود" value={number(data.inventory.low)} tone={data.inventory.low ? 'warn' : ''} /></section><section className="grid two"><Panel title="انبار کالا و منو"><table><thead><tr><th>آیتم</th><th>موجودی</th><th>وضعیت</th></tr></thead><tbody>{data.inventory.items.slice(0, 12).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.tracked ? number(item.stock) : 'نامحدود'}</td><td><Status status={item.empty ? 'empty' : item.low ? 'low' : 'healthy'} /></td></tr>)}</tbody></table></Panel><Panel title="کنترل هزینه"><p className="muted">COGS اولیه از فروش واقعی و هزینه برآوردی آیتم‌ها محاسبه می‌شود. دستور تهیه و خرید، مرحله بعدی این ماژول هستند.</p><div className="metric-line"><b>{money(data.cost.estimatedProfit)}</b><span>سود ناخالص برآوردی</span></div></Panel></section></>;
}

function Club() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/v2/crm').then(setData); }, []);
  if (!data) return <Loading />;
  return <><Subnav items={['مشتریان', 'وفاداری', 'بازاریابی', 'بازخورد', 'خبرنامه']} /><section className="stats"><Stat label="مشتریان شناسایی‌شده" value={number(data.summary.customers)} /><Stat label="امتیاز در گردش" value={number(data.summary.points)} tone="accent" /><Stat label="بازخورد جدید" value={number(data.summary.newFeedback)} tone="warn" /><Stat label="اعضای خبرنامه" value={number(data.summary.newsletter)} /></section><section className="grid two"><Panel title="مشتریان برتر"><table><thead><tr><th>مشتری</th><th>سفارش</th><th>خرید</th><th>امتیاز</th></tr></thead><tbody>{data.customers.slice(0, 12).map((customer) => <tr key={customer.phone}><td>{customer.name || customer.phone}</td><td>{number(customer.orders)}</td><td>{money(customer.total)}</td><td>{number(customer.points)}</td></tr>)}</tbody></table></Panel><Panel title="بازخورد و خبرنامه"><p className="muted">بازخوردها، امتیاز وفاداری و عضویت خبرنامه در پروفایل مشتری یکپارچه می‌شوند.</p>{data.feedback.slice(0, 4).map((item) => <div className="alert" key={item.id}><b>{item.name || item.phone || 'مهمان'} · {item.score}/10</b><span>{item.comment || 'بدون توضیح'}</span></div>)}</Panel></section></>;
}

function Finance() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/v2/finance').then(setData); }, []);
  if (!data) return <Loading />;
  return <><Subnav items={['نمای کلی', 'فروش', 'صندوق', 'تسویه', 'اسناد', 'دفتر کل', 'تراز آزمایشی', 'هزینه‌ها', 'کارکنان و حقوق']} /><section className="stats"><Stat label="فروش ثبت‌شده" value={money(data.summary.sales)} tone="accent" /><Stat label="دریافت‌شده" value={money(data.summary.paid)} /><Stat label="مانده دریافت" value={money(data.summary.receivable)} tone={data.summary.receivable ? 'warn' : ''} /><Stat label="اسناد متوازن" value={`${number(data.summary.balancedEntries)} / ${number(data.summary.entries)}`} /></section><section className="grid two"><Panel title="دفتر روزنامه"><table><thead><tr><th>سند</th><th>تاریخ</th><th>بدهکار</th><th>بستانکار</th></tr></thead><tbody>{data.journal.slice(0, 10).map((entry) => <tr key={entry.id}><td>{entry.reference}</td><td>{dateTime(entry.at)}</td><td>{money(entry.debit)}</td><td>{money(entry.credit)}</td></tr>)}</tbody></table></Panel><Panel title="کارکنان و حقوق"><p className="muted">کارکنان و حقوق تنها از زیرمجموعه مالی مدیریت می‌شوند.</p>{data.employees.map((employee) => <div className="alert" key={employee.id}><b>{employee.name}</b><span>{employee.role} · {employee.status}</span></div>)}</Panel></section></>;
}

function Settings() {
  const [data, setData] = useState(null); const [category, setCategory] = useState('restaurant'); const [message, setMessage] = useState('');
  useEffect(() => { api('/api/admin/v2/settings').then(setData); }, []);
  if (!data) return <Loading />;
  const current = data.categories.find((item) => item.id === category) || data.categories[0];
  const save = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const values = Object.fromEntries(form.entries()); await api('/api/admin/v2/settings', { method: 'PATCH', body: JSON.stringify({ category, values }) }); setMessage('تغییرات ذخیره شد'); };
  return <section className="settings"><aside>{data.categories.map((item) => <button className={item.id === category ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}</aside><form onSubmit={save}><div className="section-title"><small>تنظیمات عملیاتی</small><h2>{current.label}</h2><p>{current.description}</p></div>{current.fields.map((field) => <label key={field.key}>{field.label}<input name={field.key} defaultValue={field.value ?? ''} type={field.type || 'text'} dir={field.dir || 'rtl'} /></label>)}<button className="button" type="submit">ذخیره تغییرات</button>{message && <span className="saved">{message}</span>}</form></section>;
}

function Panel({ title, children }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }
function Subnav({ items }) { return <nav className="subnav">{items.map((item, index) => <button key={item} className={index === 0 ? 'active' : ''}>{item}</button>)}</nav>; }
function OrderList({ orders, compact }) { return <div className="order-list">{orders?.length ? orders.map((order) => <div key={order.id}><b>{order.orderNo}</b><span>{order.tableNo ? `میز ${order.tableNo}` : order.fulfillment}</span><Status status={order.status} /></div>) : <Empty text="سفارشی در صف نیست" />}</div>; }
function Status({ status }) { const labels = { paid: 'جدید', preparing: 'در حال آماده‌سازی', ready: 'آماده', done: 'تکمیل', cancelled: 'لغو', low: 'کم', empty: 'اتمام', healthy: 'مناسب' }; return <span className={`status ${status}`}>{labels[status] || status}</span>; }
function Empty({ text }) { return <p className="empty">{text}</p>; }
function Notice({ text }) { return <div className="notice">{text}</div>; }
function Loading() { return <div className="loading">در حال دریافت اطلاعات…</div>; }
function ErrorState() { return <div className="notice">دریافت اطلاعات ناموفق بود.</div>; }

function App() {
  const [session, setSession] = useState(null); const [active, setActive] = useState('dashboard');
  useEffect(() => { api('/api/admin/session').then(setSession).catch(() => {}); }, []);
  const View = useMemo(() => ({ dashboard: Dashboard, orders: Orders, tables: Tables, kitchen: Kitchen, catalog: Catalog, club: Club, finance: Finance, settings: Settings }[active]), [active]);
  if (!session) return <Loading />;
  return <Shell session={session} active={active} onNavigate={setActive}><View /></Shell>;
}

createRoot(document.getElementById('root')).render(<App />);
