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
let pageHoverHandler = null;
let pageHoverPayload = null;
let currentTheme = 'dark';
let pdfObserver = null;
let hoverHandlerMap = new WeakMap();
let domObserver = null;
let domObserverTimeout = null;
let modalHandlerMap = new WeakMap();
let processedTextHashes = new Set();
let hoverGuideElement = null;
let hoverGuideDismissed = false;

// Track current page mode to avoid random-site triggers
let currentPageMode = 'unknown'; // 'job' | 'resume' | 'unknown'

function isJobHost() {
  const hostname = (window.location.hostname || '').toLowerCase();
  return [
    'linkedin.com',
    'internshala.com',
    'naukri.com',
    'indeed.com',
    'glassdoor.com',
    'wellfound.com',
    'monster.com'
  ].some(domain => hostname.includes(domain));
}

function isDocHost() {
  const hostname = (window.location.hostname || '').toLowerCase();
  return [
    'google.com',
    'drive.google.com',
    'dropbox.com',
    'githubusercontent.com',
    'flowcv.com',
    'flowcv.io'
  ].some(domain => hostname.includes(domain));
}

// ==================== MESSAGE LISTENER ====================
browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('ðŸ“¨ Message received:', request.action);
  
  if (request.action === 'analyzeFullPage') {
    analyzeCurrentPage();
    sendResponse({status: 'Analysis started'});
    return true;
  }
  
  if (request.action === 'toggleExtension') {
    extensionEnabled = request.enabled;
    console.log('ðŸ”„ Extension toggled:', extensionEnabled);
    
    if (extensionEnabled) {
      showNotification('âœ… Extension Enabled');
      analyzeCurrentPage();
    } else {
      showNotification('â¸ï¸ Extension Disabled');
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
  console.log('ðŸš€ TrustScan loaded');
  
  // Check if extension is enabled
  browser.storage.local.get(['extensionEnabled', 'uiTheme'], function(result) {
    extensionEnabled = result.extensionEnabled !== false;
    const storedTheme = result.uiTheme || currentTheme;
    applyThemeToPage(storedTheme);
    
    if (extensionEnabled) {
      console.log('âœ… Extension is enabled');
      
      // Wait for page to be fully loaded
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAnalysis);
      } else {
        startAnalysis();
      }
    } else {
      console.log('â¸ï¸ Extension is disabled');
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
    console.log('â¸ï¸ Analysis skipped - extension disabled');
    return;
  }
  
  console.log('ðŸ” Analyzing current page...');
  
  const pageText = extractPageText();
  
  if (pageText.length < 100) {
    console.log('âš ï¸ Page text too short, skipping analysis');
    return;
  }
  
  const type = detectType(pageText);

  const looksLikeJob = type === 'job_listing' || isFullJobDescription(pageText) || (isJobHost() && isLikelyJobText(pageText));
  const looksLikeResume = type === 'resume' || (isDocHost() && isLikelyResumeText(pageText)) || (!isJobHost() && isLikelyResumeText(pageText));
  const primaryJobBlock = findPrimaryJobDescription();
  const jobAnalysisTarget = primaryJobBlock ? primaryJobBlock.text : pageText;
  const trimmedJobText = (jobAnalysisTarget || '').trim();
  
  // More aggressive job detection: if on job host, prioritize job detection
  // Only treat as resume if we're on a doc host or explicitly detected as resume
  const isExplicitlyResume = type === 'resume' || (isDocHost() && isLikelyResumeText(pageText));
  const hostname = window.location.hostname;
  const hasJobCards = document.querySelectorAll('.individual_internship, .job-card-container, .jobs-search-results__list-item, .jobTuple, .job_seen_beacon, .react-job-listing').length > 0;
  // If on job host, treat as job unless explicitly resume - be very lenient
  const shouldTreatAsJob = isJobHost() && !isExplicitlyResume && (looksLikeJob || !!primaryJobBlock || hasJobCards || type !== 'resume');
  console.log('ðŸ“Š Detected type:', type, 'job?', looksLikeJob, 'resume?', looksLikeResume, 'primary block?', !!primaryJobBlock, 'hasJobCards?', hasJobCards, 'shouldTreatAsJob?', shouldTreatAsJob, 'isJobHost?', isJobHost());
  
  if (shouldTreatAsJob) {
    currentPageMode = 'job';
    removeResumeInsightsPanel();
    removeResumeHover();
    
    // Check if we're on an Internshala listing page (multiple job cards) - don't treat whole page as one job
    const hostname = window.location.hostname;
    const internshalaCards = document.querySelectorAll('.individual_internship');
    const isInternshalaListingPage = hostname.includes('internshala.com') && internshalaCards.length > 1;
    
    if (isInternshalaListingPage) {
      // On Internshala listing pages, ONLY analyze individual cards, NEVER the whole page
      showNotification('ðŸ’¼ Job listings detected â€” hover over individual cards for trust scores.', 'success');
      // Explicitly skip all full-page analysis
      removePageHover();
      // Don't call highlightFullJobDescriptions, findPrimaryJobDescription, or highlightJobListings on listing pages
      // Only analyze individual cards via analyzeJobCards (called below)
    } else {
      // On detail pages or other sites, analyze the full job description
      showNotification('ðŸ’¼ Job listing detected â€” hover highlighted sections for trust score.', 'success');
      highlightJobListings();
      highlightFullJobDescriptions();
      
      if (primaryJobBlock && primaryJobBlock.element) {
        addJobIndicator(primaryJobBlock.element, primaryJobBlock.analysis);
        rememberTextSignature(primaryJobBlock.signature || getTextSignature(primaryJobBlock.text));
      }
      
      // Attach global hover based on the cleanest job block available
      if (trimmedJobText.length > 260) {
        const pageAnalysis = primaryJobBlock ? primaryJobBlock.analysis : performAnalysis(trimmedJobText);
        const pageSignature = primaryJobBlock?.signature || getTextSignature(trimmedJobText);
        if (pageSignature) rememberTextSignature(pageSignature);
        attachHoverToPageBody(pageAnalysis);
      } else {
        removePageHover();
      }
    }
  } else if (looksLikeResume) {
    currentPageMode = 'resume';
    showNotification('ðŸ“„ Resume detected â€” hover anywhere to view ATS score.', 'info');
    removePageHover();
    // Only show hover popup, no panel
    const resumeAnalysis = analyzeResumeContent(pageText);
    if (resumeAnalysis) {
      attachResumeHoverToPageBody(resumeAnalysis);
    }
  } else {
    currentPageMode = 'unknown';
    removeResumeInsightsPanel();
    removePageHover();
    console.log('â“ Content type unclear');
  }
  
  // Analyze specific job cards on known job sites - ALWAYS try on job hosts
  if (isJobHost()) {
    const hostname = window.location.hostname;
    const internshalaCards = document.querySelectorAll('.individual_internship');
    const isInternshalaListing = hostname.includes('internshala.com') && internshalaCards.length > 0;
    const allJobCards = document.querySelectorAll('.individual_internship, .job-card-container, .jobs-search-results__list-item, .jobTuple, .job_seen_beacon, .react-job-listing');
    const hasJobCards = allJobCards.length > 0;
    
    // For Internshala, always try to analyze cards even if page mode is unknown
    if (isInternshalaListing && currentPageMode === 'unknown') {
      console.log('ðŸ” Internshala detected, setting to job mode and analyzing cards...');
      currentPageMode = 'job';
      showNotification('ðŸ’¼ Job listings detected â€” hover over individual cards for trust scores.', 'success');
    }
    
    // Always analyze job cards if we're on a job host
    // Run if: in job mode, OR Internshala with cards, OR unknown mode with job cards found
    if (currentPageMode === 'job' || isInternshalaListing || (currentPageMode === 'unknown' && hasJobCards)) {
      if (currentPageMode === 'unknown' && hasJobCards) {
        console.log('ðŸ” Found job cards on unknown page, setting to job mode and analyzing...');
        currentPageMode = 'job';
        if (!isInternshalaListing) {
          showNotification('ðŸ’¼ Job listings detected â€” hover over cards for trust scores.', 'success');
        }
      }
      analyzeJobCards();
    }
  }
}

function extractPageText() {
  // Remove script and style content
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
  
  return clone.innerText || clone.textContent || '';
}

function getTextSignature(text) {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `${normalized.length}:${hash}`;
}

function hasSeenText(text) {
  const signature = getTextSignature(text);
  if (!signature) return { signature: null, seen: false };
  return { signature, seen: processedTextHashes.has(signature) };
}

function rememberTextSignature(signature) {
  if (signature) {
    processedTextHashes.add(signature);
  }
}

const SITE_JOB_SELECTORS = {
  'linkedin.com': [
    '.jobs-description__content',
    '.jobs-details__main-content',
    '.show-more-less-html__markup',
    '.jobs-description'
  ],
  'indeed.com': [
    '#jobDescriptionText',
    '.jobsearch-jobDescriptionText',
    '.jobsearch-JobComponent-description'
  ],
  'naukri.com': [
    '.dang-innerHTML',
    '.jd-container',
    '#jobDescriptionText',
    '.job-desc'
  ],
  'glassdoor.com': [
    '.jobDescriptionContent',
    '.desc',
    '#JobDescriptionContainer'
  ],
  'wellfound.com': [
    '.styles_jobDescription__',
    '.ListingDetailPage-description'
  ],
  'monster.com': [
    '#JobDescription',
    '.job-description'
  ]
};

function highlightJobListings() {
  if (!extensionEnabled) return;
  // Avoid scanning random blogs/news/social: only on job hosts and when page is job-like
  if (!isJobHost() || currentPageMode !== 'job') return;
  // Skip on Internshala listing pages - only analyze individual cards (not full page)
  const hostname = window.location.hostname;
  if (hostname.includes('internshala.com') && document.querySelectorAll('.individual_internship').length > 1) {
    return; // Skip full-page highlighting, but analyzeJobCards() will handle individual cards
  }
  // Find common job listing containers
  const selectors = [
    '[class*="job"]',
    '[class*="listing"]',
    '[class*="card"]',
    '[data-job-id]',
    'article',
    '.search-card',
    'main',
    '[role="main"]',
    '.content',
    '.description',
    '.job-description',
    '.job-details'
  ];
  
  const elements = document.querySelectorAll(selectors.join(','));
  
  elements.forEach(el => {
    if (analyzedElements.has(el)) return;
    
    const text = el.innerText;
    if (text && text.length > 80 && text.length < 50000) {
      const { signature, seen } = hasSeenText(text);
      if (seen) return;
      const analysis = performAnalysis(text);
      if (analysis.type === 'job_listing' || (analysis.type === 'unknown' && (isLikelyJobText(text) || isFullJobDescription(text)))) {
        addJobIndicator(el, analysis);
        analyzedElements.add(el);
        rememberTextSignature(signature);
      }
    }
  });
}

function highlightFullJobDescriptions() {
  if (!extensionEnabled) return;
  if (!isJobHost() || currentPageMode !== 'job') return;
  // Skip on Internshala listing pages - only analyze individual cards
  const hostname = window.location.hostname;
  if (hostname.includes('internshala.com') && document.querySelectorAll('.individual_internship, [class*="internship"]').length > 1) {
    return;
  }
  const fullPageSelectors = [
    'main',
    'article',
    '#main-content',
    '#job-details',
    '.job-view-container',
    '.job-description',
    '.jobDetails',
    '.jobDescription',
    '.description',
    '.posting-description',
    '.job-details--body'
  ];

  const candidates = document.querySelectorAll(fullPageSelectors.join(','));
  candidates.forEach(el => {
    if (!el || analyzedElements.has(el)) return;
    const text = el.innerText;
    if (!text || text.length < 400) return;
    if (!isFullJobDescription(text) && !isLikelyJobText(text)) return;
    const { signature, seen } = hasSeenText(text);
    if (seen) return;

    const analysis = performAnalysis(text);
    addJobIndicator(el, analysis);
    analyzedElements.add(el);
    rememberTextSignature(signature);

    // Ensure global hover is available for true full-page descriptions
    if (text.length > 800) {
      attachHoverToPageBody(analysis);
    }
  });
}

function findPrimaryJobDescription() {
  if (!document || !document.body) return null;
  const hostname = (window.location.hostname || '').toLowerCase();
  // Skip on Internshala listing pages - only analyze individual cards
  if (hostname.includes('internshala.com') && document.querySelectorAll('.individual_internship, [class*="internship"]').length > 1) {
    return null;
  }
  const hostSelectors = getSiteSpecificSelectors(hostname);
  const baseSelectors = [
    '.jobs-details__main-content',
    '.jobs-description__content',
    '.jobDescription',
    '.job-description',
    '.description__text',
    '.job-details',
    '.posting',
    '#job-details',
    'article',
    'main'
  ];
  const prioritySelectors = Array.from(new Set([...hostSelectors, ...baseSelectors]));

  let bestCandidate = null;

  const evaluateElement = (el) => {
    if (!el) return;
    const text = getVisibleText(el);
    if (!text || text.length < 200) return;
    const { signature, seen } = hasSeenText(text);
    if (seen) return;
    const score = scoreJobBlock(text);
    if (score > 0 && (!bestCandidate || score > bestCandidate.score)) {
      bestCandidate = { element: el, text, score, signature };
    }
  };

  prioritySelectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(evaluateElement);
  });

  if (!bestCandidate || bestCandidate.score < 4) {
    const bodyTarget = document.querySelector('main') || document.body;
    const bodyText = getVisibleText(bodyTarget);
    const { signature, seen } = hasSeenText(bodyText);
    if (!seen && (isFullJobDescription(bodyText) || isLikelyJobText(bodyText))) {
      bestCandidate = {
        element: bodyTarget,
        text: bodyText,
        score: 4,
        signature
      };
    }
  }

  if (!bestCandidate) return null;
  bestCandidate.analysis = performAnalysis(bestCandidate.text);
  bestCandidate.analysis.signature = bestCandidate.signature || getTextSignature(bestCandidate.text);
  return bestCandidate;
}

