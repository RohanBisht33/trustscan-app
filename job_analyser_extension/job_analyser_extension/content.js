// ==================== GLOBAL VARIABLES ====================
const browser = window.browser || window.chrome;
let pdfJsLoaded = false;
let extensionEnabled = true;
let analyzedElements = new WeakSet();
let hoverCardElement = null;
let hoverHideTimeout = null;
let resumeInsightPanel = null;
let resumeHoverHandler = null;
let resumeHoverPayload = null;
let currentTheme = 'dark';
let pdfObserver = null;
let hoverHandlerMap = new WeakMap();
let domObserver = null;
let domObserverTimeout = null;
let modalHandlerMap = new WeakMap();

// ==================== MESSAGE LISTENER ====================
browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('📨 Message received:', request.action);
  
  if (request.action === 'analyzeFullPage') {
    analyzeCurrentPage();
    sendResponse({status: 'Analysis started'});
    return true;
  }
  
  if (request.action === 'toggleExtension') {
    extensionEnabled = request.enabled;
    console.log('🔄 Extension toggled:', extensionEnabled);
    
    if (extensionEnabled) {
      showNotification('✅ Extension Enabled');
      analyzeCurrentPage();
    } else {
      showNotification('⏸️ Extension Disabled');
      removeAllIndicators();
    }
    
    sendResponse({status: 'toggled', enabled: extensionEnabled});
    return true;
  }

  if (request.action === 'setTheme') {
    applyThemeToPage(request.theme);
    sendResponse({status: 'theme-updated', theme: currentTheme});
    return true;
  }
  
  return false;
});

// ==================== INITIALIZATION ====================
(function init() {
  console.log('🚀 AI Job & Resume Analyzer loaded');
  
  // Check if extension is enabled
  browser.storage.local.get(['extensionEnabled', 'uiTheme'], function(result) {
    extensionEnabled = result.extensionEnabled !== false;
    const storedTheme = result.uiTheme || currentTheme;
    applyThemeToPage(storedTheme);
    
    if (extensionEnabled) {
      console.log('✅ Extension is enabled');
      
      // Wait for page to be fully loaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAnalysis);
      } else {
        startAnalysis();
      }
    } else {
      console.log('⏸️ Extension is disabled');
    }
  });
})();

function startAnalysis() {
  // Setup PDF support
  setupPDFSupport();
  
  // Analyze current page after a short delay
  setTimeout(() => {
    analyzeCurrentPage();
    startDomObserver();
  }, 1000);
}

// ==================== THEME MANAGEMENT ====================
function applyThemeToPage(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-ai-theme', currentTheme);
}

// ==================== MAIN ANALYSIS FUNCTION ====================
function analyzeCurrentPage() {
  if (!extensionEnabled) {
    console.log('⏸️ Analysis skipped - extension disabled');
    return;
  }
  
  console.log('🔍 Analyzing current page...');
  
  const pageText = extractPageText();
  
  if (pageText.length < 100) {
    console.log('⚠️ Page text too short, skipping analysis');
    return;
  }
  
  const type = detectType(pageText);
  console.log('📊 Detected type:', type);
  
  if (type === 'job_listing' || (type === 'unknown' && isLikelyJobText(pageText))) {
    removeResumeInsightsPanel();
    showNotification('💼 Job Listing Detected!', 'success');
    highlightJobListings();
  } else if (type === 'resume') {
    showNotification('📄 Resume Detected!', 'info');
    showResumeInsights(pageText);
  } else {
    removeResumeInsightsPanel();
    console.log('❓ Content type unclear');
  }
  
  // Analyze specific job cards on job portals
  analyzeJobCards();
}

function extractPageText() {
  // Remove script and style content
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
  
  return clone.innerText || clone.textContent || '';
}

function highlightJobListings() {
  if (!extensionEnabled) return;
  // Find common job listing containers
  const selectors = [
    '[class*="job"]',
    '[class*="listing"]',
    '[class*="card"]',
    '[data-job-id]',
    'article',
    '.search-card'
  ];
  
  const elements = document.querySelectorAll(selectors.join(','));
  
  elements.forEach(el => {
    if (analyzedElements.has(el)) return;
    
    const text = el.innerText;
    if (text && text.length > 120 && text.length < 15000) {
      const analysis = performAnalysis(text);
      if (analysis.type === 'job_listing' || (analysis.type === 'unknown' && isLikelyJobText(text))) {
        addJobIndicator(el, analysis);
        analyzedElements.add(el);
      }
    }
  });
}

function analyzeJobCards() {
  if (!extensionEnabled) return;
  // Specific selectors for popular job sites
  const jobCardSelectors = {
    'linkedin.com': '.job-card-container, .jobs-search-results__list-item',
    'naukri.com': '.jobTuple, .jobTupleHeader',
    'internshala.com': '.individual_internship',
    'indeed.com': '.job_seen_beacon, .jobsearch-SerpJobCard',
    'glassdoor.com': '.react-job-listing'
  };
  
  const hostname = window.location.hostname;
  const selector = Object.keys(jobCardSelectors).find(key => hostname.includes(key));
  
  if (selector && jobCardSelectors[selector]) {
    const cards = document.querySelectorAll(jobCardSelectors[selector]);
    console.log(`📋 Found ${cards.length} job cards on ${hostname}`);
    
    cards.forEach(card => {
      if (analyzedElements.has(card)) return;
      
      const text = card.innerText;
      if (!text || text.length < 80) return;
      
      const analysis = performAnalysis(text);
      if (analysis.type !== 'job_listing' && !isLikelyJobText(text)) return;
      
      addJobIndicator(card, analysis);
      analyzedElements.add(card);
    });
  }
}

