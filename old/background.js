chrome.runtime.onInstalled.addListener(function() {
  console.log('AI Job & Resume Analyzer installed!');
  
  // Set default settings
  chrome.storage.local.set({
    extensionEnabled: true,
    apiEndpoint: 'http://localhost:5000'
  });
});

// Handle messages from content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'analyzeWithAPI') {
    // Call your Python backend API
    fetch('http://localhost:5000/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: request.text })
    })
    .then(response => response.json())
    .then(data => sendResponse({ success: true, data: data }))
    .catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // Keep channel open for async response
  }
});
