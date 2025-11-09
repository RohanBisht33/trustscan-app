// popup.js
// Show last scan info + buttons for scan again and open official website

document.addEventListener("DOMContentLoaded", () => {
    const status = document.getElementById("status");
    const details = document.getElementById("details");
    const scanBtn = document.getElementById("scanBtn");
    const siteBtn = document.getElementById("siteBtn");

    // load last scan
    chrome.storage.local.get("lastScan", (data) => {
        if (data.lastScan) {
            const scan = data.lastScan;
            status.innerHTML = `<b>Risk Level:</b> <span class="${scan.riskLevel.toLowerCase()}">${scan.riskLevel}</span>`;
            details.innerHTML = `
        <p><b>URL:</b> ${scan.url}</p>
        <p><b>Time:</b> ${scan.time}</p>
        <p><b>Suspicious Phrases:</b> ${scan.details.suspiciousPhrases.join(", ") || "None"}</p>
        <p><b>Suspicious Emails:</b> ${scan.details.suspiciousEmails.join(", ") || "None"}</p>
        <p><b>Missing Website:</b> ${scan.details.missingWebsite ? "Yes" : "No"}</p>
      `;
        } else {
            status.textContent = "No scan data yet.";
        }
    });

    // re-scan current tab
    scanBtn.addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: "scanAgain" });
        });
        window.close();
    });

    // open extension's official site
    siteBtn.addEventListener("click", () => {
        // 🔗 put your site here — your extension’s homepage, GitHub repo, etc.
        const url = "https://trustscan-app-g977.vercel.app/";
        chrome.tabs.create({ url });
    });
});