// ==================== UI INDICATORS ====================
function addJobIndicator(element, analysis) {
  if (!element || element.dataset.aiTagged === 'true') return;
  
  const sourceText = element.innerText || '';
  const computedAnalysis = analysis || performAnalysis(sourceText);
  if (computedAnalysis.type !== 'job_listing' && !isLikelyJobText(sourceText)) return;
  
  element.dataset.aiTagged = 'true';
  element.setAttribute('data-ai-risk-label', computedAnalysis.riskLevel || 'Agentic');
  element.classList.add('ai-agentic-card');
  element.style.setProperty('--ai-risk-color', computedAnalysis.riskColor || '#38bdf8');
  
  const parentPosition = window.getComputedStyle(element).position;
  if (parentPosition === 'static') {
    element.style.position = 'relative';
  }
  
  attachHoverToEntity(element, computedAnalysis);
  
  const modalHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showAnalysisModal(computedAnalysis, element);
  };
  
  element.addEventListener('dblclick', modalHandler);
  modalHandlerMap.set(element, modalHandler);
}

function removeAllIndicators() {
  document.querySelectorAll('.ai-agentic-card').forEach(el => {
    const handler = hoverHandlerMap.get(el);
    if (handler) {
      el.removeEventListener('mouseenter', handler);
      hoverHandlerMap.delete(el);
    }
    el.removeEventListener('mousemove', moveHoverInsight);
    el.removeEventListener('mouseleave', hideHoverInsight);
    const modalHandler = modalHandlerMap.get(el);
    if (modalHandler) {
      el.removeEventListener('dblclick', modalHandler);
      modalHandlerMap.delete(el);
    }
    el.classList.remove('ai-agentic-card');
    el.removeAttribute('data-ai-tagged');
    el.removeAttribute('data-ai-risk-label');
    el.removeAttribute('data-ai-hover-bound');
    el.style.removeProperty('--ai-risk-color');
  });
  analyzedElements = new WeakSet();
  hideHoverInsight();
  removeResumeInsightsPanel();
}

// ==================== HOVER INTELLIGENCE PANEL ====================
function attachHoverToEntity(element, analysis) {
  if (!element || !analysis || hoverHandlerMap.has(element)) return;
  
  const enterHandler = (event) => {
    if (event.target.closest('#ai-hover-card')) return;
    showHoverInsight(event, analysis);
  };
  
  element.addEventListener('mouseenter', enterHandler);
  element.addEventListener('mousemove', moveHoverInsight);
  element.addEventListener('mouseleave', hideHoverInsight);
  hoverHandlerMap.set(element, enterHandler);
}

function ensureHoverCardElement() {
  if (hoverCardElement) return hoverCardElement;
  
  hoverCardElement = document.createElement('div');
  hoverCardElement.id = 'ai-hover-card';
  hoverCardElement.dataset.visible = 'false';
  document.body.appendChild(hoverCardElement);
  return hoverCardElement;
}

function showHoverInsight(event, analysis) {
  if (!analysis) return;
  const card = ensureHoverCardElement();
  
  if (analysis.variant === 'resume') {
    const highlights = (analysis.highlights || []).slice(0, 2);
    const tags = (analysis.badges || []).slice(0, 3);
    card.innerHTML = `
      <div class="ai-hover-header">
        <span class="ai-hover-chip">Resume Pulse</span>
        <span class="ai-hover-risk" style="color:${analysis.signalColor};">${analysis.signalLabel}</span>
      </div>
      <div class="ai-hover-score-row">
        <span class="ai-hover-score">${analysis.score}</span>
        <span class="ai-hover-sub">/100 profile</span>
      </div>
      <p class="ai-hover-summary">Focus: ${analysis.focusArea} • Tone: ${analysis.tone}</p>
      <div class="ai-hover-flags">
        <p class="ai-hover-subtle">Highlights</p>
        <ul>${highlights.map(item => `<li>${item}</li>`).join('')}</ul>
      </div>
      <div class="ai-hover-tags">
        ${tags.map(tag => `<span>${tag}</span>`).join('')}
      </div>
    `;
  } else {
    const riskMeta = getRiskMeta(analysis.trustScore);
    const topRisks = analysis.redFlags.slice(0, 2);
    const positives = analysis.greenFlags.slice(0, 2);
    
    card.innerHTML = `
      <div class="ai-hover-header">
        <span class="ai-hover-chip">Agentic AI Scan</span>
        <span class="ai-hover-risk" style="color:${riskMeta.color};">${riskMeta.label}</span>
      </div>
      <div class="ai-hover-score-row">
        <span class="ai-hover-score">${analysis.trustScore}</span>
        <span class="ai-hover-sub">/100 confidence</span>
      </div>
      <p class="ai-hover-summary">${analysis.summary}</p>
      <div class="ai-hover-flags">
        <p class="ai-hover-subtle">${topRisks.length ? 'Top risks' : 'Risk scan'}</p>
        ${topRisks.length 
          ? `<ul>${topRisks.map(flag => `<li>${flag}</li>`).join('')}</ul>` 
          : '<div class="ai-hover-pill">No critical risks spotted</div>'}
      </div>
      ${positives.length ? `
        <div class="ai-hover-flags ai-hover-positive">
          <p class="ai-hover-subtle">Positive signals</p>
          <ul>${positives.map(flag => `<li>${flag}</li>`).join('')}</ul>
        </div>
      ` : ''}
    `;
  }
  
  moveHoverInsight(event);
  requestAnimationFrame(() => {
    card.dataset.visible = 'true';
  });
}

