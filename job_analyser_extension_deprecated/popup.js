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
    if (tabs[0]) {
      const currentTab = tabs[0];
      if (!isCompatibleTab(currentTab.url)) {
        disableAnalyzeButton('Not available on this page');
      }
    }
  });

  analyzeBtn.addEventListener('click', function() {
    if (analyzeBtn.disabled) return;

    browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs[0]) return;
      
      const currentTab = tabs[0];
      
      // Check if tab is compatible
      if (!isCompatibleTab(currentTab.url)) {
        showError('Cannot analyze this page');
        return;
      }

      // Use callback-based approach (Manifest V3 compatible)
      browser.tabs.sendMessage(
        currentTab.id, 
        {action: 'analyzeFullPage'},
        function(response) {
          // Check for errors
          if (browser.runtime.lastError) {
            console.log('Content script not ready:', browser.runtime.lastError.message);
            showError('Please refresh the page');
            return;
          }
          
          // Success
          window.close();
        }
      );
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
          if (!tabs[0]) return;
          
          const currentTab = tabs[0];
          
          if (isCompatibleTab(currentTab.url)) {
            browser.tabs.sendMessage(
              currentTab.id,
              {
                action: 'toggleExtension',
                enabled: newState
              },
              function() {
                // Ignore errors silently
                if (browser.runtime.lastError) {
                  console.log('Settings saved, content script will update on next load');
                }
              }
            );
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
    const incompatibleProtocols = [
      'chrome://', 
      'chrome-extension://', 
      'edge://', 
      'about:', 
      'file://',
      'view-source:',
      'data:'
    ];
    
    return !incompatibleProtocols.some(protocol => url.startsWith(protocol));
  }

  function disableAnalyzeButton(message) {
    analyzeBtn.disabled = true;
    analyzeBtn.style.opacity = '0.5';
    analyzeBtn.style.cursor = 'not-allowed';
    analyzeBtn.textContent = `⚠️ ${message}`;
  }

  function showError(message) {
    const originalText = analyzeBtn.textContent;
    const originalBg = analyzeBtn.style.background;
    
    analyzeBtn.textContent = `❌ ${message}`;
    analyzeBtn.style.background = '#ef4444';
    
    setTimeout(() => {
      analyzeBtn.textContent = originalText;
      analyzeBtn.style.background = originalBg;
    }, 2500);
  }
});