// content.js
// Automatically scans webpage for job post data and sends score to popup/background.

(function () {
    // Rule-based red flags
    const redFlagKeywords = [
        /registration\s*fee/i,
        /security\s*deposit/i,
        /pay\s*to\s*apply/i,
        /urgent\s*hiring/i,
        /part[\s-]*time\s*from\s*home/i,
        /easy\s*income/i,
        /work\s*from\s*home\s*and\s*earn/i
    ];

    const suspiciousEmails = [
        /@gmail\.com/i, /@yahoo\.com/i, /@outlook\.com/i, /@hotmail\.com/i
    ];

    function scanPage() {
        const text = document.body.innerText;
        const results = {
            suspiciousPhrases: [],
            suspiciousEmails: [],
            missingWebsite: false
        };

        // 1️⃣ Keyword red flags
        redFlagKeywords.forEach(regex => {
            if (regex.test(text)) results.suspiciousPhrases.push(regex.toString());
        });

        // 2️⃣ Suspicious email domains
        const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g) || [];
        emails.forEach(email => {
            if (suspiciousEmails.some(r => r.test(email))) {
                results.suspiciousEmails.push(email);
            }
        });

        // 3️⃣ Missing website/contact info
        if (!/https?:\/\/[^\s]+/i.test(text) && results.suspiciousEmails.length > 0) {
            results.missingWebsite = true;
        }

        // 4️⃣ Risk scoring
        let riskScore = 0;
        riskScore += results.suspiciousPhrases.length * 3;
        riskScore += results.suspiciousEmails.length * 2;
        if (results.missingWebsite) riskScore += 1;

        let riskLevel = "Low";
        if (riskScore >= 5) riskLevel = "High";
        else if (riskScore >= 2) riskLevel = "Medium";

        // Save to storage
        const flaggedData = {
            url: window.location.href,
            time: new Date().toLocaleString(),
            riskLevel,
            details: results
        };

        chrome.storage.local.set({ lastScan: flaggedData });
        chrome.runtime.sendMessage({ type: "updateBadge", level: riskLevel });
    }

    // Auto-run after page load
    window.addEventListener("load", scanPage);

    // Allow manual trigger
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "scanAgain") scanPage();
    });
})();