function getSiteSpecificSelectors(hostname) {
  if (!hostname) return [];
  const entry = Object.entries(SITE_JOB_SELECTORS).find(([domain]) => hostname.includes(domain.replace(/^\./, '')));
  return entry ? entry[1] : [];
}

function getVisibleText(node) {
  if (!node) return '';
  const style = window.getComputedStyle(node);
  if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return '';
  return (node.innerText || '').replace(/\s+/g, ' ').trim();
}

function scoreJobBlock(text) {
  if (!text || text.length < 400) return 0;
  let score = 0;
  if (isFullJobDescription(text)) score += 4.5;
  if (isLikelyJobText(text)) score += 3;
  const keywords = ['responsibilities', 'requirements', 'qualifications', 'benefits', 'apply', 'about the role', 'what you\'ll do', 'who you are'];
  const normalized = text.toLowerCase();
  keywords.forEach(keyword => {
    if (normalized.includes(keyword)) score += 0.6;
  });
  score += Math.min(3, text.split(/\s+/).length / 350);
  return score;
}

// Helper function to check if a card is an advertisement - less strict
function isAdvertisementCard(card) {
  if (!card) return true;
  
  // Check for common ad indicators in class names, IDs, or data attributes
  const cardClasses = card.className || '';
  const cardId = card.id || '';
  const cardText = (card.innerText || '').toLowerCase();
  
  // Only filter obvious ads - be less strict
  const obviousAdIndicators = [
    'google-ads', 'adsense', 'advertisement-container', 'ad-wrapper', 'ad-banner'
  ];
  
  // Check class names and IDs for obvious ad containers
  const hasObviousAdClass = obviousAdIndicators.some(indicator => 
    cardClasses.toLowerCase().includes(indicator) || 
    cardId.toLowerCase().includes(indicator)
  );
  
  // Check for explicit ad text (but not "sponsored job" which is legitimate)
  const hasExplicitAdText = /\b(advertisement|ad\s+content|google\s+ads)\b/i.test(cardText) && 
                           !/\b(sponsored\s+job|promoted\s+job)\b/i.test(cardText);
  
  // Check for common ad parent containers (but be lenient)
  const parent = card.closest('[class*="google-ads"], [id*="google-ads"], [class*="adsense"], [id*="adsense"]');
  
  // Check if card is inside an iframe (common for ads)
  const isInIframe = card.closest('iframe') !== null;
  
  // Only filter if it's clearly an ad
  return hasObviousAdClass || (hasExplicitAdText && !cardText.includes('job') && !cardText.includes('internship')) || (parent !== null && isInIframe);
}