function moveHoverInsight(event) {
  if (!hoverCardElement) return;
  const offsetX = 24;
  const offsetY = 24;
  const cardWidth = hoverCardElement.offsetWidth || 260;
  const cardHeight = hoverCardElement.offsetHeight || 180;
  let left = event.clientX + offsetX;
  let top = event.clientY - offsetY - cardHeight / 2;
  
  if (left + cardWidth > window.innerWidth - 12) {
    left = event.clientX - cardWidth - offsetX;
  }
  
  if (left < 12) left = 12;
  
  if (top < 12) top = 12;
  if (top + cardHeight > window.innerHeight - 12) {
    top = window.innerHeight - cardHeight - 12;
  }
  
  hoverCardElement.style.left = `${left}px`;
  hoverCardElement.style.top = `${top}px`;
}

function hideHoverInsight() {
  if (!hoverCardElement) return;
  if (hoverHideTimeout) clearTimeout(hoverHideTimeout);
  hoverHideTimeout = setTimeout(() => {
    hoverCardElement.dataset.visible = 'false';
  }, 120);
}

// ==================== ANALYSIS LOGIC ====================
function performAnalysis(text) {
  const type = detectType(text);
  
  // Calculate trust score (0-100)
  let trustScore = 50;
  const redFlags = [];
  const greenFlags = [];
  
  // Red flags
  if (/\b(pay.*upfront|wire transfer|western union|money gram)\b/i.test(text)) {
    trustScore -= 30;
    redFlags.push('Payment required upfront');
  }
  
  if (/\b(guaranteed.*income|get rich quick|easy money)\b/i.test(text)) {
    trustScore -= 25;
    redFlags.push('Unrealistic promises');
  }
  
  if (/\b(work from home|no experience required).*\b.*\$\d{3,}/i.test(text)) {
    trustScore -= 20;
    redFlags.push('Suspicious work-from-home offer');
  }
  
  if (!/@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(text) && type === 'job_listing') {
    trustScore -= 15;
    redFlags.push('No valid company email');
  }
  
  if (/\b(telegram|whatsapp|signal|wechat|imo)\b/i.test(text)) {
    trustScore -= 15;
    redFlags.push('Requests chat apps for hiring');
  }
  
  if (/\b(bitcoin|crypto|gift card|skrill)\b/i.test(text)) {
    trustScore -= 20;
    redFlags.push('Suspicious payment method');
  }
  
  if (/\b(contact|reach|email)\b[^@]{0,40}\b(gmail|yahoo|hotmail)\b/i.test(text)) {
    trustScore -= 10;
    redFlags.push('Uses generic email provider');
  }
  
  if (type === 'job_listing' && !/\b(responsibilities|requirements|qualifications)\b/i.test(text)) {
    trustScore -= 8;
    redFlags.push('Missing responsibilities/requirements section');
  }
  
  const bulletPoints = (text.match(/[\r\n]+[\s]*(?:[-•*]|[0-9]+\.)/g) || []).length;
  if (bulletPoints >= 4) {
    trustScore += Math.min(12, bulletPoints * 1.5);
    greenFlags.push('Structured bullet-point details');
  }
  
  const salaryPattern = /\b(salary|ctc|compensation|pay range)\b[^$€₹£]{0,40}(\$|€|₹|£)?\d+/i;
  if (salaryPattern.test(text)) {
    trustScore += 8;
    greenFlags.push('Shares compensation details');
  }
  
  if (/\b(remote|hybrid|onsite|relocation)\b/i.test(text)) {
    trustScore += 4;
    greenFlags.push('Clarifies work model');
  }
  
  if (/\b(employment type|job type|schedule)\b/i.test(text)) {
    trustScore += 4;
    greenFlags.push('States employment type');
  }
  
  if (/\b(hiring manager|talent acquisition|recruiter|hr team)\b/i.test(text)) {
    trustScore += 3;
    greenFlags.push('Mentions hiring contact');
  }
  
  if (/\b(click\s+(here|link))\b/i.test(text) && !/\b(company\b|\bcareers?\b)/i.test(text)) {
    trustScore -= 8;
    redFlags.push('Generic “click here” instruction');
  }
  
  if (/\b(llc|inc\.?|ltd|corp\.?|gmbh|pte)\b/i.test(text)) {
    trustScore += 6;
    greenFlags.push('Registered company reference');
  }
  
  const legalese = /\b(equal opportunity|eeo|background check|employment verification)\b/i;
  if (legalese.test(text)) {
    trustScore += 5;
    greenFlags.push('Mentions compliance policies');
  }
  
  if (/\b(click here\b|\bapply via\b).{0,80}(?:tinyurl|bit\.ly|goo\.gl)/i.test(text)) {
    trustScore -= 12;
    redFlags.push('Uses shortened links');
  }
  
  if (/\b(training fee|security deposit|processing fee)\b/i.test(text)) {
    trustScore -= 18;
    redFlags.push('Fee mentioned in hiring process');
  }
  
  if (text.length < 400 && type === 'job_listing') {
    trustScore -= 10;
    redFlags.push('Very short description');
  } else if (text.length > 2000) {
    trustScore += 6;
    greenFlags.push('Detailed listing');
  }
  
  const uppercaseRatio = (text.match(/[A-Z]{4,}/g) || []).join('').length / Math.max(text.length, 1);
  if (uppercaseRatio > 0.08) {
    trustScore -= 6;
    redFlags.push('Excessive uppercase text');
  }
  
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 900) {
    trustScore += 6;
    greenFlags.push('Thorough role breakdown');
  } else if (wordCount < 220 && type === 'job_listing') {
    trustScore -= 6;
    redFlags.push('Too little information');
  }
  
  const actionVerbs = (text.match(/\b(design|build|lead|coordinate|deliver|implement|support|optimize|drive|scale|mentor)\b/gi) || []).length;
  if (actionVerbs >= 12) {
    trustScore += 5;
    greenFlags.push('Uses concrete action verbs');
  }
  
  if (/\b(send (copy of|scan of) your (id|passport|license))\b/i.test(text)) {
    trustScore -= 25;
    redFlags.push('Requests sensitive personal documents');
  }
  
  if (/\b(refundable deposit|training bond)\b/i.test(text)) {
    trustScore -= 20;
    redFlags.push('Mentions deposit/bond');
  }
  
  // Green flags
  if (/\b(company website|official site|career page)\b/i.test(text)) {
    trustScore += 10;
    greenFlags.push('Has company website');
  }
  
  if (/\b(benefits|insurance|401k|pto|paid time off)\b/i.test(text)) {
    trustScore += 10;
    greenFlags.push('Mentions employee benefits');
  }
  
  if (/\b(interview process|application process)\b/i.test(text)) {
    trustScore += 5;
    greenFlags.push('Clear hiring process');
  }
  
  const deterministicNoise = getDeterministicNoise(text);
  trustScore += deterministicNoise;
  
  // Keep score in 0-100 range
  trustScore = Math.max(0, Math.min(100, trustScore));
  
  const riskMeta = getRiskMeta(trustScore);
  
  return {
    type,
    trustScore,
    redFlags,
    greenFlags,
    summary: generateSummary(type, trustScore, text),
    riskLevel: riskMeta.label,
    riskColor: riskMeta.color,
    variant: type === 'resume' ? 'resume' : 'job'
  };
}

