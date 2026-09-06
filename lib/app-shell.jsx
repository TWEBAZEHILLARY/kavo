// app-shell.jsx — native-app chrome for app.html (Android + iOS installable PWA).
// The app renders the SAME <HomeA /> screen and the same commerce modals as the
// website, so whatever the admin publishes appears in both. This file adds only
// the app-native furniture: a bottom tab bar, an install prompt and the
// admin-sync strip. Nothing here is used by home.html.
(function () {
  const { Icon, useCart, useAuth, ModalStore, ToastStore } = window;
  const T = { ink: '#0B1A33', sub: '#5A6B85', blue: '#1457E6', line: '#E4E9F2', surface: '#F7F9FC' };
  const F = "'Plus Jakarta Sans', system-ui, sans-serif";

  function Tab({ icon, label, active, badge, onClick }) {
    return (
      <button onClick={onClick} style={{ flex: 1, minHeight: 52, border: 'none', background: 'transparent', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer',
        fontFamily: F, color: active ? T.blue : T.sub, WebkitTapHighlightColor: 'transparent', padding: '6px 0' }}>
        <span style={{ position: 'relative', display: 'block' }}>
          <Icon name={icon} size={21} stroke={active ? 2.4 : 1.9} color={active ? T.blue : T.sub} />
          {badge ? (
            <span style={{ position: 'absolute', top: -6, right: -9, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
              background: '#E5484D', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center',
              justifyContent: 'center', boxShadow: '0 0 0 2px #fff' }}>{badge > 9 ? '9+' : badge}</span>
          ) : null}
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.2 }}>{label}</span>
      </button>
    );
  }

  // Android/Chrome fires beforeinstallprompt; iOS needs the Share → Add to Home
  // Screen instruction instead. Dismissal is remembered.
  function InstallBar() {
    const [evt, setEvt] = React.useState(null);
    const [show, setShow] = React.useState(false);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    React.useEffect(() => {
      if (standalone) return;
      let dismissed = false;
      try { dismissed = localStorage.getItem('pps_app_install_dismissed') === '1'; } catch (e) {}
      if (dismissed) return;
      if (ios) { setShow(true); return; }
      const onPrompt = (e) => { e.preventDefault(); setEvt(e); setShow(true); };
      window.addEventListener('beforeinstallprompt', onPrompt);
      return () => window.removeEventListener('beforeinstallprompt', onPrompt);
    }, []);
    if (!show) return null;
    const close = () => { setShow(false); try { localStorage.setItem('pps_app_install_dismissed', '1'); } catch (e) {} };
    const install = () => {
      if (evt) { evt.prompt(); close(); return; }
      ToastStore.push('Tap Share in Safari, then "Add to Home Screen".', { title: 'Install Cavort', icon: 'download' });
    };
    return (
      <div id="app-install" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
        background: T.ink, color: '#fff', fontFamily: F }}>
        <img src="images/brand/app-icon-192.png" alt="" style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Install the Cavort app</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.7)' }}>{ios ? 'Share → Add to Home Screen' : 'Works offline · full screen'}</div>
        </div>
        <button onClick={install} style={{ border: 'none', background: T.blue, color: '#fff', padding: '9px 15px', borderRadius: 9,
          fontSize: 12.5, fontWeight: 800, fontFamily: F, cursor: 'pointer', minHeight: 38 }}>Install</button>
        <button onClick={close} aria-label="Dismiss" style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,.6)',
          cursor: 'pointer', padding: 6, display: 'flex' }}><Icon name="plus" size={16} color="rgba(255,255,255,.6)" style={{ transform: 'rotate(45deg)' }} /></button>
      </div>
    );
  }

  function AppShell() {
    const cart = useCart();
    const auth = useAuth();
    const [tab, setTab] = React.useState('home');
    const count = cart.items ? cart.items.reduce((n, i) => n + (i.qty || 1), 0) : (cart.count ? cart.count() : 0);

    const go = (key, fn) => { setTab(key); fn(); };
    const home = () => { ModalStore.close(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const orders = () => {
      if (auth.isLoggedIn()) ModalStore.open('trackOrders');
      else { ToastStore.push('Please log in to view your orders.', { title: 'Sign in required', icon: 'box', tone: 'warn' }); ModalStore.open('login'); }
    };
    const account = () => ModalStore.open(auth.isLoggedIn() ? 'account' : 'login');

    return (
      <React.Fragment>
        <div id="app-admin-strip" style={{ fontFamily: F, background: T.surface, borderTop: `1px solid ${T.line}`,
          padding: '13px 16px calc(78px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="rotate" size={15} color={T.sub} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: T.sub, flex: 1, lineHeight: 1.4 }}>
            Catalogue, pricing and hero media sync live from the Cavort admin console.
          </span>
          <a href="/admin" style={{ fontSize: 11.5, fontWeight: 800, color: T.blue, textDecoration: 'none', whiteSpace: 'nowrap' }}>Admin →</a>
        </div>
        <div id="app-tabbar" style={{ fontFamily: F, background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)', borderTop: `1px solid ${T.line}`, boxShadow: '0 -6px 24px rgba(11,26,51,.08)' }}>
          <InstallBar />
          <div style={{ display: 'flex', alignItems: 'stretch', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <Tab icon="bolt" label="Home" active={tab === 'home'} onClick={() => go('home', home)} />
            <Tab icon="filter" label="Shop" active={tab === 'shop'} onClick={() => go('shop', () => ModalStore.open('catalogue'))} />
            <Tab icon="cart" label="Cart" badge={count} active={tab === 'cart'} onClick={() => go('cart', () => ModalStore.open('cart'))} />
            <Tab icon="box" label="Orders" active={tab === 'orders'} onClick={() => go('orders', orders)} />
            <Tab icon="user" label="Account" active={tab === 'account'} onClick={() => go('account', account)} />
          </div>
        </div>
      </React.Fragment>
    );
  }

  window.AppShell = AppShell;
})();
