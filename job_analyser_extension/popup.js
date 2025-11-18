document.addEventListener('DOMContentLoaded', function() {
  const browser = window.browser || window.chrome;
  const analyzeBtn = document.getElementById('analyzeBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const statusBadge = document.getElementById('statusBadge');

  // Load initial status
  browser.storage.local.get(['extensionEnabled'], function(result) {
    const enabled = result.extensionEnabled !== false;
    updateStatus(enabled);
  });

  // Check if current tab is compatible
  browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentTab = tabs[0];
    if (!isCompatibleTab(currentTab.url)) {
      disableAnalyzeButton('Not available on this page');
    }
  });

  analyzeBtn.addEventListener('click', function() {
    if (analyzeBtn.disabled) return;

    browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const currentTab = tabs[0];
      
      // Check if tab is compatible
      if (!isCompatibleTab(currentTab.url)) {
        showError('Cannot analyze this page. Please navigate to a website.');
        return;
      }

      // Send message with error handling
      browser.tabs.sendMessage(currentTab.id, {action: 'analyzeFullPage'})
        .then(() => {
          window.close();
        })
        .catch((error) => {
          console.error('Message sending failed:', error);
          
          // Try to inject content script if it's not loaded
          injectContentScriptAndAnalyze(currentTab.id);
        });
    });
  });

  settingsBtn.addEventListener('click', function() {
    browser.storage.local.get(['extensionEnabled'], function(result) {
      const currentState = result.extensionEnabled !== false;
      const newState = !currentState;
      
      browser.storage.local.set({extensionEnabled: newState}, function() {
        updateStatus(newState);
        
        // Notify content script if it exists
        browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
          const currentTab = tabs[0];
          
          if (isCompatibleTab(currentTab.url)) {
            browser.tabs.sendMessage(currentTab.id, {
              action: 'toggleExtension',
              enabled: newState
            }).catch(() => {
              // Silently fail if content script not loaded
              console.log('Content script not ready, settings saved');
            });
          }
        });
      });
    });
  });

  function updateStatus(enabled) {
    if (enabled) {
      statusBadge.textContent = 'Active';
      statusBadge.className = 'status-badge active';
      analyzeBtn.textContent = '🔍 Analyze This Page';
      settingsBtn.textContent = '⚙️ Disable Extension';
    } else {
      statusBadge.textContent = 'Inactive';
      statusBadge.className = 'status-badge inactive';
      analyzeBtn.textContent = '🔍 Enable & Analyze';
      settingsBtn.textContent = '⚙️ Enable Extension';
    }
  }

  function isCompatibleTab(url) {
    if (!url) return false;
    
    // Block extension on browser internal pages
    const incompatibleProtocols = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'file://'];
    
    return !incompatibleProtocols.some(protocol => url.startsWith(protocol));
  }

  function disableAnalyzeButton(message) {
    analyzeBtn.disabled = true;
    analyzeBtn.style.opacity = '0.5';
    analyzeBtn.style.cursor = 'not-allowed';
    analyzeBtn.textContent = `⚠️ ${message}`;
  }

  function showError(message) {
    // Create temporary error notification
    const originalText = analyzeBtn.textContent;
    analyzeBtn.textContent = `❌ ${message}`;
    analyzeBtn.style.background = '#ef4444';
    
    setTimeout(() => {
      analyzeBtn.textContent = originalText;
      analyzeBtn.style.background = '';
    }, 2500);
  }

  function injectContentScriptAndAnalyze(tabId) {
    // Try to inject content script dynamically
    browser.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    })
    .then(() => {
      // Wait a moment for script to initialize
      setTimeout(() => {
        browser.tabs.sendMessage(tabId, {action: 'analyzeFullPage'})
          .then(() => window.close())
          .catch(() => showError('Please refresh the page'));
      }, 500);
    })
    .catch((error) => {
      console.error('Script injection failed:', error);
      showError('Please refresh the page and try again');
    });
  }
});