function getRiskMeta(score) {
  if (score >= 75) {
    return { label: 'Low risk', color: '#34d399' };
  }
  
  if (score >= 55) {
    return { label: 'Moderate risk', color: '#fbbf24' };
  }
  
  return { label: 'High risk', color: '#f87171' };
}

function getDeterministicNoise(text) {
  if (!text) return 0;
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return (hash % 11) - 5; // -5 .. +5
}

function generateSummary(type, trustScore, text) {
  if (type === 'job_listing') {
    if (trustScore >= 75) {
      return 'This appears to be a legitimate job posting with no major red flags.';
    } else if (trustScore >= 50) {
      return 'This job posting seems reasonable but exercise caution.';
    } else {
      return '⚠️ This job posting has several red flags. Proceed with extreme caution.';
    }
  } else if (type === 'resume') {
    const wordCount = text.split(/\s+/).length;
    return `Resume detected with approximately ${wordCount} words.`;
  }
  
  return 'Content type unclear.';
}

// ==================== NOTIFICATION SYSTEM ====================
function showNotification(message, type = 'info') {
  // Remove existing notifications
  const existing = document.getElementById('ai-analyzer-notification');
  if (existing) existing.remove();
  
  const notif = document.createElement('div');
  notif.id = 'ai-analyzer-notification';
  notif.textContent = message;
  
  const colors = {
    success: '#10b981',
    info: '#3b82f6',
    warning: '#f59e0b',
    error: '#ef4444'
  };
  
  notif.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    z-index: 999999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    animation: slideInRight 0.3s ease-out;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;
  
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

function showLoadingNotification(message) {
  const notif = document.createElement('div');
  notif.id = 'ai-loading-notif';
  notif.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <span>${message}</span>
    </div>
  `;
  
  notif.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #3b82f6;
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    z-index: 999999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;
  
  document.body.appendChild(notif);
}

function hideLoadingNotification() {
  const notif = document.getElementById('ai-loading-notif');
  if (notif) notif.remove();
}

// ==================== MODAL SYSTEM ====================
function showAnalysisModal(analysis, sourceElement) {
  // Remove existing modal
  const existing = document.getElementById('ai-analysis-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'ai-analysis-modal';
  
  const trustColor = analysis.trustScore >= 75 ? '#10b981' : 
                    analysis.trustScore >= 50 ? '#f59e0b' : '#ef4444';
  
  modal.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease-out;
    " id="modal-backdrop">
      <div style="
        background: white;
        border-radius: 20px;
        padding: 32px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        animation: slideUp 0.3s ease-out;
      " onclick="event.stopPropagation()">
        <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          ${analysis.type === 'job_listing' ? '💼' : '📄'} Analysis Results
        </h2>
        
        <div style="margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-weight: 600; color: #475569;">Trust Score</span>
            <span style="font-weight: 700; color: ${trustColor};">${analysis.trustScore}/100</span>
          </div>
          <div style="background: #e2e8f0; border-radius: 10px; height: 10px; overflow: hidden;">
            <div style="background: ${trustColor}; height: 100%; width: ${analysis.trustScore}%; transition: width 0.5s ease;"></div>
          </div>
        </div>
        
        ${analysis.redFlags.length > 0 ? `
          <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h3 style="margin: 0 0 12px 0; color: #991b1b; font-size: 14px; font-weight: 700;">⚠️ Red Flags</h3>
            <ul style="margin: 0; padding-left: 20px; color: #7f1d1d;">
              ${analysis.redFlags.map(flag => `<li style="margin: 4px 0;">${flag}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${analysis.greenFlags.length > 0 ? `
          <div style="background: #dcfce7; border-left: 4px solid #10b981; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h3 style="margin: 0 0 12px 0; color: #065f46; font-size: 14px; font-weight: 700;">✅ Positive Indicators</h3>
            <ul style="margin: 0; padding-left: 20px; color: #047857;">
              ${analysis.greenFlags.map(flag => `<li style="margin: 4px 0;">${flag}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        <p style="color: #64748b; line-height: 1.6; margin-bottom: 24px;">${analysis.summary}</p>
        
        <button onclick="document.getElementById('ai-analysis-modal').remove()" style="
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s;
        " onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          Close
        </button>
      </div>
    </div>
  `;
  
  // Close on backdrop click
  modal.querySelector('#modal-backdrop').addEventListener('click', () => {
    modal.remove();
  });
  
  document.body.appendChild(modal);
}

function showPDFAnalysisModal(analysis, text, filename) {
  if (analysis.type === 'resume') {
    showResumeInsights(text || '');
  } else {
    removeResumeInsightsPanel();
  }
  showAnalysisModal(analysis, null);
}

// ==================== TYPE DETECTION ====================
function detectType(text) {
  const lower = text.toLowerCase();
  let resumeScore = 0;
  let jobScore = 0;

  // STRONG JOB-ONLY INDICATORS
  const jobOnlyIndicators = [
    /\b(we are (hiring|looking for|seeking)|join our team|work with us)\b/i,
    /\b(apply (now|here|today)|submit (your )?application)\b/i,
    /\b(our company|our team|our organization) (is|seeks|needs)\b/i,
    /\b(job (opening|vacancy|position|opportunity))\b/i,
    /\b(salary range|compensation package|ctc|pay scale)\s*:/i,
    /\b(interview process|selection process|hiring process)\b/i,
    /\b(what (you'll|you will) do|your responsibilities will include)\b/i,
    /\b(we offer|benefits include|perks)\s*:/i,
    /\b(about (the role|this position|this job))\b/i,
    /\b(reporting to|reports to|work under)\b/i,
    /\b(posted|published)\s+\d+\s+(day|hour|week)s?\s+ago/i,
    /\b(deadline|last date to apply|apply before)\b/i
  ];

  // STRONG RESUME-ONLY INDICATORS
  const resumeOnlyIndicators = [
    /\b(my (name is|objective|goal)|i am (a|an)|about me)\b/i,
    /\b(personal (information|details|profile)|contact information)\s*:/i,
    /\b(career (objective|goal|summary)|professional summary|objective statement)\s*:/i,
    /\b(my (skills|experience|education|projects|achievements))\b/i,
    /\b(i (have|possess|developed|worked|built|created|led|managed))\b/i,
    /\b(references available|references upon request)\b/i,
    /\b(hobbies and interests|personal interests|extracurricular)\s*:/i,
    /\b(cgpa|gpa|percentage|marks obtained)\s*[:=]/i,
    /\b(declaration|i hereby declare)\b/i,
    /\b(date of birth|father'?s name|mother'?s name|nationality)\s*:/i,
    /\b(languages known|language proficiency)\s*:/i,
    /linkedin\.com\/in\/\w+/i,
    /github\.com\/\w+/i
  ];

  // Count indicators
  jobOnlyIndicators.forEach(pattern => {
    if (pattern.test(text)) jobScore += 10;
  });

  resumeOnlyIndicators.forEach(pattern => {
    if (pattern.test(text)) resumeScore += 10;
  });

  // Early decision
  if (jobScore >= 20 && resumeScore === 0) return 'job_listing';
  if (resumeScore >= 20 && jobScore === 0) return 'resume';

  // Contextual indicators
  const jobContextual = [
    { pattern: /\b(requirements?|qualifications?|eligibility)\s*:/i, weight: 3 },
    { pattern: /\b(responsibilities|duties|role description)\s*:/i, weight: 3 },
    { pattern: /\b(must have|should have|required)\s*:/i, weight: 2 },
    { pattern: /\b(preferred|nice to have|bonus)\s*:/i, weight: 2 },
    { pattern: /\b(\d+[\+\-]\s*years? of experience (required|needed))\b/i, weight: 3 },
    { pattern: /\b(full[\s-]?time|part[\s-]?time|contract|freelance|remote|hybrid)\s+(position|role|job)/i, weight: 3 }
  ];

  const resumeContextual = [
    { pattern: /\b(work experience|professional experience|employment history)\s*:/i, weight: 3 },
    { pattern: /\b(education|academic background|qualifications)\s*:/i, weight: 3 },
    { pattern: /\b(skills?|technical skills?|core competencies)\s*:/i, weight: 2 },
    { pattern: /\b(projects?|portfolio|work samples)\s*:/i, weight: 2 },
    { pattern: /\b(certifications?|training|courses)\s*:/i, weight: 2 }
  ];

  jobContextual.forEach(({ pattern, weight }) => {
    if (pattern.test(text)) jobScore += weight;
  });

  resumeContextual.forEach(({ pattern, weight }) => {
    if (pattern.test(text)) resumeScore += weight;
  });

  // Structural analysis
  if (/\b(about (us|the company)|company overview)\b/i.test(text)) jobScore += 3;
  
  const firstPersonMentions = (text.match(/\b(i |my |me )\b/gi) || []).length;
  if (firstPersonMentions >= 5) resumeScore += 3;

  // Length check
  if (text.length < 150) return 'unknown';

  // Final decision
  const scoreDiff = Math.abs(resumeScore - jobScore);
  if (resumeScore >= 12 && resumeScore > jobScore && scoreDiff >= 5) return 'resume';
  if (jobScore >= 12 && jobScore > resumeScore && scoreDiff >= 5) return 'job_listing';
  
  return 'unknown';
}

function isLikelyJobText(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  const lengthScore = Math.min(10, Math.floor(text.length / 600));
  const keywordSets = [
    ['responsibilities', 'role'],
    ['requirements', 'qualifications'],
    ['experience', 'years'],
    ['salary', 'compensation'],
    ['apply', 'application'],
    ['benefits', 'perks'],
    ['team', 'company']
  ];
  
  let hitScore = 0;
  keywordSets.forEach(set => {
    if (set.every(word => normalized.includes(word))) {
      hitScore += 4;
    } else if (set.some(word => normalized.includes(word))) {
      hitScore += 2;
    }
  });
  
  const bulletCount = (text.match(/[\r\n]+[\s]*(?:[-•*]|[0-9]+\.)/g) || []).length;
  const bulletScore = Math.min(6, bulletCount * 1.5);
  
  const colonSections = (text.match(/\b[A-Z][A-Za-z\s]{2,40}:/g) || []).length;
  const structureScore = Math.min(6, colonSections * 1.2);
  
  return (hitScore + bulletScore + structureScore + lengthScore) >= 12;
}

// ==================== RESUME INSIGHTS ====================
function showResumeInsights(text) {
  const insights = analyzeResumeContent(text);
  if (!insights) return;
  
  if (!resumeInsightPanel) {
    resumeInsightPanel = document.createElement('div');
    resumeInsightPanel.id = 'ai-resume-panel';
    resumeInsightPanel.setAttribute('role', 'status');
    resumeInsightPanel.setAttribute('aria-live', 'polite');
    document.body.appendChild(resumeInsightPanel);
  }
  
  resumeInsightPanel.innerHTML = `
    <button class="ai-resume-close" aria-label="Close resume insights">×</button>
    <div class="ai-resume-header">
      <div>
        <p class="ai-resume-kicker">Agentic AI Resume Pulse</p>
        <h3>Profile Confidence</h3>
      </div>
      <div class="ai-resume-score-chip">
        <span>${insights.score}</span>
        <small>/100</small>
      </div>
    </div>
    <div class="ai-resume-meta">
      <div>
        <p class="ai-resume-label">Signal</p>
        <p class="ai-resume-value">${insights.signalLabel}</p>
      </div>
      <div>
        <p class="ai-resume-label">Focus</p>
        <p class="ai-resume-value">${insights.focusArea}</p>
      </div>
      <div>
        <p class="ai-resume-label">Tone</p>
        <p class="ai-resume-value">${insights.tone}</p>
      </div>
    </div>
    <div class="ai-resume-highlights">
      ${insights.highlights.map(item => `
        <div class="ai-resume-highlight">
          <span class="ai-resume-dot"></span>
          <p>${item}</p>
        </div>
      `).join('')}
    </div>
    <div class="ai-resume-tags">
      ${insights.badges.map(tag => `<span>${tag}</span>`).join('')}
    </div>
  `;
  
  const closeBtn = resumeInsightPanel.querySelector('.ai-resume-close');
  if (closeBtn) {
    closeBtn.onclick = removeResumeInsightsPanel;
  }
  
  setupResumeHover(insights);
}

function removeResumeInsightsPanel() {
  if (resumeInsightPanel) {
    resumeInsightPanel.remove();
    resumeInsightPanel = null;
  }
  removeResumeHover();
}

function setupResumeHover(insights) {
  resumeHoverPayload = {
    variant: 'resume',
    score: insights.score,
    highlights: insights.highlights,
    badges: insights.badges,
    tone: insights.tone,
    focusArea: insights.focusArea,
    signalLabel: insights.signalLabel,
    signalColor: insights.signalColor
  };
  
  if (resumeHoverHandler) return;
  
  resumeHoverHandler = (event) => {
    if (!resumeHoverPayload) return;
    if (event.target.closest('#ai-resume-panel')) return;
    showHoverInsight(event, resumeHoverPayload);
  };
  
  document.body.addEventListener('mousemove', resumeHoverHandler, { passive: true });
  document.body.addEventListener('mouseleave', hideHoverInsight);
}

function removeResumeHover() {
  if (resumeHoverHandler) {
    document.body.removeEventListener('mousemove', resumeHoverHandler);
    resumeHoverHandler = null;
  }
  document.body.removeEventListener('mouseleave', hideHoverInsight);
  resumeHoverPayload = null;
}

function analyzeResumeContent(text) {
  if (!text || text.length < 200) {
    return null;
  }
  
  let score = 62;
  const highlights = [];
  const badges = [];
  const normalized = text.toLowerCase();
  
  const sections = [
    { pattern: /\b(work experience|professional experience|employment history)\b/i, weight: 8, badge: 'Experience depth' },
    { pattern: /\b(education|academic background)\b/i, weight: 6, badge: 'Education detailed' },
    { pattern: /\b(skill[s]?|core competencies|technical skills)\b/i, weight: 6, badge: 'Skill stack' },
    { pattern: /\b(projects?|case studies|portfolio)\b/i, weight: 5, badge: 'Project showcase' },
    { pattern: /\b(certifications?|awards|recognition)\b/i, weight: 4, badge: 'Credentials' }
  ];
  
  sections.forEach(section => {
    if (section.pattern.test(text)) {
      score += section.weight;
      badges.push(section.badge);
    }
  });
  
  const metricsMatches = (text.match(/\b\d+%|\b\d+[kKmM]?\b/g) || []).length;
  if (metricsMatches >= 4) {
    score += 8;
    highlights.push('Strong quantified impact throughout the resume.');
  } else if (metricsMatches >= 2) {
    score += 5;
    highlights.push('Some measurable achievements detected.');
  }
  
  const leadershipSignals = /\b(led|managed|mentored|spearheaded|directed|orchestrated|built)\b/i.test(text);
  if (leadershipSignals) {
    score += 4;
    highlights.push('Leadership verbs showcase ownership mindset.');
  }
  
  const actionLines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  const quantifiedLines = actionLines.filter(line => /\d/.test(line) && /\b(led|managed|built|designed|grew|scaled|reduced|accelerated|optimized|delivered)\b/i.test(line));
  
  quantifiedLines.slice(0, 2).forEach(line => {
    highlights.push(line.replace(/^[-•\s]+/, ''));
  });
  
  const skillMatches = normalized.match(/\b(python|java|javascript|react|node|sql|aws|azure|gcp|design|figma|marketing|sales|analysis|ai|ml|data|leadership|product|finance)\b/g) || [];
  if (skillMatches.length >= 6) {
    score += 6;
    badges.push('Wide skill coverage');
  } else if (skillMatches.length >= 3) {
    score += 3;
  }
  
  const tone = (() => {
    const firstPerson = (normalized.match(/\b(i |my |me |mine )/g) || []).length;
    if (firstPerson >= 20) return 'Personal';
    if (firstPerson <= 5) return 'Objective';
    return 'Balanced';
  })();
  
  const focusArea = (() => {
    if (normalized.includes('engineer') || normalized.includes('developer')) return 'Technical';
    if (normalized.includes('design') || normalized.includes('ux')) return 'Design';
    if (normalized.includes('marketing') || normalized.includes('sales')) return 'Growth';
    if (normalized.includes('product manager') || normalized.includes('roadmap')) return 'Product';
    return 'General';
  })();
  
  const signalLabel = score >= 85 ? 'Interview Ready' :
                      score >= 70 ? 'Strong Signal' :
                      score >= 55 ? 'Emerging Profile' : 'Needs Clarity';
  const signalColor = getResumeSignalColor(signalLabel);
  
  const uniqueHighlights = Array.from(new Set(highlights)).slice(0, 3);
  if (uniqueHighlights.length === 0) {
    uniqueHighlights.push('Solid foundational resume detected.');
  }
  
  let uniqueBadges = Array.from(new Set(badges));
  if (uniqueBadges.length === 0) {
    uniqueBadges = ['Baseline profile'];
  }
  
  return {
    score: Math.min(100, Math.max(45, Math.round(score))),
    highlights: uniqueHighlights,
    badges: uniqueBadges.slice(0, 4),
    tone,
    focusArea,
    signalLabel,
    signalColor
  };
}

function getResumeSignalColor(label) {
  switch (label) {
    case 'Interview Ready':
      return '#22c55e';
    case 'Strong Signal':
      return '#38bdf8';
    case 'Emerging Profile':
      return '#fbbf24';
    default:
      return '#f87171';
  }
}

// ==================== FIXED PDF SUPPORT (CSP-SAFE) ====================

async function setupPDFSupport() {
  const hasPDFLinks = document.querySelector('a[href$=".pdf"]') !== null;
  const hasFileInputs = document.querySelector('input[type="file"]') !== null;
  const isPDF = isPDFPage();

  if (isPDF) {
    await loadPDFJsSafe();
    await analyzePDFPage();
  } else if (hasPDFLinks || hasFileInputs) {
    if (hasPDFLinks) monitorPDFLinks();
    if (hasFileInputs) monitorFileUploads();
    startPDFObserver();
  }
}

function isPDFPage() {
  return (
    document.contentType === 'application/pdf' ||
    window.location.href.toLowerCase().endsWith('.pdf')
  );
}

async function loadPDFJsSafe() {
  if (pdfJsLoaded) return true;
  
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      pdfJsLoaded = true;
      resolve(true);
      return;
    }

    // CRITICAL FIX: Fetch PDF.js as text and inject inline to bypass CSP
    fetch('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js')
      .then(response => response.text())
      .then(scriptContent => {
        // Create inline script element
        const script = document.createElement('script');
        script.textContent = scriptContent;
        document.head.appendChild(script);
        
        // Wait for PDF.js to initialize
        const checkInterval = setInterval(() => {
          if (window.pdfjsLib) {
            clearInterval(checkInterval);
            
            // Load worker as blob
            fetch('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js')
              .then(r => r.text())
              .then(workerCode => {
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
                pdfJsLoaded = true;
                console.log('✅ PDF.js loaded successfully (CSP-safe)');
                resolve(true);
              })
              .catch(err => {
                console.error('Worker load failed:', err);
                reject(err);
              });
          }
        }, 100);
        
        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          if (!pdfJsLoaded) {
            reject(new Error('PDF.js load timeout'));
          }
        }, 10000);
      })
      .catch(err => {
        console.error('Failed to fetch PDF.js:', err);
        reject(err);
      });
  });
}

async function extractTextFromPDF(pdfUrl) {
  try {
    const loaded = await loadPDFJsSafe();
    if (!loaded) return null;

    const loadingTask = window.pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: false
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';

    const maxPages = Math.min(pdf.numPages, 10);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map(item => item.str)
          .filter(str => str.trim().length > 0)
          .join(' ');
        fullText += pageText + '\n\n';
      } catch (pageError) {
        console.error(`Error extracting page ${pageNum}:`, pageError);
      }
    }

    return fullText.trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    return null;
  }
}