function analyzeJobCards() {
  if (!extensionEnabled) return;
  if (!isJobHost()) return;
  // Allow analysis even if page mode is unknown - we want to detect job cards on all job sites
  const hostname = window.location.hostname;
  const isInternshala = hostname.includes('internshala.com');
  // Run analysis if we're in job mode OR if we're on a job host (be more lenient)
  if (currentPageMode !== 'job' && currentPageMode !== 'unknown') return;
  // Specific selectors for popular job sites - use original selectors, filter ads manually
  const jobCardSelectors = {
    'linkedin.com': '.job-card-container, .jobs-search-results__list-item',
    'naukri.com': '.jobTuple, .jobTupleHeader',
    'internshala.com': '.individual_internship',
    'indeed.com': '.job_seen_beacon, .jobsearch-SerpJobCard',
    'glassdoor.com': '.react-job-listing'
  };
  const selector = Object.keys(jobCardSelectors).find(key => hostname.includes(key));
  
  if (selector && jobCardSelectors[selector]) {
    const cards = document.querySelectorAll(jobCardSelectors[selector]);
    console.log(`ðŸ“‹ Found ${cards.length} potential job cards on ${hostname}`);
    
    // Filter out advertisement cards
    const realJobCards = Array.from(cards).filter(card => !isAdvertisementCard(card));
    console.log(`âœ… Filtered to ${realJobCards.length} real job cards (removed ${cards.length - realJobCards.length} ads)`);
    
    // For Internshala listing pages, ensure we only process individual cards
    const isInternshalaListing = isInternshala && realJobCards.length > 1;
    
    realJobCards.forEach(card => {
      if (analyzedElements.has(card)) return;
      
      // For Internshala, get ONLY the card's own content, not nested or parent content
      let text = '';
      if (isInternshala) {
        // Get card-specific elements only
        const cardClone = card.cloneNode(true);
        // Remove nested internship cards to avoid grabbing multiple cards
        cardClone.querySelectorAll('.individual_internship').forEach(nested => nested.remove());
        
        // Get title and key details from the card
        const titleEl = cardClone.querySelector('.heading_4_5, .heading_6, h3, h4, [class*="title"], [class*="heading"]');
        const companyEl = cardClone.querySelector('.company_name, [class*="company"]');
        const locationEl = cardClone.querySelector('[class*="location"]');
        const stipendEl = cardClone.querySelector('[class*="stipend"], [class*="salary"]');
        const durationEl = cardClone.querySelector('[class*="duration"]');
        
        const parts = [];
        if (titleEl) parts.push(titleEl.innerText.trim());
        if (companyEl) parts.push(companyEl.innerText.trim());
        if (locationEl) parts.push(locationEl.innerText.trim());
        if (stipendEl) parts.push(stipendEl.innerText.trim());
        if (durationEl) parts.push(durationEl.innerText.trim());
        
        text = parts.filter(p => p.length > 0).join(' â€¢ ');
        
        // If we still don't have enough, get first 500 chars of card text (but not nested cards)
        if (text.length < 50) {
          const directText = Array.from(cardClone.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !node.querySelector('.individual_internship')))
            .map(node => node.textContent || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          text = directText.substring(0, 800);
        }
        
        // Strict limit for Internshala cards
        if (text.length > 1000) {
          text = text.substring(0, 1000);
        }
      } else {
        text = card.innerText;
      }
      
      if (!text || text.length < 30) return;
      
      // On listing pages, be more lenient - card summaries are still jobs
      const isListingPage = realJobCards.length > 1;
      const analysis = performAnalysis(text);
      const looksLikeJob = analysis.type === 'job_listing' || 
                          isLikelyJobText(text) || 
                          (isListingPage && (text.length >= 30 && text.length <= 1000)); // Listing cards are shorter
      
      // Light ad check - only skip obvious ads
      const isObviousAd = /\b(click here to download|sign up for free|limited time offer|special discount|buy now)\b/i.test(text) && 
                         !/\b(job|internship|position|role|hiring|apply|company)\b/i.test(text);
      
      // Skip only obvious ads
      if (isObviousAd) {
        console.log('â­ï¸ Skipping obvious ad card:', text.substring(0, 50));
        return;
      }
      
      // For Internshala, always treat as job if we have reasonable text
      if (isInternshala && text.length >= 20) {
        addJobIndicator(card, analysis);
        analyzedElements.add(card);
      } else if (looksLikeJob || (isListingPage && text.length >= 30)) {
        // Other sites: use normal job detection OR if listing page with reasonable text
        addJobIndicator(card, analysis);
        analyzedElements.add(card);
      } else if (isJobHost() && text.length >= 50) {
        // Fallback: if on job host with reasonable text, treat as job
        addJobIndicator(card, analysis);
        analyzedElements.add(card);
      }
    });
  }
}

// ==================== UI INDICATORS ====================
function addJobIndicator(element, analysis) {
  if (!element || element.dataset.aiTagged === 'true') return;
  
  const sourceText = element.innerText || '';
  const signature = (analysis && analysis.signature) || getTextSignature(sourceText);
  if (signature && processedTextHashes.has(signature)) return;
  const computedAnalysis = analysis || performAnalysis(sourceText);
  
  // More lenient check - if we're on a job host and have analysis, allow it
  // This ensures job cards on listing pages are detected even if they're short
  const isOnJobHost = isJobHost();
  const isShortCard = sourceText.length < 400;
  const looksLikeJobCard = computedAnalysis.type === 'job_listing' || 
                           isLikelyJobText(sourceText) || 
                           isFullJobDescription(sourceText) ||
                           (isOnJobHost && isShortCard && sourceText.length >= 30); // Allow short cards on job sites
  
  if (!looksLikeJobCard) return;
  
  element.dataset.aiTagged = 'true';
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
  rememberTextSignature(signature);
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
    el.removeAttribute('data-ai-hover-bound');
    el.style.removeProperty('--ai-risk-color');
  });
  analyzedElements = new WeakSet();
  processedTextHashes = new Set();
  hideHoverInsight();
  removeResumeInsightsPanel();
  removePageHover();
}

