browser.runtime.onInstalled.addListener(function() {
  console.log('AI Job & Resume Analyzer installed!');
  
  browser.storage.local.set({
    extensionEnabled: true,
    apiEndpoint: 'http://localhost:5000'
  });
});

browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'analyzeWithAPI') {
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
    
    return true;
  }
});