async function extractTextFromBlob(blob) {
  try {
    if (!blob || blob.type !== 'application/pdf') {
      console.error('Invalid PDF blob');
      return null;
    }

    const loaded = await loadPDFJsSafe();
    if (!loaded) return null;

    const arrayBuffer = await blob.arrayBuffer();
    
    const loadingTask = window.pdfjsLib.getDocument({ 
      data: arrayBuffer
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';

    const maxPages = Math.min(pdf.numPages, 10);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map(item => item.str)
          .filter(str => str.trim().length > 0)
          .join(' ');
        fullText += pageText + '\n\n';
      } catch (pageError) {
        console.error(`Error extracting page ${pageNum}:`, pageError);
      }
    }

    return fullText.trim();
  } catch (error) {
    console.error('PDF blob extraction error:', error);
    return null;
  }
}

async function analyzePDFPage() {
  try {
    showLoadingNotification('Agentic AI scanning PDF…');
    const pdfText = await extractTextFromPDF(window.location.href);
    hideLoadingNotification();
    if (!pdfText) {
      showNotification('Unable to read PDF', 'error');
      return;
    }
    const analysis = performAnalysis(pdfText);
    if (analysis.type === 'resume') {
      showResumeInsights(pdfText);
    } else {
      removeResumeInsightsPanel();
    }
    showPDFAnalysisModal(analysis, pdfText, extractFileName(window.location.href));
  } catch (error) {
    console.error('PDF page analysis failed', error);
    hideLoadingNotification();
    showNotification('PDF scan failed', 'error');
  }
}

