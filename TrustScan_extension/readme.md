# TrustScan — Real-time Fake Job Post Detector

Detects suspicious or fraudulent job posts while browsing job boards.

## Features
- Auto-scans webpage for job posts
- Detects red flags (keywords, suspicious emails, missing website)
- Assigns a risk score (Low/Medium/High)
- Shows popup summary
- Badge changes color
- Stores results locally (chrome.storage.local)
- Works offline — no API calls

## Structure
See `/trustscan-extension` folder.

## Install & Test (Chrome / Edge)
1. Open browser → `chrome://extensions/` or `edge://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select `trustscan-extension/` folder
5. Visit LinkedIn / Naukri / Indeed page → extension auto scans.
6. Click the TrustScan icon → view scan result.
7. Click “Scan Again” to re-check page.

## Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Choose any file from the `trustscan-extension/` folder (e.g., `manifest.json`)
4. Works same way.

## Compatibility
- Chrome (MV3)
- Microsoft Edge
- Firefox (WebExtension API)
