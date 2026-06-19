import React, { useEffect } from 'react';

export default function ProtectedRoute({ children, currentUser, requiredRole, navigateTo, showToast, authLoading }) {
  useEffect(() => {
    if (authLoading) return; // Wait until session check completes
    if (!currentUser) {
      showToast('Authentication required. Please log in.', 'warning');
      navigateTo('login');
    } else if (requiredRole && currentUser.role !== requiredRole) {
      showToast('Access denied. Admin permissions required.', 'error');
      navigateTo('home');
    }
  }, [currentUser, requiredRole, navigateTo, showToast, authLoading]);

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px', flexDirection: 'column', gap: '15px' }}>
        <div style={{ width: '30px', height: '30px', border: '3px solid var(--border-color)', borderTopColor: 'var(--text-main)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Verifying security session...</span>
      </div>
    );
  }

  if (!currentUser) return null;
  if (requiredRole && currentUser.role !== requiredRole) return null;

  return children;
}