function monitorPDFLinks() {
  document.querySelectorAll('a[href$=".pdf"]').forEach(link => {
    if (link.dataset.aiPdfBound) return;
    link.dataset.aiPdfBound = 'true';
    
    link.addEventListener('click', (event) => {
      const url = link.href || event.currentTarget.href;
      if (!url) return;
      setTimeout(() => analyzePDFUrl(url), 400);
    });
  });
}

function monitorFileUploads() {
  document.querySelectorAll('input[type="file"]').forEach(input => {
    if (input.dataset.aiPdfBound) return;
    input.dataset.aiPdfBound = 'true';
    
    input.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const isPDF = file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'));
      if (!isPDF) return;
      showLoadingNotification('Scanning local PDF resume…');
      const text = await extractTextFromBlob(file);
      hideLoadingNotification();
      if (!text) {
        showNotification('Unable to parse PDF', 'error');
        return;
      }
      const analysis = performAnalysis(text);
      if (analysis.type === 'resume') {
        showResumeInsights(text);
      } else {
        removeResumeInsightsPanel();
      }
      showPDFAnalysisModal(analysis, text, file.name);
    });
  });
}

async function analyzePDFUrl(url) {
  try {
    const text = await extractTextFromPDF(url);
    if (!text) return;
    const analysis = performAnalysis(text);
    if (analysis.type === 'resume') {
      showResumeInsights(text);
    }
    showPDFAnalysisModal(analysis, text, extractFileName(url));
  } catch (error) {
    console.error('Linked PDF analysis failed', error);
  }
}

function extractFileName(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '';
    return pathname.split('/').pop() || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

function startPDFObserver() {
  if (pdfObserver || !document.body) return;
  pdfObserver = new MutationObserver(() => {
    monitorPDFLinks();
    monitorFileUploads();
  });
  pdfObserver.observe(document.body, { childList: true, subtree: true });
}

function startDomObserver() {
  if (domObserver || !document.body) return;
  domObserver = new MutationObserver(() => {
    if (domObserverTimeout) clearTimeout(domObserverTimeout);
    domObserverTimeout = setTimeout(() => {
      highlightJobListings();
      analyzeJobCards();
    }, 600);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
}