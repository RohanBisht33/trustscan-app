document.addEventListener('DOMContentLoaded', () => {
  const browser = window.browser || window.chrome;
  const analyzeBtn = document.getElementById('analyzeBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const visitWebsiteBtn = document.getElementById('visitWebsiteBtn');
  const extensionToggle = document.getElementById('extensionToggle');
  const statusBadge = document.getElementById('statusBadge');
  const statusCopy = document.getElementById('statusCopy');
  const themeButtons = document.querySelectorAll('[data-theme-option]');
  const body = document.body;
  let currentTheme = 'dark';
  let isCompatible = true;
  let toggling = false;

  browser.storage.local.get(['extensionEnabled', 'uiTheme'], (result) => {
    const enabled = result.extensionEnabled !== false;
    currentTheme = result.uiTheme || 'dark';
    updateStatus(enabled);
    syncThemeButtons(currentTheme);
    body.setAttribute('data-theme', currentTheme);
  });

  browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      isCompatible = isCompatibleTab(tabs[0].url);
      if (!isCompatible) {
        disableAnalyzeButtons('Not available on this page');
      }
    }
  });

  analyzeBtn.addEventListener('click', () => runAnalysis({ closePopup: true }));
  refreshBtn.addEventListener('click', () => runAnalysis({ closePopup: false }));
  
  visitWebsiteBtn.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('website/index.html') });
    window.close();
  });

  extensionToggle.addEventListener('change', () => {
    if (toggling) return;
    toggling = true;
    const newState = extensionToggle.checked;
    browser.storage.local.set({ extensionEnabled: newState }, () => {
      updateStatus(newState);
      notifyContentScript('toggleExtension', { enabled: newState }, () => {
        toggling = false;
      });
    });
  });

  themeButtons.forEach(button => {
    button.addEventListener('click', () => {
      const theme = button.dataset.themeOption || 'dark';
      currentTheme = theme;
      body.setAttribute('data-theme', theme);
      syncThemeButtons(theme);
      browser.storage.local.set({ uiTheme: theme }, () => {
        notifyContentScript('setTheme', { theme });
      });
    });
  });

  function runAnalysis({ closePopup }) {
    if (analyzeBtn.disabled || !isCompatible) return;

    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !isCompatibleTab(tabs[0].url)) {
        showError('Cannot analyze this page');
        return;
      }

      const loadingText = closePopup ? 'Pulsing…' : 'Refreshing…';
      const targetBtn = closePopup ? analyzeBtn : refreshBtn;
      const originalLabel = targetBtn.textContent;
      targetBtn.textContent = loadingText;
      targetBtn.disabled = true;

      browser.tabs.sendMessage(
        tabs[0].id,
        { action: 'analyzeFullPage' },
        () => {
          targetBtn.textContent = originalLabel;
          targetBtn.disabled = false;

          if (browser.runtime.lastError) {
            showError('Please refresh the page');
            return;
          }

          if (closePopup) {
            window.close();
          } else {
            refreshBtn.textContent = 'Insights updated';
            setTimeout(() => {
              refreshBtn.textContent = 'Re-run hover insights';
            }, 1800);
          }
        }
      );
    });
  }

  function updateStatus(enabled) {
    extensionToggle.checked = enabled;
    if (enabled) {
      statusBadge.textContent = 'Active';
      statusBadge.classList.remove('inactive');
      statusCopy.textContent = 'Enabled';
      analyzeBtn.textContent = 'Pulse this page';
    } else {
      statusBadge.textContent = 'Paused';
      statusBadge.classList.add('inactive');
      statusCopy.textContent = 'Disabled';
      analyzeBtn.textContent = 'Enable & pulse';
    }
  }

  function notifyContentScript(action, payload, cb) {
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !isCompatibleTab(tabs[0].url)) {
        if (cb) cb();
        return;
      }
      browser.tabs.sendMessage(
        tabs[0].id,
        { action, ...payload },
        () => {
          if (cb) cb();
        }
      );
    });
  }

  function syncThemeButtons(theme) {
    themeButtons.forEach(btn => {
      if (btn.dataset.themeOption === theme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function isCompatibleTab(url) {
    if (!url) return false;
    const incompatibleProtocols = [
      'chrome://',
      'chrome-extension://',
      'edge://',
      'about:',
      'view-source:',
      'data:'
    ];
    return !incompatibleProtocols.some(protocol => url.startsWith(protocol));
  }

  function disableAnalyzeButtons(message) {
    analyzeBtn.disabled = true;
    refreshBtn.disabled = true;
    analyzeBtn.textContent = `⚠️ ${message}`;
    refreshBtn.textContent = message;
  }

  function showError(message) {
    const originalText = analyzeBtn.textContent;
    analyzeBtn.textContent = `❌ ${message}`;
    setTimeout(() => {
      analyzeBtn.textContent = originalText;
    }, 2200);
  }
});