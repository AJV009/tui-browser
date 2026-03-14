/**
 * app.js — SPA router and state management.
 * Hash-based routing: #dashboard | #terminal/<sessionName>
 */

/* global Dashboard, TerminalView */

const App = (() => {
  let currentView = 'dashboard';
  let currentSession = null;

  const views = {
    dashboard: () => document.getElementById('dashboard-view'),
    terminal: () => document.getElementById('terminal-view'),
  };

  function navigate(view, params = {}) {
    if (view === 'terminal' && params.session) {
      window.location.hash = `#terminal/${encodeURIComponent(params.session)}`;
    } else {
      window.location.hash = '#dashboard';
    }
  }

  function handleRoute() {
    const hash = window.location.hash.slice(1) || 'dashboard';
    const parts = hash.split('/');
    const view = parts[0];

    // Hide all views
    views.dashboard().classList.add('hidden');
    views.terminal().classList.add('hidden');

    // Show back button only in terminal view
    const backBtn = document.getElementById('back-btn');

    if (view === 'terminal' && parts[1]) {
      const sessionName = decodeURIComponent(parts[1]);
      currentView = 'terminal';
      currentSession = sessionName;
      views.terminal().classList.remove('hidden');
      backBtn.style.display = 'inline-flex';
      document.getElementById('terminal-session-name').textContent = sessionName;
      TerminalView.connect(sessionName);
    } else {
      currentView = 'dashboard';
      currentSession = null;
      views.dashboard().classList.remove('hidden');
      backBtn.style.display = 'none';
      TerminalView.disconnect();
      Dashboard.refresh();
    }
  }

  function init() {
    window.addEventListener('hashchange', handleRoute);

    document.getElementById('back-btn').addEventListener('click', () => {
      navigate('dashboard');
    });


    // Initialize sub-modules
    Dashboard.init();
    TerminalView.init();

    // Route to initial view
    handleRoute();
  }

  return { init, navigate, getCurrentSession: () => currentSession };
})();

document.addEventListener('DOMContentLoaded', App.init);
