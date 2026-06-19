import React, { useState, useEffect } from 'react';
import './App.css';
import ProtectedRoute from './ProtectedRoute';

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
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  // --- Admin States ---
  const [adminOrders, setAdminOrders] = useState([]);
  const [adminTab, setAdminTab] = useState(() => sessionStorage.getItem('adminTab') || 'orders'); // orders, products, settings
  const [settings, setSettings] = useState({
    upi_id: 'pay@ottsolution',
    upi_qr_url: ''
  });
  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    price: '',
    currency: '$',
    platform: '',
    category: 'OTT Subscriptions',
    image_url: ''
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
    }
  }, [currentUser, activeView]);

  // --- Real-time Order Polling Notifications ---
  const prevOrdersRef = React.useRef([]);

  useEffect(() => {
    if (!currentUser) {
      prevOrdersRef.current = [];
      return;
    }

    const pollOrders = async () => {
      try {
        if (currentUser.role === 'admin') {
          // Poll Admin Orders
          const res = await fetch('/api/admin/orders');
          if (!res.ok) return;
          const data = await res.json();

          // Check if we have a previous dataset to compare
          if (prevOrdersRef.current.length > 0) {
            const newPending = data.filter(o => o.status === 'pending');
            const prevPendingIds = prevOrdersRef.current.filter(o => o.status === 'pending').map(o => o.id);

            newPending.forEach(order => {
              if (!prevPendingIds.includes(order.id)) {
                showToast(`New order placed by ${order.user_email} for ${order.product_name}!`, 'info');
              }
            });
          }

          prevOrdersRef.current = data;
          if (activeView === 'admin') {
            setAdminOrders(data);
          }
        } else {
          // Poll Customer Orders
          const res = await fetch('/api/orders');
          if (!res.ok) return;
          const data = await res.json();

          // Check if we have a previous dataset to compare
          if (prevOrdersRef.current.length > 0) {
            data.forEach(order => {
              const prevOrder = prevOrdersRef.current.find(o => o.id === order.id);
              if (prevOrder && prevOrder.status !== order.status) {
                if (order.status === 'approved') {
                  showToast(`Your order for ${order.product_name} has been completed!`, 'success');
                } else if (order.status === 'rejected') {
                  showToast(`Your order for ${order.product_name} was rejected: "${order.rejection_reason || 'No reason specified'}"`, 'error');
                }
              }
            });
          }

          prevOrdersRef.current = data;
          if (activeView === 'orders') {
            setUserOrders(data);
          }
        }
      } catch (err) {
        // Silently capture errors to not disrupt user experience
      }
    };

    // Run the first poll immediately
    pollOrders();

    // Set polling interval to 10 seconds
    const intervalId = setInterval(pollOrders, 10000);

    return () => clearInterval(intervalId);
  }, [currentUser, activeView]);

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
      const res = await fetch(url, options);
      const data = await res.json();
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
    try {
      const data = await apiRequest('/api/orders');
      setUserOrders(data);
    } catch (err) {}
  };

  const loadAdminOrders = async () => {
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
  const handleCopyUPI = () => {
    navigator.clipboard.writeText('pay@ottsolution').then(() => {
      showToast('UPI ID copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  };

  // --- Render Functions / Sub-components ---
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
            <span className="logo-text">ott<span className="logo-alt">solution</span></span>
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
                    <img src={prod.image_url} alt={prod.name} className="suggestion-img" />
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
            <button 
              className="btn btn-secondary btn-sm theme-toggle-btn"
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              style={{ display: 'inline-flex', padding: '6px', borderRadius: '50%' }}
            >
              {theme === 'dark' ? (
                /* Sun Icon */
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              ) : (
                /* Moon Icon */
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
              )}
            </button>

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

          {/* Mobile Header Controls (Theme Toggle + Hamburger) */}
          <div className="mobile-header-actions">
            <button 
              className="btn btn-secondary btn-sm theme-toggle-btn"
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              style={{ display: 'inline-flex', padding: '6px', borderRadius: '50%' }}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
              )}
            </button>

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
                    <img className="product-image" src={prod.image_url} alt={prod.name} />
                    <span className="platform-badge">{prod.platform}</span>
                  </div>
                  <div className="product-info">
                    <span className="product-category">{prod.category}</span>
                    <h4 className="product-title">{prod.name}</h4>
                    <p className="product-desc-excerpt">{prod.description}</p>
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
                <img src={selectedProduct.image_url} alt={selectedProduct.name} />
              </div>
              <div className="details-info-card">
                <div className="details-badge-row">
                  <span className="detail-badge">Digital Delivery</span>
                  <span className="detail-badge">Private Account</span>
                  <span className="detail-badge">{selectedProduct.platform}</span>
                </div>
                <h1 className="details-title">{selectedProduct.name}</h1>
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
            <strong>ottsolution</strong> © {new Date().getFullYear()}. All Rights Reserved.
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

      {/* FLOATING WHATSAPP CHAT WIDGET */}
      {(() => {
        const completedOrder = userOrders && userOrders.find(o => o.status === 'approved');
        const latestOrderUtr = completedOrder ? completedOrder.utr_number : (userOrders && userOrders.length > 0 ? userOrders[0].utr_number : '');
        const waPrefillText = completedOrder
          ? `Hello ottsolution Support! My order is completed (Reference UTR: ${completedOrder.utr_number}) and I would like to chat.`
          : (latestOrderUtr 
            ? `Hello ottsolution Support! I have a question regarding my order (UTR Reference: ${latestOrderUtr}).`
            : 'Hello ottsolution Support! I have a question about your services...');
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
                  backgroundColor: '#000000',
                  color: '#ffffff',
                  padding: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '700', letterSpacing: '0.03em' }}>ottsolution Support</h4>
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

function CheckoutView({ product, apiRequest, showToast, navigateTo, handleCopyUPI, settings }) {
  const [utrNumber, setUtrNumber] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (utrNumber.trim().length < 8) {
      showToast('UTR reference must be at least 8 characters.', 'warning');
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
            <img src={product.image_url} alt={product.name} className="preview-img" />
            <div className="preview-details">
              <h4 className="preview-title">{product.name}</h4>
              <span className="preview-platform">{product.platform}</span>
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
                const upiId = settings?.upi_id || 'pay@ottsolution';
                const upiQrUrl = settings?.upi_qr_url;
                const qrSrc = upiQrUrl 
                  ? upiQrUrl 
                  : `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`upi://pay?pa=${upiId}&pn=ottsolution`)}`;

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
                          <tr><td>Bank Name:</td><td><strong>ottsolution Bank (India)</strong></td></tr>
                          <tr><td>Account Name:</td><td><strong>ottsolution Subscriptions Ltd</strong></td></tr>
                          <tr><td>Account No:</td><td><strong>9900887766</strong></td></tr>
                          <tr><td>IFSC Code:</td><td><strong>OTTB000123</strong></td></tr>
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
                        <tr><td>Bank Name:</td><td><strong>ottsolution Europe Bank</strong></td></tr>
                        <tr><td>IBAN:</td><td><strong>BE89 3704 0044 0532 0130</strong></td></tr>
                        <tr><td>BIC / SWIFT:</td><td><strong>OTTBBE22XXX</strong></td></tr>
                        <tr><td>Account Name:</td><td><strong>ottsolution Subscriptions Ltd</strong></td></tr>
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
                      <strong className="upi-id-badge" style={{ margin: 0 }}>paypal@ottsolution.com</strong>
                      <button 
                        type="button" 
                        className="btn btn-sm btn-secondary" 
                        onClick={() => {
                          navigator.clipboard.writeText('paypal@ottsolution.com').then(() => {
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
                        <tr><td>Bank Name:</td><td><strong>ottsolution US Bank</strong></td></tr>
                        <tr><td>Routing No:</td><td><strong>021000021</strong></td></tr>
                        <tr><td>Account No:</td><td><strong>123456789012</strong></td></tr>
                        <tr><td>Swift Code:</td><td><strong>OTTBUS33XXX</strong></td></tr>
                        <tr><td>Beneficiary:</td><td><strong>ottsolution Subscriptions LLC</strong></td></tr>
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
                  onChange={(e) => setScreenshot(e.target.files[0])}
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

function UserOrdersView({ orders, currentUser }) {
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
                <img src={order.image_url} alt={order.product_name} className="preview-img" />
                <div className="order-info-col">
                  <div className="order-title-row">
                    <span className="order-p-name">{order.product_name}</span>
                    {statusBadge}
                  </div>
                  <span className="order-utr-text">Reference UTR: <strong>{order.utr_number}</strong></span>
                  <span className="order-date-text">Submitted on {date}</span>
                  <div style={{ marginTop: '6px' }}>
                    <a 
                      href={`https://wa.me/917017750272?text=${encodeURIComponent(`Hi, I need help with my order. Reference UTR: ${order.utr_number}`)}`} 
                      target="_blank" 
                      rel="noreferrer"
                      style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      Need Help? Chat on WhatsApp
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
                          <span style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>Your digital invite / credentials:</span>
                          {order.key_value.startsWith('http') ? (
                            <a 
                              href={order.key_value} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="btn btn-primary btn-sm" 
                              style={{ display: 'inline-block', textDecoration: 'none' }}
                            >
                              Join Subscription / Claim Invite Link
                            </a>
                          ) : (
                            <div style={{ padding: '10px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px dashed var(--border-color)', borderRadius: '4px', fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }}>
                              {order.key_value}
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
  setConfirmModal
}) {
  const [productImageFile, setProductImageFile] = useState(null);
  const [currencySelect, setCurrencySelect] = useState('$');
  const [editingProduct, setEditingProduct] = useState(null);

  const [upiIdInput, setUpiIdInput] = useState(settings?.upi_id || '');
  const [upiQrUrlInput, setUpiQrUrlInput] = useState(settings?.upi_qr_url || '');
  const [qrImageFile, setQrImageFile] = useState(null);
  const [resendApiKeyInput, setResendApiKeyInput] = useState(settings?.resend_api_key || '');
  const [emailFromInput, setEmailFromInput] = useState(settings?.email_from || '');

  // Reconciliation states
  const [utrText, setUtrText] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);

  // Stock management states
  const [activeStockProduct, setActiveStockProduct] = useState(null);
  const [stockKeys, setStockKeys] = useState([]);
  const [newKeysText, setNewKeysText] = useState('');
  const [submittingKeys, setSubmittingKeys] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);

  const [orderSearchQuery, setOrderSearchQuery] = useState('');

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
      image_url: prod.image_url
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
      image_url: ''
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
        image_url: ''
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

  const handleSaveSettings = async (e) => {
    e.preventDefault();
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
                        <td><code>{order.utr_number}</code></td>
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
                            <a href={order.screenshot_path} target="_blank" rel="noreferrer">
                              <img src={order.screenshot_path} alt="Receipt" className="admin-orders-screenshot-preview" />
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
                    <label htmlFor="admin-prod-image">Image URL</label>
                    <input 
                      type="url" 
                      id="admin-prod-image" 
                      placeholder="https://images.unsplash.com/..."
                      value={newProduct.image_url}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, image_url: e.target.value }))}
                      required={!productImageFile}
                    />
                  </div>
                  <div className="form-group col">
                    <label htmlFor="admin-prod-image-file">Or Upload Image File</label>
                    <div className="file-upload-wrapper">
                      <input 
                        type="file" 
                        id="admin-prod-image-file" 
                        accept="image/*"
                        onChange={(e) => setProductImageFile(e.target.files[0])}
                        required={!newProduct.image_url}
                      />
                      <div className="upload-dummy-btn" style={{ fontSize: '13px', padding: '10px' }}>
                        {productImageFile ? `Selected: ${productImageFile.name}` : 'Choose product image file'}
                      </div>
                    </div>
                  </div>
                </div>
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
                      src={settings?.upi_qr_url || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`upi://pay?pa=${settings?.upi_id || 'pay@ottsolution'}&pn=ottsolution`)}`}
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
                            <button 
                              type="button" 
                              className="btn btn-danger btn-sm" 
                              onClick={() => handleDeleteKey(keyItem.id)}
                              style={{ padding: '2px 6px', fontSize: '10px' }}
                            >
                              Delete
                            </button>
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
          Welcome to <strong>ottsolution</strong>, your premier marketplace for premium digital entertainment, streaming accounts, and software credentials. 
        </p>
        <p style={{ marginBottom: '20px' }}>
          We specialize in providing secure, affordable, and instant access keys and group subscriptions to the world's leading OTT and SaaS platforms. By pooling subscription accounts and managing inventory efficiently, we enable users to enjoy premium streaming services at a fraction of the cost, with 100% legal, genuine, and verified invite links.
        </p>
        <h3 style={{ marginTop: '30px', marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>Our Vision</h3>
        <p style={{ marginBottom: '20px' }}>
          At ottsolution, we believe premium entertainment and digital tools should be accessible to everyone, everywhere. We bridge the gap between high subscription costs and budget-conscious consumers by offering secure, automated group subscription sharing and instant key delivery.
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
              <a href="mailto:support@ottsolution.com" style={{ textDecoration: 'underline' }}>support@ottsolution.com</a>
            </p>
            <p style={{ marginBottom: '10px' }}>
              <strong>Business Inquiries:</strong><br />
              <a href="mailto:admin@ott.com" style={{ textDecoration: 'underline' }}>admin@ott.com</a>
            </p>
          </div>
          
          <div style={{ padding: '20px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
            <h4 style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '15px', color: 'var(--text-main)' }}>Merchant Details</h4>
            <p style={{ marginBottom: '10px' }}>
              <strong>Registered Office:</strong><br />
              ottsolution Ltd.<br />
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
          At ottsolution, payment security is our top priority. We use strict verification rules and transaction matching to prevent unauthorized charges. We never store sensitive banking or PayPal credentials on our servers. All credit card processing and PayPal transactions are redirected through authorized, encrypted payment gateway channels.
        </p>

        <h3 style={{ marginTop: '30px', marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>2. Buyer Protection</h3>
        <p style={{ marginBottom: '20px' }}>
          All premium accounts, credentials, and invite links purchased on our store are covered by our Buyer Protection program. We guarantee that the service credentials will remain active for the complete duration of the billing cycle purchased.
        </p>

        <h3 style={{ marginTop: '30px', marginBottom: '15px', color: 'var(--text-main)', textTransform: 'uppercase', fontSize: '1.2rem', letterSpacing: '0.05em' }}>3. Refund & Replacement Guarantee</h3>
        <ul style={{ paddingLeft: '20px', marginBottom: '20px' }}>
          <li style={{ marginBottom: '10px' }}><strong>Defective Credentials:</strong> If an invite link or access credential fails to work upon delivery, we will issue a replacement link or a full refund within 48 hours of verification.</li>
          <li style={{ marginBottom: '10px' }}><strong>Service Outages:</strong> If a premium subscription encounters an outage and our support team cannot restore access within 24 hours, we will issue a pro-rata refund for the unused duration of the subscription.</li>
          <li style={{ marginBottom: '10px' }}><strong>How to Claim:</strong> To file a claim, simply contact our WhatsApp support or email `support@ottsolution.com` with your order ID and transaction UTR Reference.</li>
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
          By accessing and placing an order on our storefront (ottsolution), you agree to be bound by these Terms and Conditions. If you do not agree, please do not use our services.
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
          ottsolution is not affiliated directly with Netflix, Spotify, Prime, or other brand names. We only facilitate legal family-group sharing slots. In no event shall ottsolution be liable for any indirect or consequential damages arising from service outages on third-party platforms.
        </p>
      </div>
    </section>
  );
}
