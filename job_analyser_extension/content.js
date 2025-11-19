// ==================== GLOBAL VARIABLES ====================
const browser = window.browser || window.chrome;
let pdfJsLoaded = false;
let extensionEnabled = true;
let analyzedElements = new WeakSet();

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
  
  return false;
});

// ==================== INITIALIZATION ====================
(function init() {
  console.log('🚀 AI Job & Resume Analyzer loaded');
  
  // Check if extension is enabled
  browser.storage.local.get(['extensionEnabled'], function(result) {
    extensionEnabled = result.extensionEnabled !== false;
    
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
  }, 1000);
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
  
  if (type === 'job_listing') {
    showNotification('💼 Job Listing Detected!', 'success');
    highlightJobListings();
  } else if (type === 'resume') {
    showNotification('📄 Resume Detected!', 'info');
  } else {
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
    if (text && text.length > 100 && text.length < 5000) {
      const type = detectType(text);
      if (type === 'job_listing') {
        addJobIndicator(el);
        analyzedElements.add(el);
      }
    }
  });
}

function analyzeJobCards() {
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
      if (!analyzedElements.has(card)) {
        addJobIndicator(card);
        analyzedElements.add(card);
      }
    });
  }
}

// ==================== UI INDICATORS ====================
function addJobIndicator(element) {
  // Don't add if already has indicator
  if (element.querySelector('.ai-job-indicator')) return;
  
  const indicator = document.createElement('div');
  indicator.className = 'ai-job-indicator';
  indicator.innerHTML = '✨ AI';
  indicator.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    z-index: 1000;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    transition: all 0.2s ease;
  `;
  
  // Make parent position relative if needed
  const parentPosition = window.getComputedStyle(element).position;
  if (parentPosition === 'static') {
    element.style.position = 'relative';
  }
  
  // Add hover effect
  indicator.addEventListener('mouseenter', () => {
    indicator.style.transform = 'scale(1.1)';
    indicator.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
  });
  
  indicator.addEventListener('mouseleave', () => {
    indicator.style.transform = 'scale(1)';
    indicator.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
  });
  
  // Add click handler for detailed analysis
  indicator.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = element.innerText;
    const analysis = performAnalysis(text);
    showAnalysisModal(analysis, element);
  });
  
  element.appendChild(indicator);
}

function removeAllIndicators() {
  document.querySelectorAll('.ai-job-indicator').forEach(el => el.remove());
  analyzedElements = new WeakSet();
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
  
  // Keep score in 0-100 range
  trustScore = Math.max(0, Math.min(100, trustScore));
  
  return {
    type,
    trustScore,
    redFlags,
    greenFlags,
    summary: generateSummary(type, trustScore, text)
  };
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

// ==================== PDF SUPPORT ====================
// ==================== FIXED PDF SUPPORT ====================
// Replace the PDF-related functions in content.js with these

// reuse existing pdfJsLoaded variable declared at top

async function setupPDFSupport() {
  // Only load PDF.js when actually needed
  const hasPDFLinks = document.querySelector('a[href$=".pdf"]') !== null;
  const hasFileInputs = document.querySelector('input[type="file"]') !== null;
  const isPDF = isPDFPage();

  if (isPDF) {
    await loadPDFJsSafe();
    await analyzePDFPage();
  } else if (hasPDFLinks || hasFileInputs) {
    // Lazy load when user interacts
    if (hasPDFLinks) monitorPDFLinks();
    if (hasFileInputs) monitorFileUploads();
  }
}

function isPDFPage() {
  // More reliable PDF detection
  return (
    document.contentType === 'application/pdf' ||
    window.location.href.toLowerCase().endsWith('.pdf') ||
    (document.querySelector('embed[type="application/pdf"]') !== null && 
     document.querySelector('embed[type="application/pdf"]').src)
  );
}

async function loadPDFJsSafe() {
  if (pdfJsLoaded) return true;
  
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.pdfjsLib) {
      pdfJsLoaded = true;
      resolve(true);
      return;
    }

    // Create script with timeout
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    
    const timeout = setTimeout(() => {
      console.error('PDF.js loading timeout');
      script.remove();
      reject(new Error('PDF.js loading timeout'));
    }, 10000); // 10 second timeout

    script.onload = () => {
      clearTimeout(timeout);
      if (window.pdfjsLib) {
        // IMPORTANT: Disable worker to avoid CSP issues
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = null;
        
        // Use legacy build without worker
        pdfJsLoaded = true;
        console.log('✅ PDF.js loaded successfully (worker disabled)');
        resolve(true);
      } else {
        clearTimeout(timeout);
        reject(new Error('PDF.js failed to initialize'));
      }
    };
    
    script.onerror = () => {
      clearTimeout(timeout);
      console.error('Failed to load PDF.js script');
      reject(new Error('Failed to load PDF.js script'));
    };
    
    document.head.appendChild(script);
  });
}

async function extractTextFromPDF(pdfUrl) {
  try {
    const loaded = await loadPDFJsSafe();
    if (!loaded) {
      console.error('PDF.js not loaded');
      return null;
    }

    // Configure loading task without worker
    const loadingTask = window.pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: false,
      disableWorker: true, // Disable worker
      isEvalSupported: false,
      useWorkerFetch: false
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';

    // Limit to first 10 pages for performance
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
        // Continue with other pages
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
    // Validate blob
    if (!blob || blob.type !== 'application/pdf') {
      console.error('Invalid PDF blob');
      return null;
    }

    const loaded = await loadPDFJsSafe();
    if (!loaded) {
      console.error('PDF.js not loaded');
      return null;
    }

    const arrayBuffer = await blob.arrayBuffer();
    
    // Configure loading task without worker
    const loadingTask = window.pdfjsLib.getDocument({ 
      data: arrayBuffer,
      disableWorker: true, // Disable worker
      isEvalSupported: false,
      useWorkerFetch: false,
      verbosity: 0 // Suppress console warnings
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';

    // Limit to first 10 pages
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
        // Continue with other pages
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
    console.log('📄 Analyzing PDF page...');
    showLoadingNotification('📄 Analyzing PDF...');
    
    const text = await extractTextFromPDF(window.location.href);
    
    // Remove loading notification
    const loadingNotif = document.getElementById('ai-loading-notif');
    if (loadingNotif) loadingNotif.remove();
    
    if (text && text.length > 100) {
      const analysis = performAnalysis(text);
      if (analysis.type !== 'unknown') {
        showPDFOverlay(analysis, text);
        showNotification('✅ PDF analyzed successfully!');
      } else {
        showNotification('ℹ️ Could not identify document type');
      }
    } else {
      showNotification('⚠️ Could not extract text from PDF');
    }
  } catch (error) {
    console.error('PDF page analysis failed:', error);
    showNotification('❌ Failed to analyze PDF');
  }
}

function monitorPDFLinks() {
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('a');
    if (!target || !target.href || !target.href.toLowerCase().endsWith('.pdf')) {
      return;
    }

    // Only intercept if not opening in new tab
    if (e.ctrlKey || e.metaKey || e.shiftKey || target.target === '_blank') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    
    showLoadingNotification('📄 Analyzing PDF...');
    
    try {
      await loadPDFJsSafe(); // Load PDF.js first
      const text = await extractTextFromPDF(target.href);
      
      // Remove loading notification
      const loadingNotif = document.getElementById('ai-loading-notif');
      if (loadingNotif) loadingNotif.remove();
      
      if (text && text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          showPDFAnalysisModal(analysis, text, target.href);
        } else {
          showNotification('ℹ️ Could not identify content type');
        }
      } else {
        showNotification('⚠️ Could not extract text from PDF');
      }
    } catch (error) {
      console.error('PDF analysis failed:', error);
      
      // Remove loading notification
      const loadingNotif = document.getElementById('ai-loading-notif');
      if (loadingNotif) loadingNotif.remove();
      
      showNotification('❌ Failed to analyze PDF');
    }
    
    // Ask user if they want to open anyway
    setTimeout(() => {
      if (confirm('Would you like to open the PDF in a new tab?')) {
        window.open(target.href, '_blank');
      }
    }, 1000);
  }, true); // Use capture phase
}

function monitorFileUploads() {
  // Monitor existing file inputs
  document.querySelectorAll('input[type="file"]').forEach(attachFileHandler);

  // Monitor new file inputs with debouncing
  let observerTimeout;
  const observer = new MutationObserver((mutations) => {
    clearTimeout(observerTimeout);
    observerTimeout = setTimeout(() => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            if (node.matches && node.matches('input[type="file"]')) {
              attachFileHandler(node);
            }
            if (node.querySelectorAll) {
              node.querySelectorAll('input[type="file"]').forEach(attachFileHandler);
            }
          }
        });
      });
    }, 100); // Debounce for 100ms
  });

  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
}

function attachFileHandler(input) {
  if (input.dataset.aiAnalyzerAttached === 'true') return;
  input.dataset.aiAnalyzerAttached = 'true';

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    
    if (!file) return;
    
    // Check file type and size
    if (file.type !== 'application/pdf') {
      console.log('Not a PDF file, skipping analysis');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      showNotification('⚠️ PDF too large (max 5MB)');
      return;
    }

    if (file.size < 100) { // Too small to be valid
      console.log('File too small, skipping analysis');
      return;
    }

    showLoadingNotification('📄 Analyzing uploaded PDF...');
    
    try {
      await loadPDFJsSafe(); // Ensure PDF.js is loaded
      const text = await extractTextFromBlob(file);
      
      // Remove loading notification
      const loadingNotif = document.getElementById('ai-loading-notif');
      if (loadingNotif) loadingNotif.remove();
      
      if (text && text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          showPDFAnalysisModal(analysis, text, file.name);
          showNotification(`✅ ${file.name} analyzed successfully!`);
        } else {
          showNotification('ℹ️ Could not identify content type');
        }
      } else {
        showNotification('⚠️ Could not extract text from PDF');
      }
    } catch (error) {
      console.error('File upload analysis failed:', error);
      
      // Remove loading notification
      const loadingNotif = document.getElementById('ai-loading-notif');
      if (loadingNotif) loadingNotif.remove();
      
      showNotification('❌ Failed to analyze PDF');
    }
  });
}

function showPDFOverlay(analysis, fullText) {
  const overlay = document.createElement('div');
  overlay.id = 'ai-pdf-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    z-index: 9999999;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.3s ease;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    border-radius: 16px;
    padding: 30px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    position: relative;
  `;

  modal.innerHTML = generateDetailedHTML(analysis, fullText);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `
    position: absolute;
    top: 20px;
    right: 20px;
    background: #ef4444;
    color: white;
    border: none;
    font-size: 28px;
    cursor: pointer;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 300;
    transition: all 0.2s;
    line-height: 1;
  `;
  closeBtn.onmouseover = () => closeBtn.style.background = '#dc2626';
  closeBtn.onmouseout = () => closeBtn.style.background = '#ef4444';
  closeBtn.onclick = () => overlay.remove();

  modal.appendChild(closeBtn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function showPDFAnalysisModal(analysis, fullText, filename) {
  showPDFOverlay(analysis, fullText);
}