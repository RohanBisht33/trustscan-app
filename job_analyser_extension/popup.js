document.addEventListener('DOMContentLoaded', function() {
  const browser = window.browser || window.chrome;
  const analyzeBtn = document.getElementById('analyzeBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const statusBadge = document.getElementById('statusBadge');

  browser.storage.local.get(['extensionEnabled'], function(result) {
    const enabled = result.extensionEnabled !== false;
    updateStatus(enabled);
  });

  analyzeBtn.addEventListener('click', function() {
    browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
      browser.tabs.sendMessage(tabs[0].id, {action: 'analyzeFullPage'});
      window.close();
    });
  });

  settingsBtn.addEventListener('click', function() {
    browser.storage.local.get(['extensionEnabled'], function(result) {
      const currentState = result.extensionEnabled !== false;
      const newState = !currentState;
      
      browser.storage.local.set({extensionEnabled: newState}, function() {
        updateStatus(newState);
        
        browser.tabs.query({active: true, currentWindow: true}, function(tabs) {
          browser.tabs.sendMessage(tabs[0].id, {
            action: 'toggleExtension',
            enabled: newState
          });
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
});