// ==================== HOVER INTELLIGENCE PANEL ====================
function attachHoverToEntity(element, analysis) {
  if (!element || !analysis) return;
  if (element.dataset.aiHoverBound === 'true' || hoverHandlerMap.get(element)) return;
  element.dataset.aiHoverBound = 'true';
  
  const enterHandler = (event) => {
    if (event.target.closest('#ai-hover-card')) return;
    showHoverInsight(event, analysis);
  };
  
  element.addEventListener('mouseenter', enterHandler, { passive: true });
  element.addEventListener('mousemove', moveHoverInsight, { passive: true });
  element.addEventListener('mouseleave', hideHoverInsight, { passive: true });
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
  dismissHoverGuide();
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
      <p class="ai-hover-summary">Focus: ${analysis.focusArea} â€¢ Tone: ${analysis.tone}</p>
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
  const offsetX = 16;
  const offsetY = 16;
  const cardWidth = hoverCardElement.offsetWidth || 260;
  const cardHeight = hoverCardElement.offsetHeight || 180;
  let left = event.clientX + offsetX;
  let top = event.clientY - cardHeight - offsetY;
  
  if (left + cardWidth > window.innerWidth - 12) {
    left = event.clientX - cardWidth - offsetX;
  }
  
  if (left < 12) left = 12;
  
  if (top < 12) {
    top = event.clientY + offsetY;
  }
  if (top + cardHeight > window.innerHeight - 12) {
    top = window.innerHeight - cardHeight - 12;
  }
  
  hoverCardElement.style.left = `${left}px`;
  hoverCardElement.style.top = `${top}px`;
  hoverCardElement.style.transform = 'none';
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
  const normalized = (text || '').toLowerCase();
  const jobContext = type === 'job_listing' || (isJobHost() && (isLikelyJobText(text) || isFullJobDescription(text)));
  const redFlags = [];
  const greenFlags = [];

  const pushUnique = (list, value) => {
    if (value && !list.includes(value)) {
      list.push(value);
    }
  };

  // Weighted model for 0â€“100 trust score
  let negativeWeight = 0; // higher => more scammy
  let positiveWeight = 0; // higher => more trustworthy

  const addRisk = (points, message) => {
    negativeWeight += points;
    pushUnique(redFlags, message);
  };

  const addSignal = (points, message) => {
    positiveWeight += points;
    pushUnique(greenFlags, message);
  };

  if (/\b(pay.*upfront|wire transfer|western union|money gram)\b/i.test(text)) {
    addRisk(35, 'Payment required upfront');
  }

  if (/\b(guaranteed.*income|get rich quick|easy money|overnight profits?)\b/i.test(text)) {
    addRisk(32, 'Unrealistic promises');
  }

  if (/\b(telegram|whatsapp|signal|wechat|imo)\b/i.test(text)) {
    addRisk(14, 'Requests chat apps for hiring');
  }

  if (/\b(bitcoin|crypto|gift card|skrill)\b/i.test(text)) {
    addRisk(22, 'Suspicious payment method');
  }

  if (/\b(training fee|security deposit|processing fee|registration fee)\b/i.test(text)) {
    addRisk(24, 'Fee mentioned in hiring process');
  }

  if (/\b(send (copy of|scan of) your (id|passport|license))\b/i.test(text)) {
    addRisk(26, 'Requests sensitive personal documents');
  }

  if (/\b(refundable deposit|training bond)\b/i.test(text)) {
    addRisk(22, 'Mentions deposit/bond');
  }

  if (/\b(click here\b|\bapply via\b).{0,80}(?:tinyurl|bit\.ly|goo\.gl)/i.test(text)) {
    addRisk(12, 'Uses shortened links');
  }

  if (/\b(contact|reach|email)\b[^@]{0,40}\b(gmail|yahoo|hotmail|outlook)\b/i.test(text) && jobContext) {
    addRisk(10, 'Uses generic email provider');
  }

  if (jobContext && !/@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(text)) {
    addRisk(10, 'No company email mentioned');
  }

  if (/\b(click\s+(here|the link))\b/i.test(text) && !/\b(company|career|apply\b)/i.test(text)) {
    addRisk(8, 'Generic â€œclick hereâ€ instruction');
  }

  if (/\b(work from home|remote)\b/i.test(text) && /\b(no experience required|daily payout)\b/i.test(text)) {
    addRisk(16, 'High-risk remote promise');
  }

  if (/\b(paypal|cashapp|western union)\b/i.test(text)) {
    addRisk(14, 'Requests unconventional payment channel');
  }

  if (/\b(llc|inc\.?|ltd|corp\.?|gmbh|pte)\b/i.test(text)) {
    addSignal(6, 'References a registered entity');
  }

  const sectionSignals = [
    /\b(responsibilities|what you'll do|role overview)\b/i,
    /\b(requirements|qualifications|you bring)\b/i,
    /\b(benefits|perks)\b/i,
    /\b(compensation|salary|pay range)\b/i,
    /\b(application process|interview process)\b/i
  ];
  const structuredSections = sectionSignals.filter(pattern => pattern.test(text)).length;
  if (structuredSections >= 3) {
    addSignal(8, 'Clear section breakdown');
  } else if (structuredSections <= 1 && jobContext) {
    addRisk(6, 'Missing standard sections');
  }

  const bulletPoints = (text.match(/[\r\n]+[\s]*(?:[-â€¢*]|[0-9]+\.)/g) || []).length;
  if (bulletPoints >= 4) {
    addSignal(Math.min(10, bulletPoints * 0.8), 'Structured bullet-point details');
  } else if (bulletPoints <= 1 && jobContext) {
    addRisk(4, 'Little structure');
  }

  const salaryPattern = /\b(salary|ctc|compensation|pay range|package)\b[^$â‚¬â‚¹Â£]{0,60}(\$|â‚¬|â‚¹|Â£)?\d+/i;
  if (salaryPattern.test(text)) {
    addSignal(6, 'Shares compensation details');
  }

  if (/\b(remote|hybrid|onsite|relocation)\b/i.test(text)) {
    addSignal(4, 'Clarifies work model');
  }

  if (/\b(employment type|job type|schedule)\b/i.test(text)) {
    addSignal(4, 'States employment type');
  }

  if (/\b(hiring manager|talent acquisition|recruiter|hr team)\b/i.test(text)) {
    addSignal(3, 'Mentions hiring contact');
  }

  if (/\b(company website|official site|career page)\b/i.test(text)) {
    addSignal(6, 'Provides official company touchpoints');
  }

  if (/\b(benefits|insurance|401k|pto|paid time off)\b/i.test(text)) {
    addSignal(6, 'Mentions employee benefits');
  }

  if (/\b(interview process|application process|next steps)\b/i.test(text)) {
    addSignal(5, 'Describes the hiring process');
  }

  const uppercaseRatio = (text.match(/[A-Z]{4,}/g) || []).join('').length / Math.max(text.length, 1);
  if (uppercaseRatio > 0.08) {
    addRisk(5, 'Excessive uppercase text');
  }

  const wordCount = text.split(/\s+/).length;
  if (wordCount < 220 && jobContext) {
    addRisk(8, 'Too little information');
  } else if (wordCount > 900) {
    addSignal(4, 'Thorough role breakdown');
  }

  if (text.length < 400 && jobContext) {
    addRisk(8, 'Very short description');
  } else if (text.length > 2200) {
    addSignal(4, 'Detailed listing');
  }

  if (/\b(resume|cv|curriculum vitae)\b/i.test(text) && /\b(send|mail)\b/i.test(text) && !/\bcompany\b/i.test(text)) {
    addRisk(8, 'Unclear submission channel');
  }

  if (!/\b(location|city|state|remote|hybrid)\b/i.test(text) && jobContext) {
    addRisk(4, 'No location or work model specified');
  }

  const actionVerbs = (text.match(/\b(design|build|lead|coordinate|deliver|implement|support|optimize|drive|scale|mentor|manage|architect)\b/gi) || []).length;
  if (actionVerbs >= 12) {
    addSignal(4, 'Uses concrete action verbs');
  }

  const legalese = /\b(equal opportunity|eeo|background check|employment verification)\b/i;
  if (legalese.test(text)) {
    addSignal(4, 'Mentions compliance policies');
  }

  const hasCompanyName = /\b(inc\.?|llc|ltd|corp\.?|gmbh|technologies|solutions|labs)\b/i.test(text);
  if (!hasCompanyName && jobContext) {
    addRisk(5, 'Company identity unclear');
  }

  const deterministicNoise = getDeterministicNoise(text) * 0.6;
  // Map weighted signals onto 0â€“100 trust scale
  // Start from neutral baseline, then move up/down based on weights
  const baseScore = 60;
  const positiveImpact = Math.min(30, positiveWeight * 0.9);
  const negativeImpact = Math.min(80, negativeWeight * 1.2);
  let trustScore = baseScore + positiveImpact - negativeImpact + (jobContext ? 5 : -5) + deterministicNoise;

  // If many scam indicators, cap in low range
  if (negativeWeight >= 35) {
    trustScore = Math.min(trustScore, 35);
  }

  // For non-job context, keep score conservative and avoid extremes
  if (!jobContext) {
    trustScore = Math.max(30, Math.min(trustScore, 75));
  }

  // Final clamp to strict 0â€“100
  trustScore = Math.max(0, Math.min(100, Math.round(trustScore)));
  const jobConfidence = Math.max(0, Math.min(1, (positiveWeight + 12) / (positiveWeight + negativeWeight + 42)));
  const riskMeta = getRiskMeta(trustScore);
  
  return {
    type,
    trustScore,
    redFlags,
    greenFlags,
    summary: generateSummary(type, trustScore, text),
    riskLevel: riskMeta.label,
    riskColor: riskMeta.color,
    variant: type === 'resume' ? 'resume' : 'job',
    jobContext,
    jobConfidence
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
    if (trustScore >= 80) {
      return 'Low-risk, well-structured listing with healthy hiring signals.';
    }
    if (trustScore >= 60) {
      return 'Looks mostly legitimate â€” review red flags before engaging.';
    }
    return 'âš ï¸ Multiple red flags detected. Validate the employer before sharing details.';
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
  notif.className = `ai-notification ai-notification-${type}`;
  
  const icons = {
    success: 'âš¡',
    info: 'ðŸ’¼',
    warning: 'âš ï¸',
    error: 'âŒ'
  };
  
  const icon = icons[type] || icons.info;
  
  notif.innerHTML = `
    <div class="ai-notification-content">
      <span class="ai-notification-icon">${icon}</span>
      <span class="ai-notification-text">${message}</span>
    </div>
  `;
  
  document.body.appendChild(notif);
  
  requestAnimationFrame(() => {
    notif.classList.add('ai-notification-visible');
  });
  
  setTimeout(() => {
    notif.classList.remove('ai-notification-visible');
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

let hoverHintTimeout = null;

function announceHoverReady(kind) {
  const message = kind === 'resume'
    ? 'Resume insights ready â€” move your cursor to reveal the ATS score.'
    : 'Job description scanned â€” hover anywhere on the page for trust score.';
  showNotification(message, 'info');
  showHoverHint(message);
  showHoverGuide(kind);
}

function showHoverHint(message) {
  let hint = document.getElementById('ai-hover-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'ai-hover-hint';
    hint.dataset.visible = 'false';
    document.body.appendChild(hint);
  }
  hint.textContent = message;
  requestAnimationFrame(() => {
    hint.dataset.visible = 'true';
  });

  if (hoverHintTimeout) clearTimeout(hoverHintTimeout);
  hoverHintTimeout = setTimeout(() => {
    if (hint) {
      hint.dataset.visible = 'false';
    }
  }, 4500);
}

function showHoverGuide(kind) {
  if (hoverGuideDismissed) return;
  const guideText = kind === 'resume'
    ? 'Move your mouse over the resume text to see ATS grade, keywords, and highlights.'
    : 'Hover within the job description to reveal trust score and risk signals.';
  if (!hoverGuideElement) {
    hoverGuideElement = document.createElement('div');
    hoverGuideElement.id = 'ai-hover-guide';
    hoverGuideElement.innerHTML = `
      <span class="ai-guide-message"></span>
      <button type="button" aria-label="Dismiss hover guide">âœ•</button>
    `;
    hoverGuideElement.style.cssText = `
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 360px;
      padding: 14px 16px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(94, 234, 212, 0.35);
      color: #f8fafc;
      font-size: 13px;
      font-family: 'Inter', 'Segoe UI', sans-serif;
      display: flex;
      gap: 12px;
      align-items: center;
      box-shadow: 0 14px 40px rgba(2, 6, 23, 0.45);
      z-index: 9999999;
      opacity: 0;
      transition: opacity 0.2s ease;
    `;
    const closeBtn = hoverGuideElement.querySelector('button');
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: inherit;
      font-size: 14px;
      cursor: pointer;
      padding: 0;
    `;
    closeBtn.addEventListener('click', () => dismissHoverGuide(true));
    document.body.appendChild(hoverGuideElement);
  }
  const textSpan = hoverGuideElement.querySelector('.ai-guide-message');
  if (textSpan) {
    textSpan.textContent = guideText;
  }
  hoverGuideElement.style.opacity = '1';
}

function dismissHoverGuide(permanent = false) {
  if (permanent) {
    hoverGuideDismissed = true;
  }
  if (hoverGuideElement) {
    hoverGuideElement.style.opacity = '0';
  }
}

// ==================== MODAL SYSTEM ====================
function showAnalysisModal(analysis, sourceElement) {
  // Remove existing modal
  const existing = document.getElementById('ai-analysis-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'ai-analysis-modal';
  
  // Get current theme
  const isDark = currentTheme === 'dark';
  
  // Theme-aware colors
  const backdropBg = isDark ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.7)';
  const modalBg = isDark ? 'rgba(15, 23, 42, 0.98)' : 'white';
  const modalBorder = isDark ? 'rgba(148, 163, 184, 0.2)' : 'transparent';
  const textColor = isDark ? '#f1f5f9' : '#1e293b';
  const mutedText = isDark ? '#94a3b8' : '#475569';
  const mutedTextLight = isDark ? '#64748b' : '#64748b';
  const progressBg = isDark ? 'rgba(148, 163, 184, 0.2)' : '#e2e8f0';
  const shadow = isDark ? '0 20px 60px rgba(0,0,0,0.8)' : '0 20px 60px rgba(0,0,0,0.5)';
  
  // Red flags styling (theme-aware)
  const redFlagBg = isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2';
  const redFlagBorder = '#ef4444';
  const redFlagTitle = isDark ? '#fca5a5' : '#991b1b';
  const redFlagText = isDark ? '#fca5a5' : '#7f1d1d';
  
  // Green flags styling (theme-aware)
  const greenFlagBg = isDark ? 'rgba(16, 185, 129, 0.15)' : '#dcfce7';
  const greenFlagBorder = '#10b981';
  const greenFlagTitle = isDark ? '#6ee7b7' : '#065f46';
  const greenFlagText = isDark ? '#6ee7b7' : '#047857';
  
  const trustColor = analysis.trustScore >= 75 ? '#10b981' : 
                    analysis.trustScore >= 50 ? '#f59e0b' : '#ef4444';
  
  modal.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: ${backdropBg};
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease-out;
    " id="modal-backdrop">
      <div style="
        background: ${modalBg};
        border: 1px solid ${modalBorder};
        border-radius: 20px;
        padding: 32px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: ${shadow};
        animation: slideUp 0.3s ease-out;
        color: ${textColor};
      " onclick="event.stopPropagation()">
        <h2 style="margin: 0 0 20px 0; font-size: 24px; color: ${textColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
          ${analysis.type === 'job_listing' ? 'ðŸ’¼' : 'ðŸ“„'} Analysis Results
        </h2>
        
        <div style="margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-weight: 600; color: ${mutedText};">Trust Score</span>
            <span style="font-weight: 700; color: ${trustColor};">${analysis.trustScore}/100</span>
          </div>
          <div style="background: ${progressBg}; border-radius: 10px; height: 10px; overflow: hidden;">
            <div style="background: ${trustColor}; height: 100%; width: ${analysis.trustScore}%; transition: width 0.5s ease;"></div>
          </div>
        </div>
        
        ${analysis.redFlags.length > 0 ? `
          <div style="background: ${redFlagBg}; border-left: 4px solid ${redFlagBorder}; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h3 style="margin: 0 0 12px 0; color: ${redFlagTitle}; font-size: 14px; font-weight: 700;">âš ï¸ Red Flags</h3>
            <ul style="margin: 0; padding-left: 20px; color: ${redFlagText};">
              ${analysis.redFlags.map(flag => `<li style="margin: 4px 0;">${flag}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${analysis.greenFlags.length > 0 ? `
          <div style="background: ${greenFlagBg}; border-left: 4px solid ${greenFlagBorder}; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h3 style="margin: 0 0 12px 0; color: ${greenFlagTitle}; font-size: 14px; font-weight: 700;">âœ… Positive Indicators</h3>
            <ul style="margin: 0; padding-left: 20px; color: ${greenFlagText};">
              ${analysis.greenFlags.map(flag => `<li style="margin: 4px 0;">${flag}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        <p style="color: ${mutedTextLight}; line-height: 1.6; margin-bottom: 24px;">${analysis.summary}</p>
        
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
          transition: transform 0.2s, opacity 0.2s;
        " onmouseover="this.style.transform='translateY(-2px)'; this.style.opacity='0.9'" onmouseout="this.style.transform='translateY(0)'; this.style.opacity='1'">
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
  // For resumes we now rely only on hover-based insights (no fixed panel)
  if (analysis.type !== 'resume') {
    removeResumeInsightsPanel();
  }
  showAnalysisModal(analysis, null);
}

// ==================== TYPE DETECTION ====================
function detectType(text) {
  if (!text || text.length < 100) return 'unknown';
  
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
    /\b(deadline|last date to apply|apply before)\b/i,
    /\b(key responsibilities|main duties|primary functions)\b/i,
    /\b(position overview|role summary|job description)\b/i,
    /\b(we are seeking|looking to hire|recruiting for)\b/i,
    /\b(employment type|job type|work schedule)\s*:/i,
    /\b(qualifications required|minimum requirements|must have)\b/i,
    /\b(role and responsibilities|job responsibilities|key duties)\b/i
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
    /github\.com\/\w+/i,
    /\b(professional experience|work history|employment record)\s*:/i,
    /\b(academic qualifications|educational background|degree)\s*:/i,
    /\b(technical expertise|core competencies|skill set)\s*:/i
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
    { pattern: /\b(requirements?|qualifications?|eligibility)\s*:/i, weight: 4 },
    { pattern: /\b(responsibilities|duties|role description)\s*:/i, weight: 4 },
    { pattern: /\b(must have|should have|required)\s*:/i, weight: 3 },
    { pattern: /\b(preferred|nice to have|bonus)\s*:/i, weight: 2 },
    { pattern: /\b(\d+[\+\-]\s*years? of experience (required|needed))\b/i, weight: 4 },
    { pattern: /\b(full[\s-]?time|part[\s-]?time|contract|freelance|remote|hybrid)\s+(position|role|job)/i, weight: 3 },
    { pattern: /\b(key (responsibilities|duties|functions|tasks))\b/i, weight: 3 },
    { pattern: /\b(position (details|overview|summary|description))\b/i, weight: 3 },
    { pattern: /\b(what (you|we) (will|need|expect|require))\b/i, weight: 2 },
    { pattern: /\b(about (the|this) (role|position|job))\b/i, weight: 3 },
    { pattern: /\b(role (summary|overview|description))\b/i, weight: 3 }
  ];

  const resumeContextual = [
    { pattern: /\b(work experience|professional experience|employment history)\s*:/i, weight: 4 },
    { pattern: /\b(education|academic background|qualifications)\s*:/i, weight: 4 },
    { pattern: /\b(skills?|technical skills?|core competencies)\s*:/i, weight: 3 },
    { pattern: /\b(projects?|portfolio|work samples)\s*:/i, weight: 3 },
    { pattern: /\b(certifications?|training|courses)\s*:/i, weight: 2 },
    { pattern: /\b(objective|career objective|professional summary)\s*:/i, weight: 3 },
    { pattern: /\b(achievements|accomplishments|awards)\s*:/i, weight: 2 }
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

  // Enhanced scoring with weighted factors
  const firstPersonCount = (text.match(/\b(i |my |me |mine )\b/gi) || []).length;
  if (firstPersonCount >= 8) resumeScore += 4;
  if (firstPersonCount <= 2 && jobScore > 0) jobScore += 2;

  // Check for structured sections (more common in resumes)
  const sectionHeaders = (text.match(/^[A-Z][A-Za-z\s]{3,30}:$/gm) || []).length;
  if (sectionHeaders >= 4 && resumeScore > jobScore) resumeScore += 3;

  // Final decision with improved thresholds
  const scoreDiff = Math.abs(resumeScore - jobScore);
  if (resumeScore >= 15 && resumeScore > jobScore && scoreDiff >= 4) return 'resume';
  if (jobScore >= 15 && jobScore > resumeScore && scoreDiff >= 4) return 'job_listing';
  if (resumeScore >= 10 && resumeScore > jobScore && scoreDiff >= 6) return 'resume';
  if (jobScore >= 10 && jobScore > resumeScore && scoreDiff >= 6) return 'job_listing';
  
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
    ['team', 'company'],
    ['position', 'opening'],
    ['hiring', 'recruiting'],
    ['job description', 'role description'],
    ['work experience', 'professional experience'],
    ['skills', 'competencies']
  ];
  
  let hitScore = 0;
  keywordSets.forEach(set => {
    if (set.every(word => normalized.includes(word))) {
      hitScore += 4;
    } else if (set.some(word => normalized.includes(word))) {
      hitScore += 2;
    }
  });
  
  const bulletCount = (text.match(/[\r\n]+[\s]*(?:[-â€¢*]|[0-9]+\.)/g) || []).length;
  const bulletScore = Math.min(6, bulletCount * 1.5);
  
  const colonSections = (text.match(/\b[A-Z][A-Za-z\s]{2,40}:/g) || []).length;
  const structureScore = Math.min(6, colonSections * 1.2);
  
  const longFormIndicators = [
    /\b(what you'll do|key responsibilities|main duties)\b/i,
    /\b(required qualifications|must have|essential skills)\b/i,
    /\b(about the role|position overview|job summary)\b/i,
    /\b(we are looking for|seeking a|hiring for)\b/i
  ];
  let longFormScore = 0;
  longFormIndicators.forEach(pattern => {
    if (pattern.test(text)) longFormScore += 3;
  });
  
  return (hitScore + bulletScore + structureScore + lengthScore + longFormScore) >= 8;
}

function isFullJobDescription(text) {
  if (!text || text.length < 320) return false;
  const normalized = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;
  let confidence = 0;
  
  const indicatorPatterns = [
    /\b(job description|position description|role description|full job description)\b/i,
    /\b(about (the|this) (role|position|job|opportunity))\b/i,
    /\b(what (you'll|you will) (do|be doing|be responsible for))\b/i,
    /\b(key responsibilities|main responsibilities|primary responsibilities)\b/i,
    /\b(required qualifications|minimum qualifications|essential qualifications)\b/i,
    /\b(preferred qualifications|nice to have|bonus qualifications)\b/i,
    /\b(company overview|about the company|who we are)\b/i,
    /\b(benefits and perks|compensation and benefits)\b/i,
    /\b(how to apply|application process|next steps)\b/i,
    /\b(location|work model|remote work|hybrid work)\b/i,
    /\b(employment type|job type|contract type)\b/i
  ];
  indicatorPatterns.forEach(pattern => {
    if (pattern.test(text)) confidence += 1;
  });
  if (confidence >= 4) confidence += 1;
  
  const structuredHeaders = (text.match(/(?:^|\n)\s*(about the role|role summary|responsibilities|requirements|qualifications|benefits|perks|skills needed|who you are|how to apply|what we offer|about us|company overview)\s*[:\n]/gi) || []).length;
  if (structuredHeaders >= 3) confidence += 2;
  else if (structuredHeaders >= 2) confidence += 1;
  
  const bulletCount = (text.match(/[\r\n]+[\s]*(?:[-â€¢*]|[0-9]+\.)/g) || []).length;
  if (bulletCount >= 6) confidence += 2;
  else if (bulletCount >= 3) confidence += 1;
  
  if (wordCount >= 350) confidence += 1;
  if (wordCount >= 550) confidence += 1;
  
  const paragraphBreaks = (text.match(/\n{2,}/g) || []).length;
  if (paragraphBreaks >= 3) confidence += 1;
  
  if (normalized.includes('responsibilities') && normalized.includes('requirements')) confidence += 1;
  if (normalized.includes('how to apply') || normalized.includes('application process')) confidence += 1;
  
  return confidence >= 6;
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
    <button class="ai-resume-close" aria-label="Close resume insights">Ã—</button>
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
    document.removeEventListener('mousemove', resumeHoverHandler);
    if (document.body) {
      document.body.removeEventListener('mousemove', resumeHoverHandler);
    }
    resumeHoverHandler = null;
  }
  document.removeEventListener('mouseleave', hideHoverInsight);
  if (document.body) {
    document.body.removeEventListener('mouseleave', hideHoverInsight);
  }
  resumeHoverPayload = null;
}

function attachHoverToPageBody(analysis) {
  if (!analysis || !document.body) return;
  // Only one global hover payload should be active at a time
  removeResumeHover();
  removePageHover();

  pageHoverPayload = {
    ...analysis,
    variant: 'job',
    summary: analysis.summary || 'Full job description scanned.'
  };

  pageHoverHandler = (event) => {
    if (!pageHoverPayload) return;
    showHoverInsight(event, pageHoverPayload);
  };

  document.addEventListener('mousemove', pageHoverHandler, { passive: true });
  document.addEventListener('mouseleave', hideHoverInsight);
  announceHoverReady('job');
}

function removePageHover() {
  if (pageHoverHandler) {
    document.removeEventListener('mousemove', pageHoverHandler);
    if (document.body) {
      document.body.removeEventListener('mousemove', pageHoverHandler);
    }
    pageHoverHandler = null;
  }
  document.removeEventListener('mouseleave', hideHoverInsight);
  if (document.body) {
    document.body.removeEventListener('mouseleave', hideHoverInsight);
  }
  pageHoverPayload = null;
}

function attachResumeHoverToPageBody(resumeAnalysis) {
  if (!resumeAnalysis) return;
  
  // Resume hover should replace any job-level hover payload
  removePageHover();
  removeResumeHover();

  // Create a payload for hover
  resumeHoverPayload = {
    variant: 'resume',
    score: resumeAnalysis.score,
    highlights: resumeAnalysis.highlights,
    badges: resumeAnalysis.badges,
    tone: resumeAnalysis.tone,
    focusArea: resumeAnalysis.focusArea,
    signalLabel: resumeAnalysis.signalLabel,
    signalColor: resumeAnalysis.signalColor
  };
  
  // Attach hover to body - only show on hover, no panel
  resumeHoverHandler = (event) => {
    if (!resumeHoverPayload) return;
    // Show hover popup when moving mouse over the page
    showHoverInsight(event, resumeHoverPayload);
  };
  
  document.addEventListener('mousemove', resumeHoverHandler, { passive: true });
  document.addEventListener('mouseleave', hideHoverInsight);
  announceHoverReady('resume');
}

function analyzeResumeContent(text) {
  if (!text || text.length < 150) {
    return null;
  }

  const normalized = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;
  const highlightList = [];
  const badgeSet = new Set();

  const addHighlight = (message) => {
    if (message && !highlightList.includes(message) && highlightList.length < 4) {
      highlightList.push(message);
    }
  };

  const addBadge = (label) => {
    if (label) badgeSet.add(label);
  };

  let score = 32;
  let penalty = 0;

  const sections = [
    /\b(work experience|professional experience|employment history)\b/i,
    /\b(education|academic background|qualifications)\b/i,
    /\b(skill[s]?|competencies|technical skills|core skills)\b/i,
    /\b(summary|profile|objective)\b/i,
    /\b(projects?|portfolio|case studies)\b/i,
    /\b(certifications?|awards|achievements)\b/i,
    /\b(contact information|phone|email|linkedin|github)\b/i
  ];
  const sectionMatches = sections.filter(pattern => pattern.test(text)).length;
  score += Math.min(22, sectionMatches * 3.5);
  if (sectionMatches >= 5) {
    addBadge('Structured sections');
    addHighlight('ATS can read clear Experience / Skills / Education sections.');
  } else if (sectionMatches <= 2) {
    penalty += 6;
    addHighlight('Add clearer Experience, Skills, and Education sections for ATS parsing.');
  }

  // Fake resume / scammy profile signals
  const buzzwords = [
    'hardworking', 'dedicated', 'motivated', 'self starter', 'team player',
    'dynamic', 'results-driven', 'fast learner', 'passionate', 'innovative',
    'synergy', 'go-getter', 'highly motivated'
  ];
  const buzzwordMatches = buzzwords.reduce((count, word) => {
    const regex = new RegExp(`\\b${word.replace(' ', '\\s+')}\\b`, 'gi');
    return count + ((text.match(regex) || []).length);
  }, 0);
  if (buzzwordMatches >= 15) {
    penalty += 10;
    addHighlight('Resume is overloaded with generic buzzwords â€” replace with specific, measurable outcomes.');
    addBadge('Buzzword heavy');
  } else if (buzzwordMatches >= 8) {
    penalty += 5;
    addHighlight('Trim down generic buzzwords and focus on concrete responsibilities.');
  }

  // Suspicious / fake certifications
  const fakeCertPatterns = [
    /\b(youtube certified|whatsapp certified|meta verified professional)\b/i,
    /\b(guaranteed placement certification|overnight expert course)\b/i
  ];
  const fakeCertHit = fakeCertPatterns.some(p => p.test(text));
  if (fakeCertHit) {
    penalty += 12;
    addHighlight('Certifications look suspicious or non-standard â€” verify and rephrase.');
    addBadge('Certifications need review');
  }

  // Repeated templated lines
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const normalizedLines = lines.map(l => l.replace(/\s+/g, ' ').toLowerCase());
  const lineCounts = normalizedLines.reduce((map, line) => {
    if (line.length < 25) return map;
    map[line] = (map[line] || 0) + 1;
    return map;
  }, {});
  const repeatedLines = Object.values(lineCounts).filter(c => c >= 2).length;
  if (repeatedLines >= 3) {
    penalty += 10;
    addHighlight('Multiple bullet points look copy-pasted â€” personalise repeated lines.');
    addBadge('Template repetition');
  }

  // Timeline consistency and unrealistic experience
  const yearMatches = text.match(/\b(19[8-9]\d|20[0-4]\d)\b/g) || [];
  const uniqueYears = Array.from(new Set(yearMatches.map(y => parseInt(y, 10)))).sort();
  if (uniqueYears.length >= 2) {
    const span = uniqueYears[uniqueYears.length - 1] - uniqueYears[0];
    if (span > 45) {
      penalty += 8;
      addHighlight('Employment timeline spans unusually long â€” double check dates.');
      addBadge('Timeline check');
    }
  }

  // Unrealistic experience level vs. degree year
  const expMatches = text.match(/(\d+)\+?\s+years? of experience/gi) || [];
  const maxExp = expMatches.reduce((max, m) => {
    const num = parseInt(m, 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  if (maxExp >= 20 && !/\b(senior|director|vp|c-level|chief)\b/i.test(text)) {
    penalty += 6;
    addHighlight('High years of experience claimed without senior-level titles â€” ensure claims are realistic.');
  }

  const commonATSKeywords = [
    'python','java','javascript','typescript','react','node','sql','nosql','aws','azure','gcp','docker','kubernetes','git','terraform',
    'agile','scrum','machine learning','ai','data science','analytics','tableau','power bi','project management','leadership',
    'communication','design','figma','ux','ui','marketing','sales','finance','accounting','product management',
    'business analysis','quality assurance','testing','cloud','microservices','stakeholder','strategy','roadmap','operations','security'
  ];
  const keywordHits = new Set();
  commonATSKeywords.forEach(keyword => {
    if (normalized.includes(keyword)) {
      keywordHits.add(keyword);
    }
  });
  const keywordCount = keywordHits.size;
  if (keywordCount >= 11) {
    score += 18;
    addBadge('Keyword optimized');
    addHighlight('Strong coverage of role-specific keywords.');
  } else if (keywordCount >= 7) {
    score += 12;
    addHighlight('Good keyword coverage for ATS filters.');
  } else if (keywordCount >= 4) {
    score += 7;
    addHighlight('Add a few more domain keywords to boost ATS score.');
  } else {
    score += keywordCount * 2;
    penalty += 8;
    addHighlight('ATS needs more role-specific keywords (skills, tools, domain terms).');
  }

  const metricsPattern = /\b\d+(?:\.\d+)?%|\b\d+[kKmM]?\b(?:\s+(users|customers|revenue|sales|growth|increase|decrease|reduction|improvement|efficiency|savings|budget|team|members|projects|leads|pipeline))?/g;
  const metricsMatches = (text.match(metricsPattern) || []).length;
  if (metricsMatches >= 5) {
    score += 12;
    addBadge('Results-driven');
    addHighlight('Great use of quantified achievements.');
  } else if (metricsMatches >= 2) {
    score += 8;
    addHighlight('Includes measurable outcomes â€” add a few more for extra punch.');
  } else {
    penalty += 6;
    addHighlight('Add percentages, counts, or revenue impact to showcase outcomes.');
  }

  const actionVerbMatches = (text.match(/\b(led|managed|mentored|spearheaded|directed|built|developed|implemented|designed|created|launched|optimized|improved|scaled|grew|accelerated|owned|architected|delivered|deployed|shipped)\b/gi) || []).length;
  if (actionVerbMatches >= 8) {
    score += 9;
    addBadge('Leadership verbs');
  } else if (actionVerbMatches >= 4) {
    score += 6;
  } else {
    penalty += 4;
    addHighlight('Start bullet points with action verbs (Led, Built, Delivered).');
  }

  const bulletPoints = (text.match(/[\r\n]+[\s]*(?:[-â€¢*]|[0-9]+\.)/g) || []).length;
  if (bulletPoints >= 10) {
    score += 8;
    addBadge('Well-formatted');
  } else if (bulletPoints >= 5) {
    score += 5;
  } else {
    penalty += 4;
    addHighlight('Use bullet points so ATS parsers can read responsibilities cleanly.');
  }

  if (wordCount >= 400 && wordCount <= 850) {
    score += 8;
    addBadge('Ideal length');
  } else if (wordCount >= 300 && wordCount <= 1000) {
    score += 5;
  } else {
    penalty += 5;
    addHighlight('Keep resumes between 1â€“2 pages (around 400â€“850 words).');
  }

  const firstPersonCount = (normalized.match(/\b(i |my |me |mine )/g) || []).length;
  let tone = 'Balanced';
  if (firstPersonCount <= 4) {
    score += 4;
    tone = 'Professional';
  } else if (firstPersonCount > 14) {
    penalty += 4;
    tone = 'Personal';
    addHighlight('Tone feels conversational â€” lean on objective statements for ATS.');
  }

  const hasContactInfo = /\b(email|@|phone|mobile|linkedin\.com\/in)\b/i.test(text);
  if (hasContactInfo) {
    score += 3;
    addBadge('Contact ready');
  } else {
    penalty += 6;
    addHighlight('Include email, phone, and LinkedIn in the header.');
  }

  const hasEducationDetail = /\b(bachelor|master|phd|mba|b\.?s\.?|m\.?s\.?|diploma|degree)\b/i.test(text);
  if (!hasEducationDetail) {
    penalty += 3;
    addHighlight('Spell out your degree or education credentials.');
  }

  const hasPortfolio = /\b(portfolio|case study|behance\.net|dribbble\.com|github\.com|notion\.site)\b/i.test(text);
  if (hasPortfolio) {
    score += 3;
    addBadge('Work samples linked');
  }

  if (/\b(references available upon request)\b/i.test(text)) {
    penalty += 2;
  }

  // Penalise resumes that never mention dates or years â€” ATS cannot build a timeline
  const hasAnyYear = /\b(19[8-9]\d|20[0-4]\d)\b/.test(text);
  if (!hasAnyYear) {
    penalty += 6;
    addHighlight('Add years for education and work experience to build a clear timeline.');
  }

  if (!/\b(years? of experience|yrs of experience)\b/i.test(text) && wordCount > 400) {
    addHighlight('Call out total years of experience for quick recruiter context.');
  }

  const deterministicNudge = getDeterministicNoise(text) * 0.2;
  const rawScore = score - penalty;
  const saturationPenalty = Math.max(0, rawScore - 78) * 0.35;
  let finalScore = rawScore - saturationPenalty + deterministicNudge;
  finalScore = Math.max(25, Math.min(94, Math.round(finalScore)));

  const focusArea = (() => {
    if (normalized.includes('engineer') || normalized.includes('developer') || normalized.includes('programmer') || normalized.includes('software')) return 'Technical';
    if (normalized.includes('design') || normalized.includes('ux') || normalized.includes('ui') || normalized.includes('creative')) return 'Design';
    if (normalized.includes('marketing') || normalized.includes('growth') || normalized.includes('sales')) return 'Growth';
    if (normalized.includes('product manager') || normalized.includes('roadmap') || normalized.includes('go-to-market')) return 'Product';
    if (normalized.includes('data') || normalized.includes('analyst') || normalized.includes('analytics')) return 'Data';
    return 'General';
  })();

  const signalLabel = finalScore >= 80 ? 'ATS Optimized' :
                      finalScore >= 65 ? 'Strong Match' :
                      finalScore >= 50 ? 'Moderate Match' : 'Needs Improvement';
  const signalColor = getResumeSignalColor(signalLabel);

  const highlights = highlightList.slice(0, 3);
  if (highlights.length === 0) {
    highlights.push('Baseline ATS compatibility detected.');
  }

  const badges = Array.from(badgeSet).slice(0, 4);
  if (badges.length === 0) {
    badges.push('Foundational profile');
  }

  return {
    score: finalScore,
    highlights,
    badges,
    tone,
    focusArea,
    signalLabel,
    signalColor
  };
}

function getResumeSignalColor(label) {
  switch (label) {
    case 'ATS Optimized':
      return '#22c55e';
    case 'Strong Match':
      return '#38bdf8';
    case 'Moderate Match':
      return '#fbbf24';
    default:
      return '#f87171';
  }
}

function resolvePDFSource() {
  try {
    const currentUrl = new URL(window.location.href);
    const viewerParam = currentUrl.searchParams.get('file') || currentUrl.searchParams.get('src');
    if (viewerParam) {
      return decodeURIComponent(viewerParam);
    }
  } catch (err) {
    // ignore
  }

  const embed = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"], iframe[src*=".pdf"]');
  if (embed && embed.src) {
    try {
      return new URL(embed.src, window.location.href).toString();
    } catch {
      return embed.src;
    }
  }

  const linkTag = document.querySelector('link[type="application/pdf"]');
  if (linkTag && linkTag.href) {
    return linkTag.href;
  }

  return window.location.href;
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
  const href = window.location.href.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();
  return (
    document.contentType === 'application/pdf' ||
    href.endsWith('.pdf') ||
    pathname.endsWith('.pdf') ||
    (href.startsWith('file://') && (href.includes('.pdf') || pathname.includes('.pdf'))) ||
    document.querySelector('embed[type="application/pdf"]') !== null ||
    document.querySelector('object[type="application/pdf"]') !== null
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
                console.log('âœ… PDF.js loaded successfully (CSP-safe)');
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

    const pdf = await getPdfDocumentFromUrl(pdfUrl);
    if (!pdf) return null;
    let fullText = '';

    const maxPages = Math.min(pdf.numPages, 15);

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
    // Try alternative method for local files
    if (pdfUrl.startsWith('file://')) {
      try {
        const response = await fetch(pdfUrl);
        const blob = await response.blob();
        return await extractTextFromBlob(blob);
      } catch (fetchError) {
        console.error('Alternative PDF extraction failed:', fetchError);
      }
    }
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

async function getPdfDocumentFromUrl(pdfUrl) {
  try {
    return await window.pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: true,
      disableAutoFetch: false,
      disableStream: false
    }).promise;
  } catch (primaryError) {
    console.warn('Primary PDF load failed, attempting fetch fallback', primaryError);
    const buffer = await fetchPdfArrayBuffer(pdfUrl);
    if (!buffer) throw primaryError;
    return await window.pdfjsLib.getDocument({ data: buffer }).promise;
  }
}

async function fetchPdfArrayBuffer(pdfUrl) {
  if (!/^https?:/i.test(pdfUrl)) return null;
  try {
    const response = await fetch(pdfUrl, { credentials: 'include' });
    if (response.ok) {
      return await response.arrayBuffer();
    }
  } catch (error) {
    console.warn('Direct PDF fetch failed, trying background fetch', error);
  }

  try {
    const result = await browser.runtime.sendMessage({ action: 'fetchPdfBuffer', url: pdfUrl });
    if (result && result.success && result.buffer) {
      return result.buffer;
    }
  } catch (error) {
    console.error('Extension-assisted PDF fetch failed:', error);
  }

  return null;
}

async function analyzePDFPage() {
  try {
    showLoadingNotification('Agentic AI scanning PDFâ€¦');
    const pdfSource = resolvePDFSource();
    const href = pdfSource || window.location.href;
    const pdfText = await extractTextFromPDF(href);
    
    hideLoadingNotification();
    if (!pdfText || pdfText.length < 100) {
      showNotification('Unable to read PDF content', 'error');
      return;
    }
    
    const analysis = performAnalysis(pdfText);
    const isResume = analysis.type === 'resume' || isLikelyResumeText(pdfText);
    
    if (isResume) {
      // Only show hover, no panel
      const resumeAnalysis = analyzeResumeContent(pdfText);
      if (resumeAnalysis) {
        attachResumeHoverToPageBody(resumeAnalysis);
        showNotification('ðŸ“„ Resume PDF scanned â€” hover anywhere for ATS score.', 'success');
      }
    } else {
      removeResumeInsightsPanel();
      // If it's a job listing PDF, attach hover
      if (analysis.type === 'job_listing' || analysis.jobContext || isLikelyJobText(pdfText) || isFullJobDescription(pdfText)) {
        attachHoverToPageBody(analysis);
        showNotification('ðŸ§­ Full job description PDF scanned â€” hover anywhere for insight.', 'success');
      } else {
        removePageHover();
      }
    }
    
    showPDFAnalysisModal(analysis, pdfText, extractFileName(href));
  } catch (error) {
    console.error('PDF page analysis failed', error);
    hideLoadingNotification();
    showNotification('PDF scan failed', 'error');
  }
}

function isLikelyResumeText(text) {
  if (!text || text.length < 150) return false;
  const normalized = text.toLowerCase();
  const resumeIndicators = [
    /\b(work experience|professional experience|employment history)\b/i,
    /\b(education|academic background|qualifications|academic qualifications)\b/i,
    /\b(skills?|technical skills?|core competencies|key skills)\b/i,
    /\b(objective|career goal|professional summary|career objective)\b/i,
    /\b(projects?|portfolio|achievements|certifications?)\b/i,
    /\b(i |my |me |mine )/gi
  ];
  let score = 0;
  resumeIndicators.forEach(pattern => {
    if (pattern.test(text)) score += 2;
  });
  const firstPersonCount = (normalized.match(/\b(i |my |me |mine )/g) || []).length;
  if (firstPersonCount >= 8) score += 4;
  else if (firstPersonCount >= 5) score += 2;
  
  // Check for resume structure
  const sectionHeaders = (text.match(/^[A-Z][A-Za-z\s]{3,30}:$/gm) || []).length;
  if (sectionHeaders >= 3) score += 2;
  
  return score >= 6;
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
      showLoadingNotification('Scanning local PDF resumeâ€¦');
      const text = await extractTextFromBlob(file);
      hideLoadingNotification();
      if (!text) {
        showNotification('Unable to parse PDF', 'error');
        return;
      }
      const analysis = performAnalysis(text);
      if (analysis.type === 'resume') {
        // Only show hover, no panel
        const resumeAnalysis = analyzeResumeContent(text);
        if (resumeAnalysis) {
          attachResumeHoverToPageBody(resumeAnalysis);
          showNotification('ðŸ“„ Resume PDF scanned â€” hover anywhere for ATS score.', 'success');
        }
      } else {
        removeResumeInsightsPanel();
        if (analysis.type === 'job_listing' || isLikelyJobText(text) || isFullJobDescription(text)) {
          attachHoverToPageBody(analysis);
          showNotification('ðŸ§­ Full job description PDF scanned â€” hover anywhere for insight.', 'success');
        } else {
          removePageHover();
        }
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
      // Only show hover, no panel
      const resumeAnalysis = analyzeResumeContent(text);
      if (resumeAnalysis) {
        attachResumeHoverToPageBody(resumeAnalysis);
        showNotification('ðŸ“„ Resume PDF scanned â€” hover anywhere for ATS score.', 'success');
      }
    } else if (analysis.type === 'job_listing' || isLikelyJobText(text) || isFullJobDescription(text)) {
      attachHoverToPageBody(analysis);
      showNotification('ðŸ§­ Full job description PDF scanned â€” hover anywhere for insight.', 'success');
    } else {
      removePageHover();
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
      if (isJobHost()) {
        const hostname = window.location.hostname;
        const hasJobCards = document.querySelectorAll('.individual_internship, .job-card-container, .jobs-search-results__list-item, .jobTuple, .job_seen_beacon, .react-job-listing').length > 0;
        
        // If we find job cards but page mode is unknown, set it to job
        if (currentPageMode === 'unknown' && hasJobCards) {
          currentPageMode = 'job';
          console.log('ðŸ” DOM observer: Found job cards, setting to job mode');
        }
        
        if (currentPageMode === 'job') {
          // Skip highlightJobListings on Internshala listing pages (full-page analysis)
          const isInternshalaListing = hostname.includes('internshala.com') && 
                                      document.querySelectorAll('.individual_internship').length > 1;
          if (!isInternshalaListing) {
            highlightJobListings(); // Only skip on Internshala listing pages
          }
          // Always analyze job cards for all sites (including Internshala)
          analyzeJobCards();
        }
      }
    }, 600);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
}