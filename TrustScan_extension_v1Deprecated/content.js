// content.js
// AI-powered TrustScan using Google Cloud API (Gemini/PaLM style)

(function () {
    const API_KEY = "AIzaSyAty8S7qWDKtSO70WYseE5KTVZ16EUMu-Y";

    async function scanPage() {
        const text = document.body.innerText.slice(0, 20000); // limit to avoid huge payloads
        const prompt = `6
        Analyze this job post text for potential scam/fraud indicators.
        Rate it as Low, Medium, or High risk.
        Return JSON like:
        {"risk":"High","reason":"mentions fees and gmail contact"}
        Job text: ${text}6
        `;

        let riskLevel = "Low";
        let reason = "None";

        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            });

            const data = await res.json();
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            console.log("Gemini API raw response:", raw);

            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                riskLevel = parsed.risk || "Low";
                reason = parsed.reason || "No reason given.";
            } else {
                riskLevel = "Medium";
                reason = "Unable to parse response.";
            }
        } catch (err) {
            console.error("AI Scan error:", err);
            riskLevel = "Medium";
            reason = "Error contacting API.";
        }

        const flaggedData = {
            url: window.location.href,
            time: new Date().toLocaleString(),
            riskLevel,
            reason
        };

        chrome.storage.local.set({ lastScan: flaggedData });
        chrome.runtime.sendMessage({ type: "updateBadge", level: riskLevel });
    }

    window.addEventListener("load", scanPage);
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "scanAgain") scanPage();
    });
})();
