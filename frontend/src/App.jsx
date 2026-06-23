import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import ProtectedRoute from './ProtectedRoute';

// API Base URL config for cross-origin (Cloudflare Pages -> Render)
const API_BASE = import.meta.env.VITE_API_URL || 
                 (import.meta.env.MODE === 'production' ? 'https://ottsolution.onrender.com' : '');

// Helper to resolve image paths: prepends API_BASE to local uploads (e.g. /uploads/...)
const resolveUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
};

export default function App() {
  // --- Global States ---
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(() => {
    const saved = sessionStorage.getItem('selectedProduct');
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });
  const [activeCategory, setActiveCategory] = useState(() => sessionStorage.getItem('activeCategory') || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeView, setActiveView] = useState(() => sessionStorage.getItem('activeView') || 'home'); // home, details, checkout, login, register, orders, admin
  const [userOrders, setUserOrders] = useState([]);
  
  // --- Theme State ---
  const theme = 'light';

  // --- Admin States ---
  const [adminOrders, setAdminOrders] = useState([]);
  const [adminTab, setAdminTab] = useState(() => sessionStorage.getItem('adminTab') || 'orders'); // orders, products, settings
  const [settings, setSettings] = useState({
    upi_id: 'pay@getsubscribed',
    upi_qr_url: ''
  });
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    currency: '$',
    platform: '',
    category: 'OTT Subscriptions',
    image_url: '',
    setup_type: '',
    duration: '',
    stock_type: 'code'
  });

  // --- Modal States ---
  const [rejectionModal, setRejectionModal] = useState({
    show: false,
    orderId: null,
    reason: ''
  });

  const [confirmModal, setConfirmModal] = useState({
    show: false,
    title: '',
    message: '',
    requireTextConfirm: false,
    confirmInput: '',
    onConfirm: null,
    onCancel: null
  });

  const [editUTRModal, setEditUTRModal] = useState({
    show: false,
    orderId: null,
    utrNumber: ''
  });

  const [analytics, setAnalytics] = useState({ visits: 0, users: 0, orders: 0, revenue: 0 });
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [loadingAdminUsers, setLoadingAdminUsers] = useState(false);
  const [editKeyModal, setEditKeyModal] = useState({ show: false, keyId: null, keyValue: '', keyType: 'code' });
  const [cropperState, setCropperState] = useState({ show: false, file: null, aspect: 1, onComplete: null });

  // --- Notification States ---
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  const [supportWidgetOpen, setSupportWidgetOpen] = useState(false);

  // --- Toast States ---
  const [toasts, setToasts] = useState([]);

  // --- Mobile Menu State ---
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // --- Effects ---
  useEffect(() => {
    // Apply Theme
    document.documentElement.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // Initial Load
    checkAuthSession();
    loadProducts();
    loadSettings();
    logVisit();
  }, []);

  useEffect(() => {
    sessionStorage.setItem('activeView', activeView);
  }, [activeView]);

  useEffect(() => {
    if (selectedProduct) {
      sessionStorage.setItem('selectedProduct', JSON.stringify(selectedProduct));
    } else {
      sessionStorage.removeItem('selectedProduct');
    }
  }, [selectedProduct]);

  useEffect(() => {
    sessionStorage.setItem('activeCategory', activeCategory);
  }, [activeCategory]);

  useEffect(() => {
    sessionStorage.setItem('adminTab', adminTab);
  }, [adminTab]);

  useEffect(() => {
    if (currentUser?.role === 'admin' && activeView === 'admin') {
      loadSettings();
      loadProducts();
      loadAdminOrders();
      loadAnalytics();
      loadAdminUsers();
    } else if (currentUser && activeView === 'orders') {
      loadUserOrders();
    }
  }, [currentUser, activeView]);

  const loadNotifications = async () => {
    try {
      const data = await apiRequest('/api/notifications');
      setNotifications(data);
    } catch (err) {}
  };

  useEffect(() => {
    loadNotifications();

    const eventSource = new EventSource(`${API_BASE}/api/notifications/stream`, { withCredentials: true });

    eventSource.onmessage = (event) => {
      try {
        const notif = JSON.parse(event.data);
        const isAdmin = currentUser?.role === 'admin';
        
        // Add to notifications history list
        setNotifications(prev => {
          // If it's a purchase social proof alert, don't store it in user's history list
          const isPurchase = notif.type === 'purchase';
          if (isPurchase && !isAdmin) {
            return prev;
          }
          return [notif, ...prev].slice(0, 50);
        });

        // Increment badge unread count if applicable
        const isPurchase = notif.type === 'purchase';
        if (isAdmin || (!notif.isAdminOnly && !isPurchase)) {
          setUnreadCount(prev => prev + 1);
        }

        // Show live sliding toast notification
        if (isAdmin || !notif.isAdminOnly) {
          let toastType = 'info';
          if (notif.type === 'purchase') toastType = 'success';
          if (notif.type === 'price_update') toastType = 'warning';
          if (notif.type === 'back_in_stock') toastType = 'success';
          if (notif.type === 'out_of_stock') toastType = 'error';
          showToast(`${notif.title}: ${notif.message}`, toastType);
        }

        // Synchronize local states automatically in real-time
        if (isAdmin) {
          if (['new_order', 'order_approved', 'order_rejected'].includes(notif.type)) {
            loadAdminOrders();
            loadAnalytics();
          }
        } else {
          if (['order_approved', 'order_rejected'].includes(notif.type)) {
            loadUserOrders();
          }
        }

        if (['new_product', 'price_update', 'back_in_stock', 'out_of_stock'].includes(notif.type)) {
          loadProducts();
        }
      } catch (err) {
        console.error('Error handling SSE notification event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('SSE connection disconnected. Attempting automatic reconnection...', err);
    };

    return () => {
      eventSource.close();
    };
  }, [currentUser]);

  // --- Toast Dispatcher ---
  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // --- API Fetcher ---
  const apiRequest = async (url, options = {}) => {
    try {
      const fetchOptions = {
        ...options,
        credentials: 'include'
      };
      const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
      const res = await fetch(fullUrl, fetchOptions);
      
      let data = {};
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        // If it's a long HTML error page, truncate it for readability in toast
        const truncatedText = text.length > 60 ? text.substring(0, 60) + '...' : text;
        data = { error: truncatedText || `HTTP Error ${res.status}: ${res.statusText}` };
      }

      if (!res.ok) {
        throw new Error(data.error || 'Request failed');
      }
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  // --- Authentication Helpers ---
  const checkAuthSession = async () => {
    try {
      const data = await apiRequest('/api/auth/me');
      setCurrentUser(data.user);
    } catch (err) {
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const data = await apiRequest('/api/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      showToast(data.message, 'success');
      setActiveView('home');
    } catch (err) {}
  };

  // --- Catalog Loaders ---
  const loadProducts = async () => {
    try {
      const data = await apiRequest('/api/products');
      setProducts(data);
    } catch (err) {}
  };

  // --- Order Loaders ---
  const loadUserOrders = async () => {
    if (!currentUser) return;
    try {
      const data = await apiRequest('/api/orders');
      setUserOrders(data);
    } catch (err) {}
  };

  const loadAdminOrders = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    try {
      const data = await apiRequest('/api/admin/orders');
      setAdminOrders(data);
    } catch (err) {}
  };

  const loadSettings = async () => {
    try {
      const url = currentUser?.role === 'admin' ? '/api/admin/settings' : '/api/settings';
      const data = await apiRequest(url);
      setSettings(data);
    } catch (err) {}
  };

  const loadAnalytics = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    setLoadingAnalytics(true);
    try {
      const data = await apiRequest('/api/admin/analytics');
      setAnalytics(data);
    } catch (err) {
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const loadAdminUsers = async () => {
    if (!currentUser || currentUser.role !== 'admin') return;
    setLoadingAdminUsers(true);
    try {
      const data = await apiRequest('/api/admin/users');
      setAdminUsers(data);
    } catch (err) {
    } finally {
      setLoadingAdminUsers(false);
    }
  };

  const logVisit = async () => {
    try {
      await fetch(`${API_BASE}/api/visits`, { method: 'POST', credentials: 'include' });
    } catch (err) {}
  };

  // --- Navigation Router ---
  const navigateTo = (viewName) => {
    setMobileMenuOpen(false);
    // Protected routes check
    if (viewName === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
      showToast('Admin permissions required.', 'error');
      setActiveView('login');
      return;
    }
    if ((viewName === 'orders' || viewName === 'checkout') && !currentUser) {
      showToast('Please log in to proceed.', 'warning');
      setActiveView('login');
      return;
    }

    if (viewName === 'orders') loadUserOrders();
    if (viewName === 'checkout') loadSettings();
    if (viewName === 'admin') {
      loadAdminOrders();
      loadProducts();
      loadSettings();
    }
    if (viewName === 'home') {
      loadProducts();
      loadSettings();
    }
    
    setActiveView(viewName);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- Copy Clipboard Helper ---
  const handleCopyUPI = (upiId) => {
    const textToCopy = typeof upiId === 'string' ? upiId : (settings?.upi_id || 'pay@getsubscribed');
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('UPI ID copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  };

  useEffect(() => {
    if (!notifDropdownOpen) return;
    const handleCloseDropdown = (e) => {
      if (!e.target.closest('.notification-bell-container')) {
        setNotifDropdownOpen(false);
      }
    };
    window.addEventListener('click', handleCloseDropdown);
    return () => window.removeEventListener('click', handleCloseDropdown);
  }, [notifDropdownOpen]);

  // --- Render Functions / Sub-components ---
  const renderNotificationBell = () => {
    if (!currentUser) return null;

    return (
      <div className="notification-bell-container" style={{ position: 'relative', display: 'inline-block' }}>
        <button
          className="btn btn-secondary btn-sm"
          style={{ padding: '6px', borderRadius: '50%', display: 'inline-flex', position: 'relative' }}
          onClick={() => {
            setNotifDropdownOpen(!notifDropdownOpen);
            setUnreadCount(0);
          }}
          aria-label="Notifications"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a3 3 0 0 0 5.4 0" />
          </svg>
          {unreadCount > 0 && (
            <span 
              className="notif-badge" 
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                backgroundColor: 'var(--accent-color, #ff3b30)',
                color: '#fff',
                fontSize: '9px',
                fontWeight: 'bold',
                borderRadius: '50%',
                minWidth: '14px',
                height: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 3px'
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>

        {notifDropdownOpen && (
          <div 
            className="notif-dropdown" 
            style={{
              position: 'absolute',
              top: '35px',
              right: 0,
              width: '280px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 1000,
              padding: '10px',
              maxHeight: '350px',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '8px' }}>
              <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>Notifications</strong>
              <button 
                type="button" 
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
                onClick={() => setNotifications([])}
              >
                Clear All
              </button>
            </div>
            {notifications.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                No notifications yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {notifications.map(n => {
                  let badgeColor = 'var(--text-muted)';
                  if (n.type === 'new_product') badgeColor = '#007cff';
                  if (n.type === 'price_update') badgeColor = '#ff9500';
                  if (n.type === 'back_in_stock') badgeColor = '#34c759';
                  if (n.type === 'out_of_stock') badgeColor = '#ff3b30';

                  return (
                    <div 
                      key={n.id} 
                      style={{ 
                        padding: '8px', 
                        borderRadius: '4px', 
                        backgroundColor: 'var(--bg-surface-elevated)', 
                        borderLeft: `3px solid ${badgeColor}`,
                        fontSize: '11.5px',
                        lineHeight: '1.4',
                        textAlign: 'left'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '3px' }}>
                        <strong style={{ fontSize: '11px', color: 'var(--text-main)' }}>{n.title}</strong>
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '11px', wordBreak: 'break-word' }}>
                        {n.message}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderToasts = () => (
    <div className="toast-container">
      {toasts.map(t => {
        let label = 'Info: ';
        if (t.type === 'success') label = 'Success: ';
        if (t.type === 'error') label = 'Error: ';
        if (t.type === 'warning') label = 'Warning: ';
        return (
          <div key={t.id} className={`toast ${t.type}`}>
            <span><strong>{label}</strong>{t.message}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {renderToasts()}
      
      {/* HEADER NAVBAR */}
      <header className="header">
        <div className="header-container container">
          <a href="#" className="logo-link" onClick={(e) => { e.preventDefault(); setActiveCategory('all'); navigateTo('home'); }}>
            <span className="logo-text">Get<span className="logo-alt">subscribed</span></span>
          </a>

          <div className="search-wrapper">
            <input 
              type="text" 
              placeholder="Search for subscription, keys and SaaS tools..." 
              value={searchQuery}
              onChange={(e) => { 
                setSearchQuery(e.target.value); 
                setShowSuggestions(true);
                if (activeView !== 'home') navigateTo('home'); 
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            />
            {showSuggestions && searchQuery.trim().length > 0 && (
              <div className="search-suggestions-dropdown">
                {products.filter(p => 
                  p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  p.platform.toLowerCase().includes(searchQuery.toLowerCase())
                ).slice(0, 5).map(prod => (
                  <div 
                    key={prod.id} 
                    className="suggestion-item"
                    onClick={() => {
                      setSelectedProduct(prod);
                      setSearchQuery('');
                      setShowSuggestions(false);
                      navigateTo('details');
                    }}
                  >
                    <img src={resolveUrl(prod.image_url)} alt={prod.name} className="suggestion-img" />
                    <div className="suggestion-info">
                      <span className="suggestion-title">{prod.name}</span>
                      <span className="suggestion-platform">{prod.platform} • {prod.currency || '$'}{prod.price.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
                {products.filter(p => 
                  p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  p.platform.toLowerCase().includes(searchQuery.toLowerCase())
                ).length === 0 && (
                  <div className="suggestion-no-results">No results found</div>
                )}
              </div>
            )}
          </div>

          {/* Desktop Navigation */}
          <div className="desktop-nav">
            {renderNotificationBell()}

            <div className="auth-nav-container">
              {currentUser ? (
                <>
                  <span className="user-greeting">Hello, {currentUser.email}</span>
                  {currentUser.role !== 'admin' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => navigateTo('orders')}>My Orders</button>
                  )}
                  {currentUser.role === 'admin' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => navigateTo('admin')}>Admin Panel</button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Log out</button>
                </>
              ) : (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => navigateTo('login')}>Log in</button>
                  <button className="btn btn-primary btn-sm" onClick={() => navigateTo('register')}>Register</button>
                </>
              )}
            </div>
          </div>

          {/* Mobile Header Controls (Hamburger) */}
          <div className="mobile-header-actions">
            {renderNotificationBell()}

            <button 
              className="btn btn-secondary btn-sm hamburger-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle Navigation Menu"
              style={{ display: 'inline-flex', padding: '6px' }}
            >
              {mobileMenuOpen ? (
                /* Close (X) Icon */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              ) : (
                /* Menu Lines Icon */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16M4 6h16M4 18h16"/></svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Overlay / Dropdown Menu */}
        {mobileMenuOpen && (
          <>
            <div className="mobile-nav-backdrop" onClick={() => setMobileMenuOpen(false)}></div>
            <div className="mobile-nav-menu">
              <div className="mobile-menu-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                <span className="logo-text" style={{ fontSize: '0.85rem', fontWeight: '800', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Menu</span>
                <button 
                  className="btn btn-secondary btn-sm" 
                  onClick={() => setMobileMenuOpen(false)}
                  style={{ display: 'inline-flex', padding: '6px', borderRadius: '50%' }}
                  aria-label="Close menu"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>

              <div className="mobile-nav-container">
                {currentUser ? (
                  <>
                    <div className="mobile-user-info" style={{ marginBottom: '8px', paddingBottom: '8px' }}>
                      <span className="user-greeting" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Hello,</span>
                      <strong className="mobile-user-email" style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{currentUser.email}</strong>
                    </div>
                    {currentUser.role !== 'admin' && (
                      <button className="btn btn-secondary btn-block btn-sm" onClick={() => navigateTo('orders')}>My Orders</button>
                    )}
                    {currentUser.role === 'admin' && (
                      <button className="btn btn-secondary btn-block btn-sm" onClick={() => navigateTo('admin')}>Admin Panel</button>
                    )}
                    <button className="btn btn-secondary btn-block btn-sm" onClick={handleLogout}>Log out</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-secondary btn-block btn-sm" onClick={() => navigateTo('login')}>Log in</button>
                    <button className="btn btn-primary btn-block btn-sm" onClick={() => navigateTo('register')}>Register</button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </header>

      {/* MAIN CONTAINER */}
      <main className="main-content container">
        
        {/* VIEW: HOME MARKETPLACE */}
        {activeView === 'home' && (
          <section id="view-home">
            <div className="hero-banner">
              <div className="hero-content">
                <span className="hero-badge">100% Genuine Subscriptions</span>
                <h1 className="hero-title">Buy Premium SaaS & OTT Accounts Cheaper</h1>
                <p class="hero-subtitle">Get private, shared, or gift card access to Netflix, Spotify, Canva, NordVPN and more. Secure manual UPI verification.</p>
                <div className="hero-stats">
                  <div className="stat-item"><span className="stat-val">10+</span><span className="stat-lbl">Premium Services</span></div>
                  <div className="stat-item"><span className="stat-val">15 Min</span><span className="stat-lbl">Avg. Delivery</span></div>
                  <div className="stat-item"><span className="stat-val">100%</span><span class="stat-lbl">Secure UTR Pay</span></div>
                </div>
              </div>
              <div className="hero-image-mockup">
                <div className="glow-orb"></div>
              </div>
            </div>

            <div className="category-section">
              <h2 className="section-title">Explore Categories</h2>
              <div className="category-filters">
                {['all', 'OTT Subscriptions', 'Music Subscriptions', 'SaaS Tools', 'Gift Cards'].map(cat => (
                  <button 
                    key={cat} 
                    className={`category-btn ${activeCategory === cat ? 'active' : ''}`}
                    onClick={() => setActiveCategory(cat)}
                  >
                    {cat === 'all' ? 'All Items' : cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="products-grid-header">
              <h3 className="grid-title">Best Sellers</h3>
              <span className="grid-count">
                Showing {
                  products.filter(p => {
                    const matchCat = activeCategory === 'all' || p.category === activeCategory;
                    const matchQuery = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.description.toLowerCase().includes(searchQuery.toLowerCase());
                    return matchCat && matchQuery;
                  }).length
                } products
              </span>
            </div>

            <div className="products-grid">
              {products.filter(p => {
                const matchCat = activeCategory === 'all' || p.category === activeCategory;
                const matchQuery = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.description.toLowerCase().includes(searchQuery.toLowerCase());
                return matchCat && matchQuery;
              }).map(prod => (
                <div 
                  key={prod.id} 
                  className="product-card"
                  onClick={() => { setSelectedProduct(prod); navigateTo('details'); }}
                >
                  <div className="product-image-container">
                    <img className="product-image" src={resolveUrl(prod.image_url)} alt={prod.name} />
                    <span className="platform-badge">{prod.platform}</span>
                  </div>
                  <div className="product-info">
                    <span className="product-category">{prod.category}</span>
                    <h4 className="product-title">{prod.name}</h4>
                    <p className="product-desc-excerpt">{prod.description}</p>

                    {/* Specifications badges */}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '11px' }}>
                      {prod.duration && (
                        <span style={{ padding: '2px 6px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                          ⏳ {prod.duration}
                        </span>
                      )}
                      {prod.setup_type && (
                        <span style={{ padding: '2px 6px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                          ✉️ {prod.setup_type === 'on_your_mail' ? 'Your Mail' : 'My Mail'}
                        </span>
                      )}
                      <span style={{ padding: '2px 6px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '4px', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        🛠️ {prod.stock_type === 'code' ? 'Code' :
                             prod.stock_type === 'link' ? 'Invite Link' :
                             prod.stock_type === 'credentials' ? 'Credentials' :
                             prod.stock_type === 'login_code' ? 'Login Code' : 'Voucher'}
                      </span>
                      <span style={{ 
                        padding: '2px 6px', 
                        backgroundColor: (prod.stock_count > 0 || prod.stock_type === 'login_code') ? 'rgba(37,211,102,0.1)' : 'rgba(255,59,48,0.1)', 
                        borderRadius: '4px', 
                        border: '1px solid var(--border-color)', 
                        color: (prod.stock_count > 0 || prod.stock_type === 'login_code') ? '#25D366' : 'var(--danger-color)', 
                        fontWeight: 'bold' 
                      }}>
                        📦 {prod.stock_type === 'login_code' ? 'WhatsApp Setup' : prod.stock_count > 0 ? `${prod.stock_count} Available` : 'Out of Stock'}
                      </span>
                    </div>

                    <div className="product-footer">
                      <span className="product-price">{prod.currency || '$'}{prod.price.toFixed(2)}</span>
                      <button 
                        className="btn btn-primary btn-sm"
                        onClick={(e) => { e.stopPropagation(); setSelectedProduct(prod); navigateTo('details'); }}
                      >
                        Buy Now
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* VIEW: PRODUCT DETAILS */}
        {activeView === 'details' && selectedProduct && (
          <section id="view-product-details">
            <div className="back-nav">
              <a href="#" className="back-link" onClick={(e) => { e.preventDefault(); navigateTo('home'); }}>← Back to Marketplace</a>
            </div>
            <div className="details-layout">
              <div className="details-gallery">
                <img src={resolveUrl(selectedProduct.image_url)} alt={selectedProduct.name} />
              </div>
              <div className="details-info-card">
                <div className="details-badge-row">
                  <span className="detail-badge">Digital Delivery</span>
                  {selectedProduct.setup_type ? (
                    <span className="detail-badge">
                      {selectedProduct.setup_type === 'on_your_mail' ? 'Setup: Your Mail' : 'Setup: My Mail'}
                    </span>
                  ) : (
                    <span className="detail-badge">Private Account</span>
                  )}
                  <span className="detail-badge">{selectedProduct.platform}</span>
                </div>
                <h1 className="details-title">{selectedProduct.name}</h1>

                {/* PRODUCT SPECIFICATION BLOCK */}
                <div style={{ 
                  margin: '15px 0', 
                  padding: '15px', 
                  backgroundColor: 'var(--bg-surface-elevated)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '8px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '12px',
                  fontSize: '0.85rem'
                }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Stock Type</span>
                    <strong style={{ color: 'var(--text-main)' }}>
                      {selectedProduct.stock_type === 'code' ? 'Promo Code / Key' :
                       selectedProduct.stock_type === 'link' ? 'Invite Link' :
                       selectedProduct.stock_type === 'credentials' ? 'Credentials (Email:Password)' :
                       selectedProduct.stock_type === 'login_code' ? 'Login with Code' : 'Voucher'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Available Quantity</span>
                    <strong style={(selectedProduct.stock_count > 0 || selectedProduct.stock_type === 'login_code') ? { color: '#25D366' } : { color: 'var(--danger-color)' }}>
                      {selectedProduct.stock_type === 'login_code' ? 'WhatsApp Setup' : selectedProduct.stock_count > 0 ? `${selectedProduct.stock_count} units` : 'Out of Stock'}
                    </strong>
                  </div>
                  {selectedProduct.duration && (
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Duration</span>
                      <strong style={{ color: 'var(--text-main)' }}>{selectedProduct.duration}</strong>
                    </div>
                  )}
                  {selectedProduct.setup_type && (
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Setup Method</span>
                      <strong style={{ color: 'var(--text-main)' }}>
                        {selectedProduct.setup_type === 'on_your_mail' ? 'Account on Your Mail' : 'Account on My Mail'}
                      </strong>
                    </div>
                  )}
                </div>

                <p className="details-description">{selectedProduct.description}</p>
                
                <div className="details-buy-box">
                  <div className="price-box-row">
                    <span className="price-box-label">Price</span>
                    <span className="price-box-val">{selectedProduct.currency || '$'}{selectedProduct.price.toFixed(2)}</span>
                  </div>
                  <button 
                    className="btn btn-primary btn-block btn-lg" 
                    onClick={() => {
                      if (!currentUser) {
                        showToast('Please login to place an order.', 'warning');
                        navigateTo('login');
                      } else {
                        navigateTo('checkout');
                      }
                    }}
                  >
                    Proceed to Checkout
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* VIEW: CHECKOUT */}
        {activeView === 'checkout' && selectedProduct && (
          <ProtectedRoute currentUser={currentUser} navigateTo={navigateTo} showToast={showToast} authLoading={authLoading}>
            <CheckoutView 
              product={selectedProduct} 
              apiRequest={apiRequest} 
              showToast={showToast}
              navigateTo={navigateTo}
              handleCopyUPI={handleCopyUPI}
              settings={settings}
              setCropperState={setCropperState}
            />
          </ProtectedRoute>
        )}

        {/* VIEW: LOGIN */}
        {activeView === 'login' && (
          <LoginView 
            apiRequest={apiRequest} 
            showToast={showToast} 
            setCurrentUser={setCurrentUser} 
            navigateTo={navigateTo} 
          />
        )}

        {/* VIEW: REGISTER */}
        {activeView === 'register' && (
          <RegisterView 
            apiRequest={apiRequest} 
            showToast={showToast} 
            setCurrentUser={setCurrentUser} 
            navigateTo={navigateTo} 
          />
        )}

        {/* VIEW: USER ORDERS */}
        {activeView === 'orders' && (
          <ProtectedRoute currentUser={currentUser} navigateTo={navigateTo} showToast={showToast} authLoading={authLoading}>
            <UserOrdersView 
              orders={userOrders} 
              currentUser={currentUser} 
              showToast={showToast}
            />
          </ProtectedRoute>
        )}

        {/* VIEW: ADMIN PANEL */}
        {activeView === 'admin' && (
          <ProtectedRoute currentUser={currentUser} requiredRole="admin" navigateTo={navigateTo} showToast={showToast} authLoading={authLoading}>
            <AdminPanelView 
              orders={adminOrders} 
              products={products}
              adminTab={adminTab}
              setAdminTab={setAdminTab}
              newProduct={newProduct}
              setNewProduct={setNewProduct}
              rejectionModal={rejectionModal}
              setRejectionModal={setRejectionModal}
              loadAdminOrders={loadAdminOrders}
              loadProducts={loadProducts}
              apiRequest={apiRequest}
              showToast={showToast}
              settings={settings}
              loadSettings={loadSettings}
              confirmModal={confirmModal}
              setConfirmModal={setConfirmModal}
              setEditUTRModal={setEditUTRModal}
              analytics={analytics}
              loadingAnalytics={loadingAnalytics}
              loadAnalytics={loadAnalytics}
              adminUsers={adminUsers}
              loadingAdminUsers={loadingAdminUsers}
              loadAdminUsers={loadAdminUsers}
              editKeyModal={editKeyModal}
              setEditKeyModal={setEditKeyModal}
              setCropperState={setCropperState}
              currentUser={currentUser}
            />
          </ProtectedRoute>
        )}

        {/* VIEW: ABOUT */}
        {activeView === 'about' && (
          <AboutView />
        )}

        {/* VIEW: CONTACT */}
        {activeView === 'contact' && (
          <ContactView />
        )}

        {/* VIEW: SAFETY */}
        {activeView === 'safety' && (
          <SafetyView />
        )}

        {/* VIEW: TERMS */}
        {activeView === 'terms' && (
          <TermsView />
        )}

      </main>

      {/* FOOTER */}
      <footer style={{ 
        backgroundColor: 'var(--bg-surface)', 
        borderTop: '1px solid var(--border-color)', 
        padding: '30px 0', 
        marginTop: '60px', 
        fontSize: '0.85rem', 
        color: 'var(--text-muted)' 
      }}>
        <div className="container" style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          flexWrap: 'wrap', 
          gap: '20px' 
        }}>
          <div>
            <strong>Getsubscribed</strong> © {new Date().getFullYear()}. All Rights Reserved.
          </div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <a href="#about" onClick={(e) => { e.preventDefault(); navigateTo('about'); }} style={{ color: 'var(--text-muted)' }}>About Us</a>
            <a href="#contact" onClick={(e) => { e.preventDefault(); navigateTo('contact'); }} style={{ color: 'var(--text-muted)' }}>Contact Us</a>
            <a href="#safety" onClick={(e) => { e.preventDefault(); navigateTo('safety'); }} style={{ color: 'var(--text-muted)' }}>Safety & Refunds</a>
            <a href="#terms" onClick={(e) => { e.preventDefault(); navigateTo('terms'); }} style={{ color: 'var(--text-muted)' }}>Terms & Conditions</a>
          </div>
        </div>
      </footer>

      {/* REJECTION MODAL */}
      {rejectionModal.show && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="modal-title">Reject Transaction Payment</h3>
            <p className="modal-subtitle">Explain to the customer why their payment was rejected.</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              setConfirmModal({
                show: true,
                title: 'Confirm Rejection',
                message: 'Are you sure you want to REJECT this payment transaction?',
                requireTextConfirm: false,
                confirmInput: '',
                onConfirm: async () => {
                  try {
                    const data = await apiRequest(`/api/admin/orders/${rejectionModal.orderId}/verify`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'rejected', rejection_reason: rejectionModal.reason })
                    });
                    showToast(data.message, 'success');
                    setRejectionModal({ show: false, orderId: null, reason: '' });
                    loadAdminOrders();
                  } catch (err) {}
                }
              });
            }}>
              <div className="form-group">
                <label htmlFor="rejection-reason">Reason for Rejection</label>
                <textarea 
                  id="rejection-reason" 
                  required 
                  value={rejectionModal.reason}
                  onChange={(e) => setRejectionModal(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="e.g. UTR number not matching bank statement. Please try again."
                />
              </div>
              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setRejectionModal({ show: false, orderId: null, reason: '' })}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger">Confirm Rejection</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CUSTOM CONFIRMATION MODAL */}
      {confirmModal.show && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '400px' }}>
            <h3 className="modal-title">{confirmModal.title || 'Confirm Action'}</h3>
            <p className="modal-subtitle" style={{ marginBottom: '15px' }}>{confirmModal.message || 'Are you sure you want to proceed?'}</p>
            
            {confirmModal.requireTextConfirm && (
              <div className="form-group" style={{ marginTop: '15px' }}>
                <label htmlFor="confirm-modal-input" style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Please type <strong style={{ color: 'var(--text-main)' }}>CONFIRM</strong> to proceed:
                </label>
                <input 
                  type="text" 
                  id="confirm-modal-input"
                  value={confirmModal.confirmInput}
                  onChange={(e) => setConfirmModal(prev => ({ ...prev, confirmInput: e.target.value }))}
                  placeholder="Type CONFIRM here"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--input-bg)',
                    color: 'var(--text-main)',
                    marginTop: '5px',
                    outline: 'none',
                    fontFamily: 'inherit'
                  }}
                  autoFocus
                />
              </div>
            )}
            
            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => {
                  if (confirmModal.onCancel) confirmModal.onCancel();
                  setConfirmModal({ show: false, title: '', message: '', requireTextConfirm: false, confirmInput: '', onConfirm: null, onCancel: null });
                }}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-danger"
                disabled={confirmModal.requireTextConfirm && confirmModal.confirmInput.trim() !== 'CONFIRM'}
                onClick={() => {
                  if (confirmModal.onConfirm) confirmModal.onConfirm();
                  setConfirmModal({ show: false, title: '', message: '', requireTextConfirm: false, confirmInput: '', onConfirm: null, onCancel: null });
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT UTR MODAL */}
      {editUTRModal.show && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '400px' }}>
            <h3 className="modal-title">Edit Order UTR Number</h3>
            <p className="modal-subtitle" style={{ marginBottom: '15px' }}>
              Update the transaction reference ID for this order. This resets verification status to unchecked.
            </p>
            
            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label htmlFor="edit-utr-input" style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>
                UTR / UPI Reference Number
              </label>
              <input 
                type="text" 
                id="edit-utr-input"
                value={editUTRModal.utrNumber}
                onChange={(e) => setEditUTRModal(prev => ({ ...prev, utrNumber: e.target.value }))}
                placeholder="Enter 8-20 digit UTR"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontFamily: 'inherit'
                }}
                autoFocus
              />
            </div>
            
            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setEditUTRModal({ show: false, orderId: null, utrNumber: '' })}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-primary"
                onClick={async () => {
                  if (editUTRModal.utrNumber.trim().length < 12) {
                    showToast('UTR reference must be at least 12 characters.', 'warning');
                    return;
                  }
                  try {
                    const data = await apiRequest(`/api/admin/orders/${editUTRModal.orderId}/utr`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ utr_number: editUTRModal.utrNumber.trim() })
                    });
                    showToast(data.message, 'success');
                    setEditUTRModal({ show: false, orderId: null, utrNumber: '' });
                    loadAdminOrders();
                  } catch (err) {
                    showToast(err.message || 'Failed to update UTR', 'error');
                  }
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT KEY MODAL */}
      {editKeyModal.show && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '400px' }}>
            <h3 className="modal-title">Edit Stock Item</h3>
            <p className="modal-subtitle" style={{ marginBottom: '15px' }}>
              Update the key value and type for this inventory item.
            </p>
            
            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label htmlFor="edit-key-value-input" style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>
                Key / Code / Credentials / Link
              </label>
              <textarea 
                id="edit-key-value-input"
                className="form-control"
                value={editKeyModal.keyValue}
                onChange={(e) => setEditKeyModal(prev => ({ ...prev, keyValue: e.target.value }))}
                placeholder="Enter key details"
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontFamily: 'monospace',
                  fontSize: '13px'
                }}
                autoFocus
              />
            </div>

            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>
                Stock Type
              </label>
              <select
                value={editKeyModal.keyType}
                onChange={(e) => setEditKeyModal(prev => ({ ...prev, keyType: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              >
                <option value="code">Promo Code / Key</option>
                <option value="link">Invite Link</option>
                <option value="credentials">Credentials (Email:Password)</option>
                <option value="login_code">Login with Code</option>
              </select>
            </div>
            
            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setEditKeyModal({ show: false, keyId: null, keyValue: '', keyType: 'code' })}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-primary"
                onClick={async () => {
                  if (!editKeyModal.keyValue.trim()) {
                    showToast('Key value cannot be empty.', 'warning');
                    return;
                  }
                  try {
                    const data = await apiRequest(`/api/admin/keys/${editKeyModal.keyId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        key_value: editKeyModal.keyValue.trim(),
                        type: editKeyModal.keyType
                      })
                    });
                    showToast(data.message, 'success');
                    setEditKeyModal({ show: false, keyId: null, keyValue: '', keyType: 'code' });
                    if (selectedProductForStock) {
                      loadStockTabKeys(selectedProductForStock);
                    }
                    if (activeStockProduct) {
                      const updatedKeys = await apiRequest(`/api/admin/products/${activeStockProduct.id}/keys`);
                      setStockKeys(updatedKeys);
                    }
                    loadProducts();
                  } catch (err) {
                    showToast(err.message || 'Failed to update key', 'error');
                  }
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REUSABLE IMAGE CROPPER MODAL */}
      {cropperState.show && (
        <ImageCropperModal 
          show={cropperState.show}
          imageFile={cropperState.file}
          aspect={cropperState.aspect}
          onCancel={() => setCropperState({ show: false, file: null, aspect: 1, onComplete: null })}
          onCrop={(croppedFile) => {
            if (cropperState.onComplete) {
              cropperState.onComplete(croppedFile);
            }
            setCropperState({ show: false, file: null, aspect: 1, onComplete: null });
          }}
        />
      )}

      {/* FLOATING WHATSAPP CHAT WIDGET */}
      {(() => {
        const completedOrder = userOrders && userOrders.find(o => o.status === 'approved');
        const latestOrderUtr = completedOrder ? completedOrder.utr_number : (userOrders && userOrders.length > 0 ? userOrders[0].utr_number : '');
        const waPrefillText = completedOrder
          ? `Hello Getsubscribed Support! My order is completed (Reference UTR: ${completedOrder.utr_number}) and I would like to chat.`
          : (latestOrderUtr 
            ? `Hello Getsubscribed Support! I have a question regarding my order (UTR Reference: ${latestOrderUtr}).`
            : 'Hello Getsubscribed Support! I have a question about your services...');
        const waLink = `https://wa.me/917017750272?text=${encodeURIComponent(waPrefillText)}`;

        return (
          <div className="floating-chat-container" style={{ position: 'fixed', bottom: '25px', right: '25px', zIndex: 1000 }}>
            {/* Support Chat Card */}
            {supportWidgetOpen && (
              <div className="chat-support-card" style={{
                position: 'absolute',
                bottom: '70px',
                right: '0',
                width: '320px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)',
                overflow: 'hidden',
                animation: 'fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
              }}>
                {/* Header */}
                <div style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-text)',
                  padding: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '700', letterSpacing: '0.03em' }}>Getsubscribed Support</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: '#4caf50', borderRadius: '50%', animation: 'pulse 1.5s infinite' }}></span>
                      <span style={{ fontSize: '11px', color: '#a1a1aa' }}>Agent Online</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSupportWidgetOpen(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '18px',
                      cursor: 'pointer',
                      padding: '4px',
                      lineHeight: 1
                    }}
                  >
                    ×
                  </button>
                </div>
                
                {/* Body */}
                <div style={{ padding: '20px', backgroundColor: 'var(--bg-card)' }}>
                  <p style={{ margin: '0 0 16px 0', fontSize: '13px', lineHeight: '1.5', color: 'var(--text-muted)' }}>
                    Hi there! 👋 How can we help you today? Chat with our support team directly on WhatsApp for instant assistance with payments, keys, or custom orders.
                  </p>
                  
                  <a 
                    href={waLink} 
                    target="_blank" 
                    rel="noreferrer"
                    className="btn btn-primary"
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '8px', 
                      textDecoration: 'none', 
                      fontWeight: '600',
                      fontSize: '13px',
                      padding: '12px 16px',
                      backgroundColor: '#000000',
                      color: '#ffffff',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Chat on WhatsApp
                  </a>
                </div>
              </div>
            )}
            
            {/* Floating Bubble Button */}
            <button 
              onClick={() => setSupportWidgetOpen(!supportWidgetOpen)}
              style={{
                width: '56px',
                height: '56px',
                backgroundColor: '#000000',
                color: '#ffffff',
                border: '1px solid var(--border-color)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
                transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s',
                outline: 'none'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {supportWidgetOpen ? (
                <span style={{ fontSize: '24px', fontWeight: '300', lineHeight: 1 }}>×</span>
              ) : (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
                </svg>
              )}
            </button>
          </div>
        );
      })()}
    </>
  );
}

// ==========================================================================
// SUB-COMPONENTS (INLINE FOR CLEAN SPA STRUCTURE)
// ==========================================================================

function LoginView({ apiRequest, showToast, setCurrentUser, navigateTo }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      setCurrentUser(data.user);
      showToast(data.message, 'success');
      navigateTo('home');
    } catch (err) {}
  };

  return (
    <section id="view-login">
      <div className="auth-card">
        <h2 className="auth-title">Welcome Back</h2>
        <p className="auth-subtitle">Login to check your subscriptions and orders.</p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input 
              type="email" 
              id="login-email" 
              required 
              placeholder="name@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input 
              type="password" 
              id="login-password" 
              required 
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block">Log in</button>
        </form>
        <div className="auth-footer">
          <span>Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); navigateTo('register'); }}>Register here</a></span>
        </div>
      </div>
    </section>
  );
}

function RegisterView({ apiRequest, showToast, setCurrentUser, navigateTo }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await apiRequest('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      setCurrentUser(data.user);
      showToast(data.message, 'success');
      navigateTo('home');
    } catch (err) {}
  };

  return (
    <section id="view-register">
      <div className="auth-card">
        <h2 className="auth-title">Create Account</h2>
        <p className="auth-subtitle">Sign up to buy Premium subscriptions instantly.</p>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label htmlFor="register-email">Email Address</label>
            <input 
              type="email" 
              id="register-email" 
              required 
              placeholder="name@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="register-password">Password</label>
            <input 
              type="password" 
              id="register-password" 
              required 
              placeholder="Min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block">Register</button>
        </form>
        <div className="auth-footer">
          <span>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); navigateTo('login'); }}>Log in here</a></span>
        </div>
      </div>
    </section>
  );
}

function CheckoutView({ product, apiRequest, showToast, navigateTo, handleCopyUPI, settings, setCropperState }) {
  const [utrNumber, setUtrNumber] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (utrNumber.trim().length < 12) {
      showToast('UTR reference must be at least 12 characters.', 'warning');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('product_id', product.id);
    formData.append('utr_number', utrNumber.trim());
    if (screenshot) {
      formData.append('screenshot', screenshot);
    }

    try {
      const data = await apiRequest('/api/checkout', {
        method: 'POST',
        body: formData // multipart body contains file upload
      });
      showToast(data.message, 'success');
      navigateTo('orders');
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="view-checkout">
      <div className="back-nav">
        <a href="#" className="back-link" onClick={(e) => { e.preventDefault(); navigateTo('details'); }}>← Cancel and Back</a>
      </div>
      <div className="checkout-layout">
        
        {/* Invoice Summary */}
        <div className="checkout-invoice-card">
          <h2 className="card-title">Order Summary</h2>
          <div className="checkout-product-preview">
            <img src={resolveUrl(product.image_url)} alt={product.name} className="preview-img" />
            <div className="preview-details">
              <h4 className="preview-title">{product.name}</h4>
              <span className="preview-platform">{product.platform}</span>
            </div>
          </div>
          
          <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Stock Type</span>
              <strong style={{ color: 'var(--text-main)' }}>
                {product.stock_type === 'code' ? 'Promo Code / Key' :
                 product.stock_type === 'link' ? 'Invite Link' :
                 product.stock_type === 'credentials' ? 'Credentials' :
                 product.stock_type === 'login_code' ? 'Login with Code' : 'Voucher'}
              </strong>
            </div>
            {product.duration && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Duration</span>
                <strong style={{ color: 'var(--text-main)' }}>{product.duration}</strong>
              </div>
            )}
            {product.setup_type && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Setup Type</span>
                <strong style={{ color: 'var(--text-main)' }}>
                  {product.setup_type === 'on_your_mail' ? 'Account on Your Mail' : 'Account on My Mail'}
                </strong>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Inventory Status</span>
              <strong style={(product.stock_count > 0 || product.stock_type === 'login_code') ? { color: '#25D366' } : { color: 'var(--danger-color)' }}>
                {product.stock_type === 'login_code' ? 'WhatsApp Setup' : product.stock_count > 0 ? `${product.stock_count} units` : 'Out of Stock'}
              </strong>
            </div>
          </div>

          <hr className="divider" />
          <div className="price-row">
            <span>Subtotal</span>
            <span>{product.currency || '$'}{product.price.toFixed(2)}</span>
          </div>
          <div className="price-row">
            <span>Reconciliation Fee</span>
            <span className="text-success">FREE</span>
          </div>
          <hr className="divider" />
          <div className="price-row total-row">
            <span>Total Amount to Pay</span>
            <strong>{product.currency || '$'}{product.price.toFixed(2)}</strong>
          </div>
        </div>

        {/* Form Details */}
        <div className="checkout-payment-card">
          <h2 className="card-title">UTR Payment Verification</h2>
          <p className="payment-instructions">Follow the instructions below to make a payment. Once completed, enter the UTR/Reference ID to activate your subscription.</p>

          <div className="payment-instructions-box">
            {(() => {
              const cur = product.currency || '$';
              const isINR = cur === '₹' || cur.toUpperCase() === 'INR';
              const isEUR = cur === '€' || cur.toUpperCase() === 'EUR';

              if (isINR) {
                const upiId = settings?.upi_id || 'pay@getsubscribed';
                const upiQrUrl = settings?.upi_qr_url;
                const qrSrc = upiQrUrl 
                  ? resolveUrl(upiQrUrl) 
                  : `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=Getsubscribed`)}`;

                return (
                  <>
                    <div className="qr-code-section">
                      <img 
                        src={qrSrc} 
                        alt="UPI QR Code" 
                        className="qr-img" 
                        style={{ width: '150px', height: '150px', objectFit: 'contain', backgroundColor: '#fff', padding: '4px', borderRadius: '4px' }} 
                      />
                      <div className="qr-meta">
                        <span className="qr-label">Scan QR using any UPI App</span>
                        <strong className="upi-id-badge">{upiId}</strong>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleCopyUPI(upiId)}>Copy UPI ID</button>
                      </div>
                    </div>

                    <div className="bank-details-section">
                      <span className="or-separator">OR pay via Bank Transfer</span>
                      <table className="bank-table">
                        <tbody>
                          <tr><td>Bank Name:</td><td><strong>Getsubscribed Bank (India)</strong></td></tr>
                          <tr><td>Account Name:</td><td><strong>Getsubscribed Subscriptions Ltd</strong></td></tr>
                          <tr><td>Account No:</td><td><strong>9900887766</strong></td></tr>
                          <tr><td>IFSC Code:</td><td><strong>GSUB000123</strong></td></tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              } else if (isEUR) {
                return (
                  <div className="sepa-details-section" style={{ width: '100%' }}>
                    <span className="or-separator">SEPA Bank Transfer (Eurozone)</span>
                    <p className="payment-instructions" style={{ fontSize: '13px', marginTop: '5px' }}>
                      Transfer exact invoice amount to the European IBAN account:
                    </p>
                    <table className="bank-table" style={{ width: '100%', marginTop: '10px' }}>
                      <tbody>
                        <tr><td>Bank Name:</td><td><strong>Getsubscribed Europe Bank</strong></td></tr>
                        <tr><td>IBAN:</td><td><strong>BE89 3704 0044 0532 0130</strong></td></tr>
                        <tr><td>BIC / SWIFT:</td><td><strong>GSUBBE22XXX</strong></td></tr>
                        <tr><td>Account Name:</td><td><strong>Getsubscribed Subscriptions Ltd</strong></td></tr>
                      </tbody>
                    </table>
                  </div>
                );
              } else {
                return (
                  <div className="paypal-details-section" style={{ width: '100%' }}>
                    <span className="or-separator">Pay via PayPal / Credit Card</span>
                    <p className="payment-instructions" style={{ fontSize: '13px', marginTop: '5px' }}>
                      Send invoice amount to our PayPal account:
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', marginBottom: '15px' }}>
                      <strong className="upi-id-badge" style={{ margin: 0 }}>paypal@getsubscribed.online</strong>
                      <button 
                        type="button" 
                        className="btn btn-sm btn-secondary" 
                        onClick={() => {
                          navigator.clipboard.writeText('paypal@getsubscribed.online').then(() => {
                            showToast('PayPal email copied!', 'success');
                          });
                        }}
                      >
                        Copy Email
                      </button>
                    </div>
                    <span className="or-separator">OR pay via Bank Wire (USD)</span>
                    <table className="bank-table" style={{ width: '100%', marginTop: '10px' }}>
                      <tbody>
                        <tr><td>Bank Name:</td><td><strong>Getsubscribed US Bank</strong></td></tr>
                        <tr><td>Routing No:</td><td><strong>021000021</strong></td></tr>
                        <tr><td>Account No:</td><td><strong>123456789012</strong></td></tr>
                        <tr><td>Swift Code:</td><td><strong>GSUBUS33XXX</strong></td></tr>
                        <tr><td>Beneficiary:</td><td><strong>Getsubscribed Subscriptions LLC</strong></td></tr>
                      </tbody>
                    </table>
                  </div>
                );
              }
            })()}
          </div>

          <form onSubmit={onSubmit}>
            <div className="form-group">
              <label htmlFor="checkout-utr">Transaction Reference ID / UTR <span className="required">*</span></label>
              <input 
                type="text" 
                id="checkout-utr" 
                required 
                placeholder="Enter 12-digit UPI Ref No or Bank UTR"
                value={utrNumber}
                onChange={(e) => setUtrNumber(e.target.value)}
              />
              <span className="input-help">UTR is the unique 12-digit reference number generated after a successful payment.</span>
            </div>

            <div className="form-group">
              <label htmlFor="checkout-screenshot">Upload Payment Screenshot <span className="required-badge">(Recommended)</span></label>
              <div className="file-upload-wrapper">
                <input 
                  type="file" 
                  id="checkout-screenshot" 
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    setCropperState({
                      show: true,
                      file: file,
                      aspect: 'free', // Receipt screenshots use free cropping
                      onComplete: (croppedFile) => {
                        setScreenshot(croppedFile);
                      }
                    });
                  }}
                />
                <div className="upload-dummy-btn">
                  {screenshot ? `Selected: ${screenshot.name}` : 'Choose File or Take Photo'}
                </div>
              </div>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary btn-block btn-lg" 
              disabled={loading}
            >
              {loading ? 'Submitting order...' : 'Verify & Complete Purchase'}
            </button>
          </form>

        </div>
      </div>
    </section>
  );
}

function UserOrdersView({ orders, currentUser, showToast }) {
  return (
    <section id="view-orders">
      <div className="section-header">
        <h2 class="section-title">My Purchased Subscriptions</h2>
        <p class="section-subtitle">Below is a list of your subscriptions, order credentials, and UTR verification status.</p>
      </div>

      <div className="orders-list">
        {orders.length === 0 ? (
          <div className="no-orders-msg">You have not placed any orders yet.</div>
        ) : (
          orders.map(order => {
            let statusBadge = <span className="badge badge-pending">Verification Pending</span>;
            if (order.status === 'approved') statusBadge = <span className="badge badge-approved">Completed</span>;
            if (order.status === 'rejected') statusBadge = <span className="badge badge-rejected">Rejected</span>;
            
            const date = new Date(order.created_at).toLocaleDateString('en-US', {
              year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            return (
              <div key={order.id} className="order-item-card">
                <img src={resolveUrl(order.image_url)} alt={order.product_name} className="preview-img" />
                <div className="order-info-col">
                  <div className="order-title-row">
                    <span className="order-p-name">{order.product_name}</span>
                    {statusBadge}
                  </div>
                  <span className="order-utr-text">Reference UTR: <strong>{order.utr_number}</strong></span>
                  <span className="order-date-text">Submitted on {date}</span>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                    <a 
                      href={`https://wa.me/917017750272?text=${encodeURIComponent(`Hello support! I need help with my order.\nItem Name: ${order.product_name}\nQuantity: 1\nUTR Reference: ${order.utr_number}`)}`} 
                      target="_blank" 
                      rel="noreferrer"
                      style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      Need Help? Chat on WhatsApp
                    </a>
                    <a 
                      href={`mailto:support@getsubscribed.online?subject=${encodeURIComponent(`Help Request - UTR: ${order.utr_number}`)}&body=${encodeURIComponent(`Hello support team!\n\nI need help with my order.\n\nOrder Details:\nItem Name: ${order.product_name}\nQuantity: 1\nUTR Reference: ${order.utr_number}\n\nThank you!`)}`} 
                      style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      ✉ Need Help? Contact via Email
                    </a>
                  </div>
                </div>
                <div className="order-price-col">
                  <strong className="product-price">{order.currency || '$'}{order.amount.toFixed(2)}</strong>
                </div>
                
                {order.status === 'approved' && (
                  <div className="delivery-box">
                    <div className="delivery-title">Order Access Credentials</div>
                    <div className="delivery-content">
                      {order.key_value ? (
                        <div style={{ marginTop: '5px' }}>
                          {order.key_type === 'link' ? (
                            <div>
                              <span style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Your Invite Link:</span>
                              <a 
                                href={order.key_value} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="btn btn-primary btn-sm" 
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                              >
                                🔗 Join Subscription / Claim Invite Link
                              </a>
                            </div>
                          ) : order.key_type === 'credentials' ? (
                            <div>
                              <span style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Account Credentials:</span>
                              {(() => {
                                const parts = order.key_value.split(':');
                                if (parts.length >= 2) {
                                  const emailPart = parts[0].trim();
                                  const passPart = parts.slice(1).join(':').trim();
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                                        <span><strong>Email:</strong> <code style={{ fontFamily: 'monospace' }}>{emailPart}</code></span>
                                        <button 
                                          className="btn btn-secondary btn-xs" 
                                          style={{ padding: '2px 6px', fontSize: '11px' }}
                                          onClick={() => {
                                            navigator.clipboard.writeText(emailPart);
                                            showToast('Email copied to clipboard!');
                                          }}
                                        >
                                          Copy
                                        </button>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                                        <span><strong>Password:</strong> <code style={{ fontFamily: 'monospace' }}>{passPart}</code></span>
                                        <button 
                                          className="btn btn-secondary btn-xs" 
                                          style={{ padding: '2px 6px', fontSize: '11px' }}
                                          onClick={() => {
                                            navigator.clipboard.writeText(passPart);
                                            showToast('Password copied to clipboard!');
                                          }}
                                        >
                                          Copy
                                        </button>
                                      </div>
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                                      <code style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{order.key_value}</code>
                                      <button 
                                        className="btn btn-secondary btn-xs" 
                                        style={{ padding: '2px 6px', fontSize: '11px' }}
                                        onClick={() => {
                                          navigator.clipboard.writeText(order.key_value);
                                          showToast('Credentials copied!');
                                        }}
                                      >
                                        Copy
                                      </button>
                                    </div>
                                  );
                                }
                              })()}
                            </div>
                          ) : order.key_type === 'login_code' ? (
                            <div>
                              <div style={{ backgroundColor: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', borderRadius: '6px', padding: '12px', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                <p style={{ margin: '0 0 10px 0' }}>💡 <strong>Manual Setup Required:</strong> This subscription uses <strong>Login with Code</strong>. Please connect with our support team on WhatsApp or Email to complete your login procedure.</p>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
                                  <a 
                                    href={`https://wa.me/917017750272?text=${encodeURIComponent(`Hi support!\n\nI ordered ${order.product_name} (Login with Code).\n\nOrder Details:\nQuantity: 1\nUTR Reference: ${order.utr_number}`)}`} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="btn btn-xs" 
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', backgroundColor: '#25D366', borderColor: '#25D366', color: '#fff', padding: '6px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: '600' }}
                                  >
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style={{ marginRight: '2px' }}>
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                    </svg>
                                    Go to WhatsApp for Login
                                  </a>
                                  <a 
                                    href={`mailto:support@getsubscribed.online?subject=${encodeURIComponent(`Login Setup Request - UTR: ${order.utr_number}`)}&body=${encodeURIComponent(`Hello support team!\n\nI need to set up my Login with Code subscription.\n\nOrder Details:\nItem Name: ${order.product_name}\nQuantity: 1\nUTR Reference: ${order.utr_number}\n\nThank you!`)}`} 
                                    className="btn btn-secondary btn-xs" 
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                                  >
                                    ✉️ Proceed via Email
                                  </a>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Coupon / Voucher Code:</span>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: 'var(--bg-surface-elevated)', border: '2px dashed var(--border-color)', borderRadius: '6px' }}>
                                <code style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{order.key_value}</code>
                                <button 
                                  className="btn btn-secondary btn-xs" 
                                  style={{ padding: '2px 6px', fontSize: '11px' }}
                                  onClick={() => {
                                    navigator.clipboard.writeText(order.key_value);
                                    showToast('Code copied to clipboard!');
                                  }}
                                >
                                  Copy
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        `Your subscription is active! Check your registered email (${currentUser?.email}) or contact support with UTR ${order.utr_number} for custom credential activation.`
                      )}

                      <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                        <a 
                          href={`https://wa.me/917017750272?text=${encodeURIComponent(`Hi, my order is completed. Reference UTR: ${order.utr_number}`)}`} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="btn btn-secondary btn-sm" 
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                          Chat on WhatsApp for completed order
                        </a>
                      </div>
                    </div>
                  </div>
                )}
                
                {order.status === 'rejected' && (
                  <div className="rejection-box">
                    <div className="rejection-title">Rejection Reason</div>
                    <div className="rejection-content">{order.rejection_reason || 'No reason specified. Please check your transaction reference.'}</div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function AdminPanelView({ 
  orders, 
  products, 
  adminTab, 
  setAdminTab, 
  newProduct, 
  setNewProduct, 
  setRejectionModal,
  loadAdminOrders, 
  loadProducts, 
  apiRequest, 
  showToast,
  settings,
  loadSettings,
  confirmModal,
  setConfirmModal,
  setEditUTRModal,
  analytics,
  loadingAnalytics,
  loadAnalytics,
  adminUsers,
  loadingAdminUsers,
  loadAdminUsers,
  editKeyModal,
  setEditKeyModal,
  setCropperState,
  currentUser
}) {
  const [productImageFile, setProductImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [currencySelect, setCurrencySelect] = useState('$');
  const [editingProduct, setEditingProduct] = useState(null);

  useEffect(() => {
    if (!productImageFile) {
      setImagePreviewUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(productImageFile);
    setImagePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [productImageFile]);

  const [upiIdInput, setUpiIdInput] = useState(settings?.upi_id || '');
  const [upiQrUrlInput, setUpiQrUrlInput] = useState(settings?.upi_qr_url || '');
  const [qrImageFile, setQrImageFile] = useState(null);
  const [resendApiKeyInput, setResendApiKeyInput] = useState(settings?.resend_api_key || '');
  const [emailFromInput, setEmailFromInput] = useState(settings?.email_from || '');

  // Reconciliation states
  const [utrText, setUtrText] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [filterStockType, setFilterStockType] = useState('all');

  const handleBanUser = (user) => {
    setConfirmModal({
      show: true,
      title: `Ban User: ${user.email}`,
      message: `Are you sure you want to ban this user? They will not be able to log in or make purchases.`,
      requireTextConfirm: true,
      confirmInput: '',
      onConfirm: async () => {
        try {
          const res = await apiRequest(`/api/admin/users/${user.id}/ban`, { method: 'POST' });
          showToast(res.message || 'User banned successfully.', 'success');
          loadAdminUsers();
        } catch (err) {
          showToast(err.message || 'Failed to ban user.', 'error');
        }
      }
    });
  };

  const handleUnbanUser = (user) => {
    setConfirmModal({
      show: true,
      title: `Unban User: ${user.email}`,
      message: `Are you sure you want to unban this user? They will be able to log in and make purchases again.`,
      requireTextConfirm: false,
      confirmInput: '',
      onConfirm: async () => {
        try {
          const res = await apiRequest(`/api/admin/users/${user.id}/unban`, { method: 'POST' });
          showToast(res.message || 'User unbanned successfully.', 'success');
          loadAdminUsers();
        } catch (err) {
          showToast(err.message || 'Failed to unban user.', 'error');
        }
      }
    });
  };

  // Stock management states
  const [activeStockProduct, setActiveStockProduct] = useState(null);
  const [stockKeys, setStockKeys] = useState([]);
  const [newKeysText, setNewKeysText] = useState('');
  const [submittingKeys, setSubmittingKeys] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);

  const [orderSearchQuery, setOrderSearchQuery] = useState('');

  // --- Stock Options States ---
  const [ottPlatforms, setOttPlatforms] = useState([]);
  const [selectedOtt, setSelectedOtt] = useState(null);
  const [newOttName, setNewOttName] = useState('');
  const [selectedProductForStock, setSelectedProductForStock] = useState('');
  const [stockUploadType, setStockUploadType] = useState('code');
  const [stockUploadText, setStockUploadText] = useState('');
  const [ottProducts, setOttProducts] = useState([]);
  const [stockTabKeys, setStockTabKeys] = useState([]);
  const [loadingStockTabKeys, setLoadingStockTabKeys] = useState(false);

  const loadOttPlatforms = async () => {
    try {
      const data = await apiRequest('/api/admin/ott-platforms');
      setOttPlatforms(data);
      if (data.length > 0 && !selectedOtt) {
        setSelectedOtt(data[0]);
      }
    } catch (err) {
      showToast('Failed to load OTT platforms', 'error');
    }
  };

  useEffect(() => {
    if (adminTab === 'stock') {
      loadOttPlatforms();
    }
  }, [adminTab]);

  useEffect(() => {
    if (selectedOtt) {
      const filteredProds = products.filter(p => p.platform.toLowerCase() === selectedOtt.name.toLowerCase());
      setOttProducts(filteredProds);
      if (filteredProds.length > 0) {
        setSelectedProductForStock(filteredProds[0].id);
      } else {
        setSelectedProductForStock('');
        setStockTabKeys([]);
      }
    }
  }, [selectedOtt, products]);

  const loadStockTabKeys = async (productId) => {
    if (!productId) {
      setStockTabKeys([]);
      return;
    }
    setLoadingStockTabKeys(true);
    try {
      const data = await apiRequest(`/api/admin/products/${productId}/keys`);
      setStockTabKeys(data);
    } catch (err) {
      showToast('Failed to load keys', 'error');
    } finally {
      setLoadingStockTabKeys(false);
    }
  };

  useEffect(() => {
    if (selectedProductForStock) {
      loadStockTabKeys(selectedProductForStock);
    } else {
      setStockTabKeys([]);
    }
  }, [selectedProductForStock]);

  const handleAddOttPlatform = async (e) => {
    e.preventDefault();
    if (!newOttName.trim()) return;
    try {
      const data = await apiRequest('/api/admin/ott-platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOttName })
      });
      showToast(data.message, 'success');
      setNewOttName('');
      const updatedPlatforms = await apiRequest('/api/admin/ott-platforms');
      setOttPlatforms(updatedPlatforms);
      const matched = updatedPlatforms.find(p => p.name.toLowerCase() === data.platform.name.toLowerCase());
      if (matched) {
        setSelectedOtt(matched);
      }
    } catch (err) {
      showToast(err.message || 'Failed to add OTT platform', 'error');
    }
  };

  const handleUploadStockTabKeys = async (e) => {
    e.preventDefault();
    if (!selectedProductForStock || !stockUploadText.trim()) return;

    const rawLines = stockUploadText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (rawLines.length === 0) {
      showToast('Please enter at least one valid item.', 'warning');
      return;
    }

    let formattedText = '';
    if (stockUploadType === 'credentials') {
      const invalid = rawLines.some(l => !l.includes(':'));
      if (invalid) {
        showToast('Credentials must be in Email:Password format (e.g. user@test.com:pass123)', 'error');
        return;
      }
      formattedText = rawLines.map(l => {
        const parts = l.split(':');
        const email = parts[0].trim();
        const pass = parts.slice(1).join(':').trim();
        return `Email: ${email} | Pass: ${pass}`;
      }).join('\n');
    } else if (stockUploadType === 'link') {
      const invalid = rawLines.some(l => !l.startsWith('http'));
      if (invalid) {
        showToast('Invite links must start with http:// or https://', 'error');
        return;
      }
      formattedText = rawLines.join('\n');
    } else {
      formattedText = rawLines.join('\n');
    }

    try {
      const data = await apiRequest(`/api/admin/products/${selectedProductForStock}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          keys_text: formattedText,
          type: stockUploadType
        })
      });
      showToast(data.message, 'success');
      setStockUploadText('');
      loadStockTabKeys(selectedProductForStock);
      loadProducts();
    } catch (err) {
      showToast(err.message || 'Failed to add stock items', 'error');
    }
  };

  const handleDeleteStockTabKey = (keyId) => {
    setConfirmModal({
      show: true,
      title: 'Delete Stock Item',
      message: 'Are you sure you want to delete this stock item from inventory? You must type CONFIRM to proceed.',
      requireTextConfirm: true,
      confirmInput: '',
      onConfirm: async () => {
        try {
          const data = await apiRequest(`/api/admin/keys/${keyId}`, {
            method: 'DELETE'
          });
          showToast(data.message, 'success');
          loadStockTabKeys(selectedProductForStock);
          loadProducts();
        } catch (err) {
          showToast(err.message || 'Failed to delete key', 'error');
        }
      }
    });
  };

  useEffect(() => {
    if (settings) {
      setUpiIdInput(settings.upi_id || '');
      setUpiQrUrlInput(settings.upi_qr_url || '');
      setResendApiKeyInput(settings.resend_api_key || '');
      setEmailFromInput(settings.email_from || '');
    }
  }, [settings]);

  // Calculate sales grouped by currency
  const salesByCurrency = orders
    .filter(o => o.status === 'approved')
    .reduce((acc, o) => {
      const cur = o.currency || '$';
      acc[cur] = (acc[cur] || 0) + o.amount;
      return acc;
    }, {});

  const filteredOrders = orders.filter(order => {
    const query = orderSearchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      order.utr_number.toLowerCase().includes(query) ||
      (order.id && order.id.toLowerCase().includes(query)) ||
      (order.user_email && order.user_email.toLowerCase().includes(query)) ||
      (order.product_name && order.product_name.toLowerCase().includes(query))
    );
  });

  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const completedCount = orders.filter(o => o.status === 'approved').length;
  const productsCount = products.length;

  const handleStartEdit = (prod) => {
    setEditingProduct(prod);
    setNewProduct({
      name: prod.name,
      description: prod.description,
      price: prod.price.toString(),
      currency: prod.currency || '$',
      platform: prod.platform,
      category: prod.category,
      image_url: prod.image_url,
      setup_type: prod.setup_type || '',
      duration: prod.duration || '',
      stock_type: prod.stock_type || 'code'
    });

    const standardCurrencies = ['$', '₹', '€', '£', '¥'];
    if (standardCurrencies.includes(prod.currency)) {
      setCurrencySelect(prod.currency);
    } else {
      setCurrencySelect('custom');
    }

    setProductImageFile(null);
    const fileInput = document.getElementById('admin-prod-image-file');
    if (fileInput) fileInput.value = '';

    const formCard = document.querySelector('.admin-product-form-card');
    if (formCard) {
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCancelEdit = () => {
    setEditingProduct(null);
    setNewProduct({
      name: '',
      description: '',
      price: '',
      currency: '$',
      platform: '',
      category: 'OTT Subscriptions',
      image_url: '',
      setup_type: '',
      duration: '',
      stock_type: 'code'
    });
    setProductImageFile(null);
    setCurrencySelect('$');
    const fileInput = document.getElementById('admin-prod-image-file');
    if (fileInput) fileInput.value = '';
  };

  const handleSubmitProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.image_url && !productImageFile) {
      showToast('Please provide an image URL or upload an image file.', 'error');
      return;
    }

    try {
      let data;
      const isEditing = !!editingProduct;
      const url = isEditing ? `/api/products/${editingProduct.id}` : '/api/products';
      const method = isEditing ? 'PUT' : 'POST';

      if (productImageFile) {
        const formData = new FormData();
        formData.append('name', newProduct.name);
        formData.append('description', newProduct.description);
        formData.append('price', parseFloat(newProduct.price));
        formData.append('currency', newProduct.currency);
        formData.append('platform', newProduct.platform);
        formData.append('category', newProduct.category);
        formData.append('setup_type', newProduct.setup_type || '');
        formData.append('duration', newProduct.duration || '');
        formData.append('stock_type', newProduct.stock_type || 'code');
        formData.append('product_image', productImageFile);
        if (newProduct.image_url) {
          formData.append('image_url', newProduct.image_url);
        }

        data = await apiRequest(url, {
          method: method,
          body: formData
        });
      } else {
        data = await apiRequest(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...newProduct,
            price: parseFloat(newProduct.price)
          })
        });
      }

      showToast(data.message, 'success');
      
      // Reset form and state
      setEditingProduct(null);
      setNewProduct({
        name: '',
        description: '',
        price: '',
        currency: '$',
        platform: '',
        category: 'OTT Subscriptions',
        image_url: '',
        setup_type: '',
        duration: '',
        stock_type: 'code'
      });
      setProductImageFile(null);
      setCurrencySelect('$');

      // Reset the file input element in the browser
      const fileInput = document.getElementById('admin-prod-image-file');
      if (fileInput) fileInput.value = '';

      loadProducts();
    } catch (err) {}
  };

  const handleDeleteProduct = (productId) => {
    setConfirmModal({
      show: true,
      title: 'Delete Product',
      message: 'Are you sure you want to delete this product? This will permanently remove it from the catalog.',
      requireTextConfirm: true,
      confirmInput: '',
      onConfirm: async () => {
        try {
          if (editingProduct && editingProduct.id === productId) {
            handleCancelEdit();
          }
          const data = await apiRequest(`/api/products/${productId}`, {
            method: 'DELETE'
          });
          showToast(data.message, 'success');
          loadProducts();
        } catch (err) {}
      }
    });
  };

  const handleApprove = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const isUnverifiedOrUnchecked = !order.is_verified || order.is_verified === 'unverified' || order.is_verified === 'unchecked';
    
    setConfirmModal({
      show: true,
      title: 'Approve Order',
      message: `Are you sure you want to APPROVE this payment transaction? This will mark the order as Completed.${isUnverifiedOrUnchecked ? ' Since this order is unverified or unchecked, you must confirm this action.' : ''}`,
      requireTextConfirm: isUnverifiedOrUnchecked,
      confirmInput: '',
      onConfirm: async () => {
        try {
          const data = await apiRequest(`/api/admin/orders/${orderId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'approved' })
          });
          showToast(data.message, 'success');
          loadAdminOrders();
        } catch (err) {}
      }
    });
  };

  const handleDeleteOrder = (orderId) => {
    setConfirmModal({
      show: true,
      title: 'Delete Order',
      message: 'Are you sure you want to delete this order? This will permanently remove the order record and release any claimed invite credentials back to inventory.',
      requireTextConfirm: true,
      confirmInput: '',
      onConfirm: async () => {
        try {
          const data = await apiRequest(`/api/admin/orders/${orderId}`, {
            method: 'DELETE'
          });
          showToast(data.message, 'success');
          loadAdminOrders();
        } catch (err) {
          showToast(err.message || 'Failed to delete order', 'error');
        }
      }
    });
  };

  const handleSaveSettings = (e) => {
    e.preventDefault();
    
    // Check if custom QR is configured (either by local file upload or custom URL)
    const hasCustomQR = qrImageFile || upiQrUrlInput.trim();
    
    const modalTitle = hasCustomQR ? 'Confirm Settings Modification' : 'Confirm Settings (No Custom QR)';
    const modalMessage = hasCustomQR
      ? 'Are you sure you want to save these system settings? This will update system-wide configurations, including payment UPI details and email credentials.'
      : 'You have not uploaded a custom QR image file or specified a custom QR URL. The payment gateway will automatically fall back to generating a dynamic QR code based on your UPI address. Are you sure you want to continue?';

    setConfirmModal({
      show: true,
      title: modalTitle,
      message: modalMessage,
      requireTextConfirm: true,
      confirmInput: '',
      onConfirm: async () => {
        try {
          let data;
          if (qrImageFile) {
            const formData = new FormData();
            formData.append('upi_id', upiIdInput);
            formData.append('qr_image', qrImageFile);
            if (upiQrUrlInput) {
              formData.append('upi_qr_url', upiQrUrlInput);
            }
            formData.append('resend_api_key', resendApiKeyInput);
            formData.append('email_from', emailFromInput);
            data = await apiRequest('/api/admin/settings', {
              method: 'PUT',
              body: formData
            });
          } else {
            data = await apiRequest('/api/admin/settings', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                upi_id: upiIdInput,
                upi_qr_url: upiQrUrlInput,
                resend_api_key: resendApiKeyInput,
                email_from: emailFromInput
              })
            });
          }

          showToast(data.message, 'success');
          setQrImageFile(null);
          const fileInput = document.getElementById('admin-qr-image-file');
          if (fileInput) fileInput.value = '';
          loadSettings();
        } catch (err) {}
      }
    });
  };

  const handleRemoveCustomQR = () => {
    setConfirmModal({
      show: true,
      title: 'Remove Custom QR Code',
      message: 'Are you sure you want to remove the custom QR code image? This will clear the custom image setting and restore the auto-generated dynamic QR code based on your UPI ID. You must type CONFIRM to proceed.',
      requireTextConfirm: true,
      confirmInput: '',
      onConfirm: async () => {
        try {
          const data = await apiRequest('/api/admin/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              upi_qr_url: '' // Clears the custom QR URL on the server
            })
          });
          showToast('Custom QR code removed. Auto-generated QR restored.', 'success');
          setUpiQrUrlInput('');
          setQrImageFile(null);
          const fileInput = document.getElementById('admin-qr-image-file');
          if (fileInput) fileInput.value = '';
          loadSettings();
        } catch (err) {
          showToast(err.message || 'Failed to remove custom QR code', 'error');
        }
      }
    });
  };

  // --- Bulk UTR Reconciliation Helper ---
  const handleBulkReconcile = async (e) => {
    e.preventDefault();
    if (!utrText.trim()) return;
    setReconciling(true);
    setReconcileResult(null);
    try {
      const data = await apiRequest('/api/admin/reconcile-utrs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utr_list: utrText })
      });
      setReconcileResult(data);
      showToast(data.message, 'success');
      loadAdminOrders();
    } catch (err) {
      showToast(err.message || 'Failed to reconcile UTRs', 'error');
    } finally {
      setReconciling(false);
    }
  };

  const handleReconcileFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setUtrText(evt.target.result);
      showToast(`Loaded content from ${file.name}`, 'success');
    };
    reader.onerror = () => {
      showToast('Error reading file', 'error');
    };
    reader.readAsText(file);
  };

  // --- Stock / Key Management Helpers ---
  const handleOpenStockModal = async (prod) => {
    setActiveStockProduct(prod);
    setNewKeysText('');
    setLoadingKeys(true);
    try {
      const data = await apiRequest(`/api/admin/products/${prod.id}/keys`);
      setStockKeys(data);
    } catch (err) {
      showToast('Failed to load keys', 'error');
    } finally {
      setLoadingKeys(false);
    }
  };

  const handleAddKeys = async (e) => {
    e.preventDefault();
    if (!newKeysText.trim() || !activeStockProduct) return;
    setSubmittingKeys(true);
    try {
      const data = await apiRequest(`/api/admin/products/${activeStockProduct.id}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys_text: newKeysText })
      });
      showToast(data.message, 'success');
      setNewKeysText('');
      // Reload keys
      const updatedKeys = await apiRequest(`/api/admin/products/${activeStockProduct.id}/keys`);
      setStockKeys(updatedKeys);
    } catch (err) {
      showToast(err.message || 'Failed to add keys', 'error');
    } finally {
      setSubmittingKeys(false);
    }
  };

  const handleDeleteKey = (keyId) => {
    setConfirmModal({
      show: true,
      title: 'Delete Stock Key/Link',
      message: 'Are you sure you want to delete this stock key/link from inventory? This action is irreversible.',
      requireTextConfirm: true,
      confirmInput: '',
      onConfirm: async () => {
        try {
          const data = await apiRequest(`/api/admin/keys/${keyId}`, {
            method: 'DELETE'
          });
          showToast(data.message, 'success');
          // Reload keys
          const updatedKeys = await apiRequest(`/api/admin/products/${activeStockProduct.id}/keys`);
          setStockKeys(updatedKeys);
        } catch (err) {
          showToast(err.message || 'Failed to delete key', 'error');
        }
      }
    });
  };

  return (
    <section id="view-admin">
      <div className="admin-header">
        <h2 className="section-title">Admin Console</h2>
        <p className="section-subtitle">Verify manual UTR payments and manage product listings.</p>
      </div>

      {/* Admin Quick Stats Dashboard */}
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <span className="admin-stat-label">Total Revenue</span>
          <div className="admin-revenue-breakdown" style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
            {Object.entries(salesByCurrency).length > 0 ? (
              Object.entries(salesByCurrency).map(([cur, amt]) => (
                <strong key={cur} className="admin-stat-value" style={{ display: 'block', fontSize: '1.25rem', lineHeight: '1.2' }}>
                  {cur}{amt.toFixed(2)}
                </strong>
              ))
            ) : (
              <strong className="admin-stat-value">$0.00</strong>
            )}
          </div>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Pending Approvals</span>
          <strong className="admin-stat-value">{pendingCount}</strong>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Completed Orders</span>
          <strong className="admin-stat-value">{completedCount}</strong>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-label">Active Products</span>
          <strong className="admin-stat-value">{productsCount}</strong>
        </div>
      </div>

      <div className="admin-tabs">
        <button 
          className={`admin-tab-btn ${adminTab === 'orders' ? 'active' : ''}`}
          onClick={() => { setAdminTab('orders'); loadAdminOrders(); }}
        >
          Verify Orders ({orders.filter(o => o.status === 'pending').length})
        </button>
        <button 
          className={`admin-tab-btn ${adminTab === 'products' ? 'active' : ''}`}
          onClick={() => { setAdminTab('products'); loadProducts(); }}
        >
          Manage Products
        </button>
        <button 
          className={`admin-tab-btn ${adminTab === 'settings' ? 'active' : ''}`}
          onClick={() => { setAdminTab('settings'); loadSettings(); }}
        >
          Payment Settings
        </button>
        <button 
          className={`admin-tab-btn ${adminTab === 'stock' ? 'active' : ''}`}
          onClick={() => { setAdminTab('stock'); }}
        >
          Stock Options
        </button>
        <button 
          className={`admin-tab-btn ${adminTab === 'analytics' ? 'active' : ''}`}
          onClick={() => { setAdminTab('analytics'); loadAnalytics(); }}
        >
          Analytics
        </button>
        <button 
          className={`admin-tab-btn ${adminTab === 'users' ? 'active' : ''}`}
          onClick={() => { setAdminTab('users'); loadAdminUsers(); }}
        >
          Users
        </button>
      </div>

      {adminTab === 'orders' && (
        <div className="admin-tab-content">
          {/* Bulk UTR Reconciliation Card */}
          <div className="admin-settings-card" style={{ marginBottom: '25px', width: '100%', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '20px' }}>
            <h3 className="card-subtitle" style={{ marginBottom: '10px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bulk UTR Reconciliation</h3>
            <p className="input-help" style={{ marginBottom: '15px' }}>
              Paste raw bank SMS alerts, copy-pasted transaction text, or upload a text/CSV file containing 12-digit UTR numbers to automatically approve pending orders in bulk.
            </p>
            
            <form onSubmit={handleBulkReconcile}>
              <div className="form-group">
                <label htmlFor="reconcile-utr-list">Transaction Text / UTR List</label>
                <textarea
                  id="reconcile-utr-list"
                  placeholder="Paste SMS text or raw list here... (e.g., 'Received Rs 500 from UTR 123456789012')"
                  rows={4}
                  value={utrText}
                  onChange={(e) => setUtrText(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '14px' }}
                />
              </div>
              
              <div className="form-row" style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 250px', marginBottom: 0 }}>
                  <label htmlFor="reconcile-file-upload" style={{ display: 'block', marginBottom: '5px' }}>Or upload file (.txt, .csv)</label>
                  <input
                    type="file"
                    id="reconcile-file-upload"
                    accept=".txt,.csv"
                    onChange={handleReconcileFileUpload}
                    style={{ display: 'none' }}
                  />
                  <div 
                    className="upload-dummy-btn"
                    onClick={() => document.getElementById('reconcile-file-upload').click()}
                    style={{ fontSize: '13px', padding: '10px', textAlign: 'center', cursor: 'pointer', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-card)' }}
                  >
                    Select Text or CSV file
                  </div>
                </div>
                
                <div style={{ flex: '0 0 auto', display: 'flex', gap: '10px', marginTop: 'auto' }}>
                  <button type="submit" className="btn btn-primary" disabled={reconciling || !utrText.trim()}>
                    {reconciling ? 'Processing...' : 'Run Reconciliation'}
                  </button>
                  {utrText && (
                    <button type="button" className="btn btn-secondary" onClick={() => setUtrText('')}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </form>

            {reconcileResult && (
              <div style={{ marginTop: '20px', padding: '15px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 10px 0' }}>Reconciliation Result:</h4>
                <p style={{ fontSize: '13px', margin: '0 0 15px 0' }}>{reconcileResult.message}</p>
                
                {reconcileResult.verifiedOrders && reconcileResult.verifiedOrders.length > 0 && (
                  <div style={{ marginBottom: '15px' }}>
                    <h5 style={{ fontSize: '12px', fontWeight: 'bold', color: '#2e7d32', margin: '0 0 5px 0' }}>✓ Verified Orders (UTR Match Found):</h5>
                    <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '2px 0' }}>UTR</th>
                            <th style={{ padding: '2px 0' }}>User</th>
                            <th style={{ padding: '2px 0' }}>Product</th>
                            <th style={{ padding: '2px 0' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconcileResult.verifiedOrders.map((ord, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '3px 0', fontFamily: 'monospace' }}>{ord.utr_number}</td>
                              <td style={{ padding: '3px 0' }}>{ord.user_email}</td>
                              <td style={{ padding: '3px 0' }}>{ord.product_name}</td>
                              <td style={{ padding: '3px 0' }}>{ord.currency}{ord.amount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {reconcileResult.unverifiedOrders && reconcileResult.unverifiedOrders.length > 0 && (
                  <div>
                    <h5 style={{ fontSize: '12px', fontWeight: 'bold', color: '#c62828', margin: '0 0 5px 0' }}>✗ Unverified Orders (No Match in Uploaded List):</h5>
                    <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '2px 0' }}>UTR</th>
                            <th style={{ padding: '2px 0' }}>User</th>
                            <th style={{ padding: '2px 0' }}>Product</th>
                            <th style={{ padding: '2px 0' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reconcileResult.unverifiedOrders.map((ord, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '3px 0', fontFamily: 'monospace' }}>{ord.utr_number}</td>
                              <td style={{ padding: '3px 0' }}>{ord.user_email}</td>
                              <td style={{ padding: '3px 0' }}>{ord.product_name}</td>
                              <td style={{ padding: '3px 0' }}>{ord.currency}{ord.amount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: '20px', maxWidth: '400px' }}>
            <label htmlFor="admin-order-search" style={{ fontWeight: '600', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Search Orders</label>
            <div className="search-wrapper" style={{ position: 'relative' }}>
              <input
                id="admin-order-search"
                type="text"
                placeholder="Search by UTR, Order ID, Email, Product..."
                value={orderSearchQuery}
                onChange={(e) => setOrderSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--input-bg)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.2s ease',
                }}
              />
              {orderSearchQuery && (
                <button
                  type="button"
                  onClick={() => setOrderSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '4px',
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>User</th>
                  <th>Product</th>
                  <th>Amount</th>
                  <th>UTR Reference</th>
                  <th>Match Status</th>
                  <th>Proof screenshot</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="text-center">
                      {orders.length === 0 ? "No orders registered on the platform." : "No orders found matching your search query."}
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map(order => {
                    const date = new Date(order.created_at).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric'
                    });

                    return (
                      <tr key={order.id}>
                        <td>{date}</td>
                        <td>{order.user_email}</td>
                        <td>
                          <strong>{order.product_name}</strong> 
                          <span className="platform-badge" style={{ position: 'static', marginLeft: '6px' }}>{order.platform}</span>
                        </td>
                        <td><strong>{order.currency || '$'}{order.amount.toFixed(2)}</strong></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <code>{order.utr_number}</code>
                            {['pending', 'rejected'].includes(order.status) && (
                              <button 
                                className="btn btn-sm btn-secondary" 
                                style={{ padding: '2px 6px', fontSize: '10px', minHeight: 'auto', display: 'inline-flex', alignItems: 'center' }}
                                onClick={() => setEditUTRModal({ show: true, orderId: order.id, utrNumber: order.utr_number })}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          {order.is_verified === 'verified' ? (
                            <span className="platform-badge" style={{ position: 'static', backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9', padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                              ✓ VERIFIED
                            </span>
                          ) : order.is_verified === 'unverified' ? (
                            <span className="platform-badge" style={{ position: 'static', backgroundColor: '#ffebee', color: '#c62828', border: '1px solid #ffcdd2', padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                              ✗ NO MATCH
                            </span>
                          ) : (
                            <span className="platform-badge" style={{ position: 'static', backgroundColor: '#f5f5f5', color: '#757575', border: '1px solid #e0e0e0', padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                              UNCHECKED
                            </span>
                          )}
                        </td>
                        <td>
                          {order.screenshot_path ? (
                            <a href={resolveUrl(order.screenshot_path)} target="_blank" rel="noreferrer">
                              <img src={resolveUrl(order.screenshot_path)} alt="Receipt" className="admin-orders-screenshot-preview" />
                            </a>
                          ) : (
                            <span className="text-muted">None</span>
                          )}
                        </td>
                        <td className="admin-actions-td" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {order.status === 'pending' ? (
                            <>
                              <button className="btn btn-primary btn-sm" onClick={() => handleApprove(order.id)}>Approve</button>
                              <button 
                                className="btn btn-danger btn-sm" 
                                onClick={() => setRejectionModal({ show: true, orderId: order.id, reason: '' })}
                              >
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className="text-muted" style={{ marginRight: '6px' }}>{order.status}</span>
                          )}
                          <button 
                            className="btn btn-danger btn-sm" 
                            style={{ backgroundColor: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                            onClick={() => handleDeleteOrder(order.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adminTab === 'products' && (
        <div className="admin-tab-content">
          <div className="admin-products-layout">
            
            {/* Add/Edit product form */}
            <div className="admin-product-form-card">
              <h3 className="card-subtitle">
                {editingProduct ? `Edit Product: ${editingProduct.name}` : 'Add New Product'}
              </h3>
              <form onSubmit={handleSubmitProduct}>
                <div className="form-group">
                  <label htmlFor="admin-prod-name">Product Name</label>
                  <input 
                    type="text" 
                    id="admin-prod-name" 
                    required 
                    placeholder="e.g. Netflix Premium (1 Month)"
                    value={newProduct.name}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="admin-prod-desc">Description</label>
                  <textarea 
                    id="admin-prod-desc" 
                    required 
                    placeholder="Deliverables details, screen counts, credentials location..."
                    value={newProduct.description}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group col">
                    <label htmlFor="admin-prod-price">Price</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      id="admin-prod-price" 
                      required 
                      placeholder="4.99"
                      value={newProduct.price}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, price: e.target.value }))}
                    />
                  </div>
                  <div className="form-group col">
                    <label htmlFor="admin-prod-currency-select">Currency</label>
                    <select
                      id="admin-prod-currency-select"
                      required
                      value={currencySelect}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCurrencySelect(val);
                        if (val !== 'custom') {
                          setNewProduct(prev => ({ ...prev, currency: val }));
                        } else {
                          setNewProduct(prev => ({ ...prev, currency: '' }));
                        }
                      }}
                    >
                      <option value="$">$ (USD)</option>
                      <option value="₹">₹ (INR)</option>
                      <option value="€">€ (EUR)</option>
                      <option value="£">£ (GBP)</option>
                      <option value="¥">¥ (JPY)</option>
                      <option value="custom">Custom...</option>
                    </select>
                  </div>
                  {currencySelect === 'custom' && (
                    <div className="form-group col">
                      <label htmlFor="admin-prod-currency-custom">Symbol</label>
                      <input 
                        type="text" 
                        id="admin-prod-currency-custom" 
                        required 
                        placeholder="e.g. AED, Credits, BTC"
                        value={newProduct.currency}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, currency: e.target.value }))}
                      />
                    </div>
                  )}
                  <div className="form-group col">
                    <label htmlFor="admin-prod-platform">Platform Name</label>
                    <input 
                      type="text" 
                      id="admin-prod-platform" 
                      required 
                      placeholder="e.g. Netflix, Canva, Steam"
                      value={newProduct.platform}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, platform: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group col">
                    <label htmlFor="admin-prod-category">Category</label>
                    <select 
                      id="admin-prod-category" 
                      required
                      value={newProduct.category}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, category: e.target.value }))}
                    >
                      <option value="OTT Subscriptions">OTT Subscriptions</option>
                      <option value="Music Subscriptions">Music Subscriptions</option>
                      <option value="SaaS Tools">SaaS Tools</option>
                      <option value="Gift Cards">Gift Cards</option>
                    </select>
                  </div>
                  <div className="form-group col">
                    <label htmlFor="admin-prod-image">Image URL (Optional if file uploaded)</label>
                    <input 
                      type="url" 
                      id="admin-prod-image" 
                      placeholder="https://images.unsplash.com/..."
                      value={newProduct.image_url}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, image_url: e.target.value }))}
                    />
                  </div>
                  <div className="form-group col">
                    <label htmlFor="admin-prod-image-file">Or Upload Image File</label>
                    <div className="file-upload-wrapper">
                      <input 
                        type="file" 
                        id="admin-prod-image-file" 
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          setCropperState({
                            show: true,
                            file: file,
                            aspect: 1,
                            onComplete: (croppedFile) => {
                              setProductImageFile(croppedFile);
                            }
                          });
                        }}
                      />
                      <div className="upload-dummy-btn" style={{ fontSize: '13px', padding: '10px' }}>
                        {productImageFile ? `Selected: ${productImageFile.name}` : 'Choose product image file'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group col">
                    <label htmlFor="admin-prod-setup-type">Account Setup / Delivery Method</label>
                    <select 
                      id="admin-prod-setup-type" 
                      value={newProduct.setup_type || ''}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, setup_type: e.target.value }))}
                    >
                      <option value="">None (Standard)</option>
                      <option value="on_your_mail">Account on Your Mail</option>
                      <option value="on_my_mail">Account on My Mail</option>
                    </select>
                  </div>
                  <div className="form-group col">
                    <label htmlFor="admin-prod-duration">Duration (e.g. 30 Days, 1 Month)</label>
                    <input 
                      type="text" 
                      id="admin-prod-duration" 
                      placeholder="Leave empty if not applicable"
                      value={newProduct.duration || ''}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, duration: e.target.value }))}
                    />
                  </div>
                  <div className="form-group col">
                    <label htmlFor="admin-prod-stock-type">Expected Stock Type</label>
                    <select 
                      id="admin-prod-stock-type" 
                      value={newProduct.stock_type || 'code'}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, stock_type: e.target.value }))}
                    >
                      <option value="code">Promo Code / Key</option>
                      <option value="link">Invite Link</option>
                      <option value="credentials">Credentials (Email:Password)</option>
                      <option value="login_code">Login with Code</option>
                    </select>
                  </div>
                </div>

                {/* PRODUCT IMAGE PREVIEW */}
                {(imagePreviewUrl || newProduct.image_url) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', padding: '0 15px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Image Preview (Cropping & Aspect Ratio Guidance)</span>
                    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '6px', 
                        padding: '10px', 
                        backgroundColor: 'var(--bg-surface-elevated)', 
                        width: '160px',
                        height: '160px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden'
                      }}>
                        <img 
                          src={imagePreviewUrl || resolveUrl(newProduct.image_url)} 
                          alt="Product Preview" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} 
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: '250px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>
                          The preview box shows how the image will be cropped and centered using an aspect ratio of <strong>1:1 (Square)</strong> in the storefront grids. For optimal results, upload a square image (e.g. 400x400 pixels) or ensure the logo is centered.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                    {editingProduct ? 'Save Changes' : 'Add Product to Store'}
                  </button>
                  {editingProduct && (
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      onClick={handleCancelEdit}
                      style={{ flex: 1 }}
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* List products */}
            <div className="admin-product-list-card">
              <h3 className="card-subtitle">Existing Products</h3>
              <div className="admin-products-compact-list">
                {products.length === 0 ? (
                  <p>No products found in store catalog.</p>
                ) : (
                  products.map(prod => (
                    <div key={prod.id} className="admin-product-compact-item">
                      <div className="admin-prod-compact-details">
                        <span className="admin-prod-compact-title">{prod.name}</span>
                        <span className="admin-prod-compact-price">{prod.currency || '$'}{prod.price.toFixed(2)} ({prod.category})</span>
                      </div>
                      <div className="admin-prod-compact-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleOpenStockModal(prod)}>Manage Stock</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleStartEdit(prod)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteProduct(prod.id)}>Delete</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {adminTab === 'settings' && (
        <div className="admin-tab-content">
          <div className="admin-settings-layout" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'start' }}>
            
            {/* Payment & Email settings form */}
            <div className="admin-settings-card" style={{ flex: '1 1 300px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '20px' }}>
              <h3 className="card-subtitle" style={{ marginBottom: '15px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                System Settings Configuration
              </h3>
              <form onSubmit={handleSaveSettings}>
                <div className="form-group">
                  <label htmlFor="admin-settings-upi-id">Merchant UPI ID</label>
                  <input 
                    type="text" 
                    id="admin-settings-upi-id" 
                    required 
                    placeholder="e.g. merchant@bank"
                    value={upiIdInput}
                    onChange={(e) => setUpiIdInput(e.target.value)}
                  />
                  <span className="input-help">All checkout requests for INR will point to this UPI address.</span>
                </div>
                
                <div className="form-group">
                  <label htmlFor="admin-settings-qr-url">Custom QR Image URL</label>
                  <input 
                    type="url" 
                    id="admin-settings-qr-url" 
                    placeholder="https://example.com/qr.png"
                    value={upiQrUrlInput}
                    onChange={(e) => setUpiQrUrlInput(e.target.value)}
                  />
                  <span className="input-help">Specify a custom image URL or leave blank to auto-generate from the UPI ID.</span>
                </div>

                <div className="form-group">
                  <label htmlFor="admin-qr-image-file">Or Upload QR Image File</label>
                  <div className="file-upload-wrapper">
                    <input 
                      type="file" 
                      id="admin-qr-image-file" 
                      accept="image/*"
                      onChange={(e) => setQrImageFile(e.target.files[0])}
                    />
                    <div className="upload-dummy-btn" style={{ fontSize: '13px', padding: '10px' }}>
                      {qrImageFile ? `Selected: ${qrImageFile.name}` : 'Choose QR image file'}
                    </div>
                  </div>
                  <span className="input-help">Will be saved to server and override the image URL.</span>
                </div>

                {settings?.upi_qr_url && (
                  <div className="form-group" style={{ marginTop: '10px' }}>
                    <button 
                      type="button" 
                      className="btn btn-sm btn-danger" 
                      style={{ width: '100%' }}
                      onClick={handleRemoveCustomQR}
                    >
                      Remove Custom QR Code
                    </button>
                  </div>
                )}

                <div className="form-group" style={{ marginTop: '15px', borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
                  <label htmlFor="admin-settings-resend-api-key">Resend API Key</label>
                  <input 
                    type="password" 
                    id="admin-settings-resend-api-key" 
                    placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxx"
                    value={resendApiKeyInput}
                    onChange={(e) => setResendApiKeyInput(e.target.value)}
                  />
                  <span className="input-help">Required for automated key/invite delivery on approved payments.</span>
                </div>

                <div className="form-group">
                  <label htmlFor="admin-settings-email-from">Sender Email Address</label>
                  <input 
                    type="text" 
                    id="admin-settings-email-from" 
                    placeholder="onboarding@resend.dev or verified domain email"
                    value={emailFromInput}
                    onChange={(e) => setEmailFromInput(e.target.value)}
                  />
                  <span className="input-help">Must be a verified sender domain/email on your Resend dashboard.</span>
                </div>

                <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: '15px' }}>
                  Save System Settings
                </button>
              </form>
            </div>

            {/* Current settings preview */}
            <div className="admin-settings-preview-card" style={{ flex: '1 1 300px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '20px' }}>
              <h3 className="card-subtitle" style={{ marginBottom: '15px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active System Settings
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>UPI Address:</span>
                  <strong>{settings?.upi_id || 'Not configured'}</strong>
                </div>

                <div style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Email Mailer Status:</span>
                  <strong>{settings?.resend_api_key ? '✓ Resend API Key Configured' : '✗ No API Key Configured (Emails disabled)'}</strong>
                </div>

                <div style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sender Address (From):</span>
                  <code>{settings?.email_from || 'onboarding@resend.dev'}</code>
                </div>
                
                <div>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>QR Code Preview:</span>
                  <div style={{ display: 'flex', justifyContent: 'center', backgroundColor: '#fff', padding: '15px', borderRadius: '4px', border: '1px solid var(--border-color)', width: 'fit-content' }}>
                    <img 
                      src={resolveUrl(settings?.upi_qr_url) || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`upi://pay?pa=${settings?.upi_id || 'pay@getsubscribed'}&pn=Getsubscribed`)}`}
                      alt="Active QR Code" 
                      style={{ width: '150px', height: '150px', objectFit: 'contain' }}
                    />
                  </div>
                  <span className="input-help" style={{ marginTop: '5px', display: 'block' }}>
                    {settings?.upi_qr_url ? 'Using custom uploaded QR image.' : 'Auto-generated dynamic QR code based on UPI ID.'}
                  </span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {adminTab === 'stock' && (
        <div className="admin-tab-content">
          <div className="admin-settings-layout" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'start' }}>
            
            {/* LEFT COLUMN: OTT PLATFORMS LIST */}
            <div className="admin-settings-card" style={{ flex: '1 1 250px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '20px' }}>
              <h3 className="card-subtitle" style={{ marginBottom: '15px', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                OTT Platforms
              </h3>
              
              {/* Add new OTT Form */}
              <form onSubmit={handleAddOttPlatform} style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  placeholder="New OTT name..." 
                  value={newOttName}
                  onChange={(e) => setNewOttName(e.target.value)}
                  style={{ flex: 1, padding: '6px 10px', fontSize: '13px' }}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!newOttName.trim()}>
                  Add
                </button>
              </form>

              {/* Platforms list buttons */}
              {ottPlatforms.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No platforms found.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {ottPlatforms.map(platform => (
                    <button
                      key={platform.id}
                      type="button"
                      onClick={() => setSelectedOtt(platform)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: selectedOtt?.id === platform.id ? 'var(--bg-surface-elevated)' : 'transparent',
                        color: selectedOtt?.id === platform.id ? 'var(--text-main)' : 'var(--text-muted)',
                        fontWeight: selectedOtt?.id === platform.id ? 'bold' : 'normal',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      {platform.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: STOCK MANAGEMENT FOR SELECTED OTT */}
            <div className="admin-settings-card" style={{ flex: '2 1 450px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '20px' }}>
              {selectedOtt ? (
                <>
                  <h3 className="card-subtitle" style={{ marginBottom: '5px', fontSize: '1rem', color: 'var(--text-main)' }}>
                    Manage Stock: {selectedOtt.name}
                  </h3>
                  <p className="input-help" style={{ marginBottom: '20px' }}>
                    Upload invitation links, accounts, or promo codes for the active products listed under this platform.
                  </p>

                  {ottProducts.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '4px' }}>
                      <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginBottom: '10px' }}>No products found under this platform.</p>
                      <button 
                        type="button" 
                        className="btn btn-secondary btn-sm" 
                        onClick={() => {
                          setNewProduct(prev => ({ ...prev, platform: selectedOtt.name }));
                          setAdminTab('products');
                        }}
                      >
                        Create Product for {selectedOtt.name}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="form-group" style={{ marginBottom: '20px' }}>
                        <label htmlFor="stock-product-select">Select Product Model</label>
                        <select
                          id="stock-product-select"
                          value={selectedProductForStock}
                          onChange={(e) => setSelectedProductForStock(e.target.value)}
                          style={{ width: '100%', padding: '8px', fontSize: '13.5px' }}
                        >
                          {ottProducts.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.currency}{p.price})</option>
                          ))}
                        </select>
                      </div>

                      {(() => {
                        const selectedProductObj = ottProducts.find(p => p.id === selectedProductForStock);
                        if (selectedProductObj && selectedProductObj.stock_type === 'login_code') {
                          return (
                            <div style={{ padding: '30px 20px', textAlign: 'center', backgroundColor: 'var(--bg-surface-elevated)', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                              <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '10px' }}>📱</span>
                              <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-main)' }}>Login with Code Subscription</h4>
                              <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>
                                This product is configured for manual login activation. No stock keys are required. Setup is completed via WhatsApp/Email when user orders are approved.
                              </p>
                            </div>
                          );
                        }
                        return (
                          <>
                            {/* Key Upload Form */}
                            <form onSubmit={handleUploadStockTabKeys} style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>

                        <div className="form-group" style={{ marginBottom: '15px' }}>
                          <label>Stock Type</label>
                          <div style={{ display: 'flex', gap: '20px', marginTop: '5px', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name="stock-type" 
                                checked={stockUploadType === 'code'} 
                                onChange={() => setStockUploadType('code')} 
                              />
                              Promo Code / Key
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name="stock-type" 
                                checked={stockUploadType === 'link'} 
                                onChange={() => setStockUploadType('link')} 
                              />
                              Invite Link
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name="stock-type" 
                                checked={stockUploadType === 'credentials'} 
                                onChange={() => setStockUploadType('credentials')} 
                              />
                              Credentials (Email:Password)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                              <input 
                                type="radio" 
                                name="stock-type" 
                                checked={stockUploadType === 'login_code'} 
                                onChange={() => setStockUploadType('login_code')} 
                              />
                              Login with Code
                            </label>
                          </div>
                        </div>

                        <div className="form-group">
                          <label htmlFor="stock-upload-text">
                            {stockUploadType === 'code' && 'Paste Codes / Promo Keys (One per line)'}
                            {stockUploadType === 'link' && 'Paste Invitation URLs / Links (One per line)'}
                            {stockUploadType === 'credentials' && 'Paste Credentials List (One email:password per line)'}
                            {stockUploadType === 'login_code' && 'Paste Login Codes (One per line)'}
                          </label>
                          <textarea
                            id="stock-upload-text"
                            required
                            placeholder={
                              stockUploadType === 'code' ? "ABCD-EFGH-IJKL\nMNOP-QRST-UVWX" :
                              stockUploadType === 'link' ? "https://spotify.com/invite/123456\nhttps://spotify.com/invite/789101" :
                              stockUploadType === 'credentials' ? "user1@test.com:secret123\nuser2@test.com:pass456" :
                              "LOGIN-CODE-10293\nLOGIN-CODE-48201"
                            }
                            rows={4}
                            value={stockUploadText}
                            onChange={(e) => setStockUploadText(e.target.value)}
                            style={{ fontFamily: 'monospace', fontSize: '13px' }}
                          />
                          <span className="input-help">
                            {stockUploadType === 'credentials' && 'System formats each line to Email: user@domain | Pass: password.'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="submit" className="btn btn-primary" disabled={!stockUploadText.trim()}>
                            Add to Inventory
                          </button>
                        </div>
                      </form>

                      {/* Current product inventory table */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '10px' }}>
                        <h4 style={{ fontSize: '13.5px', fontWeight: 'bold', margin: 0 }}>Current Inventory Stock</h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Filter type:</span>
                          <select
                            value={filterStockType}
                            onChange={(e) => setFilterStockType(e.target.value)}
                            style={{
                              padding: '4px 8px',
                              fontSize: '12px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--input-bg)',
                              color: 'var(--text-main)',
                              outline: 'none'
                            }}
                          >
                            <option value="all">All</option>
                            <option value="code">Promo Code / Key</option>
                            <option value="link">Invite Link</option>
                            <option value="credentials">Credentials</option>
                            <option value="login_code">Login with Code</option>
                          </select>
                        </div>
                      </div>

                      {loadingStockTabKeys ? (
                        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading inventory...</p>
                      ) : stockTabKeys.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '4px' }}>
                          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>This product is currently out of stock.</p>
                        </div>
                      ) : (
                        <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                              <tr style={{ backgroundColor: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border-color)' }}>
                                <th style={{ padding: '8px 10px' }}>Value / Code / Link</th>
                                <th style={{ padding: '8px 10px' }}>Status</th>
                                <th style={{ padding: '8px 10px' }}>Claimed Order Details</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stockTabKeys
                                .filter(k => filterStockType === 'all' || k.type === filterStockType)
                                .map(k => (
                                <tr key={k.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <span title={k.key_value}>{k.key_value}</span>
                                  </td>
                                  <td style={{ padding: '8px 10px' }}>
                                    {k.is_used ? (
                                      <span className="badge badge-rejected" style={{ fontSize: '10px', padding: '2px 6px' }}>Claimed</span>
                                    ) : (
                                      <span className="badge badge-approved" style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#34c759' }}>Available</span>
                                    )}
                                  </td>
                                  <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: '11px' }}>
                                    {k.is_used ? (
                                      <div>
                                        <div style={{ fontWeight: 'bold' }}>UTR: {k.order_utr}</div>
                                        <div>User: {k.order_user}</div>
                                      </div>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        style={{ padding: '2px 6px', fontSize: '10px', borderRadius: '4px' }}
                                        onClick={() => setEditKeyModal({ show: true, keyId: k.id, keyValue: k.key_value, keyType: k.type || 'code' })}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        style={{ padding: '2px 6px', fontSize: '10px', color: '#ff3b30', border: '1px solid #ff3b30', background: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                        onClick={() => handleDeleteStockTabKey(k.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                          </>
                        );
                      })()}
                    </>
                  )}
                </>
              ) : (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Select an OTT platform from the left column to manage stock keys, codes, credentials, and links.
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {adminTab === 'analytics' && (
        <div className="admin-tab-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 className="card-subtitle" style={{ margin: 0 }}>Traffic & Store Overview</h3>
            <button className="btn btn-secondary btn-sm" onClick={loadAnalytics} disabled={loadingAnalytics}>
              {loadingAnalytics ? 'Refreshing...' : '↻ Refresh Data'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '30px' }}>
            <div className="admin-stat-card" style={{ padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <span className="admin-stat-label" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Visitor Count</span>
              <strong className="admin-stat-value" style={{ display: 'block', fontSize: '1.8rem', marginTop: '10px', color: 'var(--primary-color)' }}>{analytics?.visits || 0}</strong>
            </div>
            <div className="admin-stat-card" style={{ padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <span className="admin-stat-label" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Registered Users</span>
              <strong className="admin-stat-value" style={{ display: 'block', fontSize: '1.8rem', marginTop: '10px', color: 'var(--primary-color)' }}>{analytics?.users || 0}</strong>
            </div>
            <div className="admin-stat-card" style={{ padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <span className="admin-stat-label" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Orders Placed</span>
              <strong className="admin-stat-value" style={{ display: 'block', fontSize: '1.8rem', marginTop: '10px', color: 'var(--primary-color)' }}>{analytics?.orders || 0}</strong>
            </div>
            <div className="admin-stat-card" style={{ padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <span className="admin-stat-label" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Store Revenue</span>
              <strong className="admin-stat-value" style={{ display: 'block', fontSize: '1.8rem', marginTop: '10px', color: '#25D366' }}>
                ₹{(analytics?.revenue || 0).toFixed(2)}
              </strong>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', lineHeight: '1.6' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-main)' }}>Traffic Summary</h4>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Every time a client opens the storefront page, a unique visit log entry is processed. Approved order amounts are aggregated in real-time to compute the total revenue value. Use these stats to gauge storefront activity and user engagement.
            </p>
          </div>
        </div>
      )}

      {adminTab === 'users' && (
        <div className="admin-tab-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 className="card-subtitle" style={{ margin: 0 }}>Registered System Users</h3>
            <button className="btn btn-secondary btn-sm" onClick={loadAdminUsers} disabled={loadingAdminUsers}>
              {loadingAdminUsers ? 'Refreshing...' : '↻ Refresh Users'}
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-elevated)' }}>
                    <th style={{ padding: '12px', fontWeight: 'bold' }}>Email Address</th>
                    <th style={{ padding: '12px', fontWeight: 'bold' }}>Role</th>
                    <th style={{ padding: '12px', fontWeight: 'bold' }}>Status</th>
                    <th style={{ padding: '12px', fontWeight: 'bold', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.length === 0 ? (
                    <tr>
                      <td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No registered users found.
                      </td>
                    </tr>
                  ) : (
                    adminUsers.map(user => {
                      const isUserBanned = !!user.is_banned;
                      const isSelf = user.email === currentUser?.email;
                      return (
                        <tr key={user.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px' }}>
                            {user.email} {isSelf && <span style={{ fontSize: '0.75rem', color: 'var(--primary-color)', marginLeft: '5px' }}>(You)</span>}
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ 
                              padding: '3px 8px', 
                              borderRadius: '4px', 
                              fontSize: '0.75rem', 
                              fontWeight: '600',
                              backgroundColor: user.role === 'admin' ? 'rgba(0,124,255,0.15)' : 'rgba(255,255,255,0.05)',
                              color: user.role === 'admin' ? 'var(--primary-color)' : 'var(--text-muted)'
                            }}>
                              {user.role}
                            </span>
                          </td>
                          <td style={{ padding: '12px' }}>
                            {isUserBanned ? (
                              <span style={{ color: 'var(--danger-color)', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                🔴 Banned
                              </span>
                            ) : (
                              <span style={{ color: '#25D366', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                🟢 Active
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            {user.role === 'admin' ? (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Protected</span>
                            ) : isUserBanned ? (
                              <button 
                                className="btn btn-secondary btn-xs" 
                                style={{ padding: '4px 10px', fontSize: '11px', color: '#25D366' }}
                                onClick={() => handleUnbanUser(user)}
                              >
                                Unban User
                              </button>
                            ) : (
                              <button 
                                className="btn btn-danger btn-xs" 
                                style={{ padding: '4px 10px', fontSize: '11px' }}
                                onClick={() => handleBanUser(user)}
                              >
                                Ban User
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* STOCK MANAGEMENT MODAL */}
      {activeStockProduct && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: '600px', width: '90%' }}>
            <h3 className="modal-title" style={{ fontSize: '1.2rem', marginBottom: '5px' }}>
              Manage Stock: {activeStockProduct.name}
            </h3>
            <p className="modal-subtitle" style={{ marginBottom: '20px' }}>
              Add new credentials or group invitation links, and review active inventory items.
            </p>
            
            {activeStockProduct.stock_type === 'login_code' ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', backgroundColor: 'var(--bg-surface-elevated)', border: '1px dashed var(--border-color)', borderRadius: '6px', marginBottom: '20px' }}>
                <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '10px' }}>📱</span>
                <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-main)' }}>Login with Code Subscription</h4>
                <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>
                  This product is configured for manual login activation. You do not need to add any stock keys. When customers place an order, they will be prompted to contact support via WhatsApp/Email to complete the login procedure.
                </p>
              </div>
            ) : (
              <>
                {/* Add stock keys form */}
                <form onSubmit={handleAddKeys} style={{ marginBottom: '25px', paddingBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
                  <div className="form-group">
                    <label htmlFor="new-keys-text">Paste New Keys / Links (One per line)</label>
                    <textarea
                      id="new-keys-text"
                      placeholder="https://spotify.com/invite/...&#10;https://spotify.com/invite/...&#10;or Account Email:Password"
                      rows={4}
                      required
                      value={newKeysText}
                      onChange={(e) => setNewKeysText(e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: '13px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button type="submit" className="btn btn-primary" disabled={submittingKeys || !newKeysText.trim()}>
                      {submittingKeys ? 'Adding...' : 'Add to Inventory'}
                    </button>
                  </div>
                </form>

                {/* Inventory List */}
                <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>Current Inventory</h4>
                {loadingKeys ? (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading inventory keys...</p>
                ) : stockKeys.length === 0 ? (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>No stock items found for this product. (Out of Stock)</p>
                ) : (
                  <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '20px', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '10px' }}>
                    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                          <th style={{ padding: '6px 4px' }}>Value / Code / Link</th>
                          <th style={{ padding: '6px 4px' }}>Status</th>
                          <th style={{ padding: '6px 4px' }}>Details / Order</th>
                          <th style={{ padding: '6px 4px', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockKeys.map((keyItem) => (
                          <tr key={keyItem.id} style={{ borderBottom: '1px solid #f4f4f5' }}>
                            <td style={{ padding: '6px 4px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                              <span title={keyItem.key_value}>{keyItem.key_value}</span>
                            </td>
                            <td style={{ padding: '6px 4px' }}>
                              {keyItem.is_used ? (
                                <span className="badge badge-success" style={{ backgroundColor: '#e1f5fe', color: '#0288d1', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', textTransform: 'uppercase' }}>Claimed</span>
                              ) : (
                                <span className="badge badge-warning" style={{ backgroundColor: '#efebe9', color: '#4e342e', padding: '2px 6px', borderRadius: '3px', fontSize: '10px', textTransform: 'uppercase' }}>Available</span>
                              )}
                            </td>
                            <td style={{ padding: '6px 4px', color: 'var(--text-muted)' }}>
                              {keyItem.is_used ? (
                                <span title={`Claimed by user: ${keyItem.order_user || ''}`}>
                                  Order: <code>{keyItem.order_utr || keyItem.order_id?.substring(0, 8)}</code>
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                              {!keyItem.is_used ? (
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                  <button 
                                    type="button" 
                                    className="btn btn-secondary btn-sm" 
                                    onClick={() => setEditKeyModal({ show: true, keyId: keyItem.id, keyValue: keyItem.key_value, keyType: keyItem.type || 'code' })}
                                    style={{ padding: '2px 6px', fontSize: '10px' }}
                                  >
                                    Edit
                                  </button>
                                  <button 
                                    type="button" 
                                    className="btn btn-danger btn-sm" 
                                    onClick={() => handleDeleteKey(keyItem.id)}
                                    style={{ padding: '2px 6px', fontSize: '10px' }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              ) : (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Locked</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            <div className="modal-actions" style={{ marginTop: '15px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setActiveStockProduct(null)}
              >
                Close Stock Console
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}

function AboutView() {
  return (
    <section id="view-about" style={{ padding: '40px 0', maxWidth: '800px', margin: '0 auto' }}>
      <div className="section-header" style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 className="section-title" style={{ fontSize: '2.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>About Us</h2>
        <div style={{ height: '4px', width: '60px', backgroundColor: 'var(--text-main)', margin: '15px auto 0' }}></div>
      </div>
      <div className="content-card" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '30px', lineHeight: '1.8' }}>
        <p style={{ marginBottom: '20px', fontSize: '1.1rem' }}>
          Welcome to <strong>Getsubscribed</strong>, your premier marketplace for premium digital entertainment, streaming accounts, and software credentials. 
        </p>
        <p style={{ marginBottom: '20px' }}>
          We specialize in providing secure, affordable, and instant access keys and group subscriptions to the world's leading OTT and SaaS platforms. By pooling subscription accounts and managing inventory efficiently, we enable users to enjoy premium streaming services at a fraction of the cost, with 100% legal, genuine, and verified invite links.
        </p>
        <h3 style={{ marginTop: '30px', marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>Our Vision</h3>
        <p style={{ marginBottom: '20px' }}>
          At Getsubscribed, we believe premium entertainment and digital tools should be accessible to everyone, everywhere. We bridge the gap between high subscription costs and budget-conscious consumers by offering secure, automated group subscription sharing and instant key delivery.
        </p>
        <h3 style={{ marginTop: '30px', marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>Why Choose Us?</h3>
        <ul style={{ paddingLeft: '20px', marginBottom: '20px' }}>
          <li style={{ marginBottom: '10px' }}><strong>Instant Delivery:</strong> Access keys and invitation links are dispatched automatically to your registered email immediately upon payment approval.</li>
          <li style={{ marginBottom: '10px' }}><strong>Trusted Verification:</strong> Every order is vetted through transaction UTR matching to prevent fraud and ensure transparent processing.</li>
          <li style={{ marginBottom: '10px' }}><strong>Premium Support:</strong> Our support team is online 24/7 on WhatsApp and email to assist you with active subscriptions and custom inquiries.</li>
        </ul>
      </div>
    </section>
  );
}

function ContactView() {
  return (
    <section id="view-contact" style={{ padding: '40px 0', maxWidth: '800px', margin: '0 auto' }}>
      <div className="section-header" style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 className="section-title" style={{ fontSize: '2.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Us</h2>
        <div style={{ height: '4px', width: '60px', backgroundColor: 'var(--text-main)', margin: '15px auto 0' }}></div>
      </div>
      <div className="content-card" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '30px', lineHeight: '1.8' }}>
        <p style={{ marginBottom: '25px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Have a question about your order, custom keys, or corporate partnerships? Get in touch with our customer service team.
        </p>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '20px' }}>
          <div style={{ padding: '20px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
            <h4 style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '15px', color: 'var(--text-main)' }}>Support Channels</h4>
            <p style={{ marginBottom: '10px' }}>
              <strong>WhatsApp Business:</strong><br />
              <a href="https://wa.me/917017750272" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>+91 70177 50272</a>
            </p>
            <p style={{ marginBottom: '10px' }}>
              <strong>Email Support:</strong><br />
              <a href="mailto:support@getsubscribed.online" style={{ textDecoration: 'underline' }}>support@getsubscribed.online</a>
            </p>
            <p style={{ marginBottom: '10px' }}>
              <strong>Business Inquiries:</strong><br />
              <a href="mailto:admin@getsubscribed.online" style={{ textDecoration: 'underline' }}>admin@getsubscribed.online</a>
            </p>
          </div>
          
          <div style={{ padding: '20px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
            <h4 style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '15px', color: 'var(--text-main)' }}>Merchant Details</h4>
            <p style={{ marginBottom: '10px' }}>
              <strong>Registered Office:</strong><br />
              Getsubscribed Ltd.<br />
              15/342, Minimalist Tower, Civil Lines,<br />
              Uttar Pradesh, India - 208001
            </p>
            <p style={{ marginBottom: '10px' }}>
              <strong>Operating Hours:</strong><br />
              Monday - Sunday: 9:00 AM - 11:00 PM IST
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SafetyView() {
  return (
    <section id="view-safety" style={{ padding: '40px 0', maxWidth: '800px', margin: '0 auto' }}>
      <div className="section-header" style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 className="section-title" style={{ fontSize: '2.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Safety & Refund Policy</h2>
        <div style={{ height: '4px', width: '60px', backgroundColor: 'var(--text-main)', margin: '15px auto 0' }}></div>
      </div>
      <div className="content-card" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '30px', lineHeight: '1.8' }}>
        <h3 style={{ marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>1. Secure Checkout</h3>
        <p style={{ marginBottom: '20px' }}>
          At Getsubscribed, payment security is our top priority. We use strict verification rules and transaction matching to prevent unauthorized charges. We never store sensitive banking or PayPal credentials on our servers. All credit card processing and PayPal transactions are redirected through authorized, encrypted payment gateway channels.
        </p>

        <h3 style={{ marginTop: '30px', marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>2. Buyer Protection</h3>
        <p style={{ marginBottom: '20px' }}>
          All premium accounts, credentials, and invite links purchased on our store are covered by our Buyer Protection program. We guarantee that the service credentials will remain active for the complete duration of the billing cycle purchased.
        </p>

        <h3 style={{ marginTop: '30px', marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>3. Refund & Replacement Guarantee</h3>
        <ul style={{ paddingLeft: '20px', marginBottom: '20px' }}>
          <li style={{ marginBottom: '10px' }}><strong>Defective Credentials:</strong> If an invite link or access credential fails to work upon delivery, we will issue a replacement link or a full refund within 48 hours of verification.</li>
          <li style={{ marginBottom: '10px' }}><strong>Service Outages:</strong> If a premium subscription encounters an outage and our support team cannot restore access within 24 hours, we will issue a pro-rata refund for the unused duration of the subscription.</li>
          <li style={{ marginBottom: '10px' }}><strong>How to Claim:</strong> To file a claim, simply contact our WhatsApp support or email `support@getsubscribed.online` with your order ID and transaction UTR Reference.</li>
        </ul>
      </div>
    </section>
  );
}

function TermsView() {
  return (
    <section id="view-terms" style={{ padding: '40px 0', maxWidth: '800px', margin: '0 auto' }}>
      <div className="section-header" style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 className="section-title" style={{ fontSize: '2.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Terms & Conditions</h2>
        <div style={{ height: '4px', width: '60px', backgroundColor: 'var(--text-main)', margin: '15px auto 0' }}></div>
      </div>
      <div className="content-card" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '30px', lineHeight: '1.8', fontSize: '0.95rem' }}>
        <p style={{ marginBottom: '20px', color: 'var(--text-muted)' }}>Last updated: June 19, 2026</p>
        
        <h3 style={{ marginTop: '20px', marginBottom: '10px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.1rem', letterSpacing: '0.05em' }}>1. Agreement to Terms</h3>
        <p style={{ marginBottom: '20px' }}>
          By accessing and placing an order on our storefront (Getsubscribed), you agree to be bound by these Terms and Conditions. If you do not agree, please do not use our services.
        </p>

        <h3 style={{ marginTop: '20px', marginBottom: '10px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.1rem', letterSpacing: '0.05em' }}>2. Purchase & Billing</h3>
        <p style={{ marginBottom: '20px' }}>
          We provide digital subscription invite credentials. All purchases require payment verification. You agree to submit valid proof of payment (transaction reference/UTR number) upon checkout. Orders with invalid, mismatched, or reused UTRs will be rejected.
        </p>

        <h3 style={{ marginTop: '20px', marginBottom: '10px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.1rem', letterSpacing: '0.05em' }}>3. Digital Delivery</h3>
        <p style={{ marginBottom: '20px' }}>
          Subscriptions and credentials are digital products. Delivery is conducted electronically via invitation links or activation credentials sent to your registered email address. We do not ship physical products.
        </p>

        <h3 style={{ marginTop: '20px', marginBottom: '10px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.1rem', letterSpacing: '0.05em' }}>4. Code of Conduct & Account Usage</h3>
        <p style={{ marginBottom: '20px' }}>
          Shared group subscriptions are intended for personal, non-commercial use. Users are strictly prohibited from changing account credentials, profiles, or billing settings of shared subscriptions. Violators will face immediate termination of access without refund.
        </p>

        <h3 style={{ marginTop: '20px', marginBottom: '10px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.1rem', letterSpacing: '0.05em' }}>5. Limitation of Liability</h3>
        <p style={{ marginBottom: '20px' }}>
          Getsubscribed is not affiliated directly with Netflix, Spotify, Prime, or other brand names. We only facilitate legal family-group sharing slots. In no event shall Getsubscribed be liable for any indirect or consequential damages arising from service outages on third-party platforms.
        </p>
      </div>
    </section>
  );
}

function ImageCropperModal({ show, imageFile, aspect, onCrop, onCancel }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imageSrc, setImageSrc] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [localAspect, setLocalAspect] = useState(1);
  const imageRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (aspect) {
      setLocalAspect(aspect);
    }
  }, [aspect]);

  useEffect(() => {
    if (!imageFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result);
    };
    reader.readAsDataURL(imageFile);
    
    // Reset values
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [imageFile]);

  if (!show || !imageFile) return null;

  // Frame dimension based on local aspect ratio
  // Max width/height bounding box is 300px
  let frameWidth = 280;
  let frameHeight = 280;

  if (localAspect === 1.777) { // 16:9
    frameWidth = 320;
    frameHeight = 180;
  } else if (localAspect === 1.333) { // 4:3
    frameWidth = 300;
    frameHeight = 225;
  } else if (localAspect === 'free') {
    frameWidth = 300;
    frameHeight = 300;
  } else if (localAspect === 1) { // 1:1
    frameWidth = 280;
    frameHeight = 280;
  }

  const handlePointerDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    e.target.releasePointerCapture(e.pointerId);
  };

  const handleSave = () => {
    const img = imageRef.current;
    if (!img) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // High resolution target size
    const targetWidth = frameWidth * 2;
    const targetHeight = frameHeight * 2;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.save();
    
    // Move coordinate system to center
    ctx.translate(targetWidth / 2, targetHeight / 2);

    // Scaling factor from screen to canvas coordinates
    const scale = targetWidth / frameWidth;
    
    // Apply translation from panning
    ctx.translate(pan.x * scale, pan.y * scale);
    
    // Apply zoom
    ctx.scale(zoom, zoom);

    // Draw the image centered
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const frameAspect = frameWidth / frameHeight;

    let drawWidth, drawHeight;
    if (imgAspect > frameAspect) {
      // Image is wider than frame - fill height
      drawHeight = frameHeight * scale;
      drawWidth = drawHeight * imgAspect;
    } else {
      // Image is taller than frame - fill width
      drawWidth = frameWidth * scale;
      drawHeight = drawWidth / imgAspect;
    }

    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const croppedFile = new File([blob], imageFile.name, {
        type: imageFile.type,
        lastModified: Date.now()
      });
      onCrop(croppedFile);
    }, imageFile.type);
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1100 }}>
      <div className="modal-card" style={{ maxWidth: '400px', padding: '20px' }}>
        <h3 className="modal-title" style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Crop Image</h3>
        <p className="modal-subtitle" style={{ margin: '0 0 15px 0', fontSize: '12px' }}>
          Drag the image to pan and use the slider to zoom.
        </p>

        {/* Aspect Ratio Selector */}
        <div style={{ marginBottom: '15px' }}>
          <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '5px' }}>Select Aspect Ratio</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              type="button" 
              className={`btn btn-xs ${localAspect === 1 ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => setLocalAspect(1)}
            >
              1:1 (Square)
            </button>
            <button 
              type="button" 
              className={`btn btn-xs ${localAspect === 1.777 ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => setLocalAspect(1.777)}
            >
              16:9
            </button>
            <button 
              type="button" 
              className={`btn btn-xs ${localAspect === 1.333 ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => setLocalAspect(1.333)}
            >
              4:3
            </button>
            <button 
              type="button" 
              className={`btn btn-xs ${localAspect === 'free' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => setLocalAspect('free')}
            >
              Free
            </button>
          </div>
        </div>

        {/* Cropping Frame Box */}
        <div 
          ref={containerRef}
          style={{
            width: `${frameWidth}px`,
            height: `${frameHeight}px`,
            overflow: 'hidden',
            position: 'relative',
            backgroundColor: '#000',
            borderRadius: '8px',
            margin: '0 auto 15px auto',
            border: '2px solid var(--border-color)',
            cursor: 'move',
            touchAction: 'none'
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {imageSrc && (
            <img 
              ref={imageRef}
              src={imageSrc} 
              alt="To Crop"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                maxWidth: 'none',
                maxHeight: 'none',
                // Size mapping: cover the frame
                width: 'auto',
                height: '100%',
                transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center',
                userSelect: 'none',
                pointerEvents: 'none'
              }}
            />
          )}
          {/* Subtle grid lines for premium crop look */}
          <div style={{ position: 'absolute', inset: 0, border: '1px dashed rgba(255,255,255,0.3)', pointerEvents: 'none' }}></div>
          <div style={{ position: 'absolute', left: '33.33%', right: '33.33%', top: 0, bottom: 0, borderLeft: '1px dashed rgba(255,255,255,0.2)', borderRight: '1px dashed rgba(255,255,255,0.2)', pointerEvents: 'none' }}></div>
          <div style={{ position: 'absolute', top: '33.33%', bottom: '33.33%', left: 0, right: 0, borderTop: '1px dashed rgba(255,255,255,0.2)', borderBottom: '1px dashed rgba(255,255,255,0.2)', pointerEvents: 'none' }}></div>
        </div>

        {/* Zoom Slider */}
        <div className="form-group" style={{ marginBottom: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '5px' }}>
            <span>Zoom</span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <input 
            type="range" 
            min="1" 
            max="3" 
            step="0.01" 
            value={zoom} 
            onChange={(e) => setZoom(parseFloat(e.target.value))} 
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>

        {/* Crop Controls */}
        <div className="modal-actions" style={{ marginTop: '20px' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            Crop & Apply
          </button>
        </div>
      </div>
    </div>
  );
}
