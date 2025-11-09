// background.js
// Listens for messages from content.js and updates the extension badge.

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === "updateBadge") {
        const color = message.level === "High" ? "#e74c3c" :
            message.level === "Medium" ? "#f1c40f" : "#2ecc71";
        chrome.action.setBadgeBackgroundColor({ color });
        chrome.action.setBadgeText({ text: message.level[0] }); // H / M / L
    }
});
