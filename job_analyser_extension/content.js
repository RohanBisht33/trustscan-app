// ============================================
// FILE: content.js
// Complete rewrite with better detection and PDF support
// ============================================
(function() {
  'use strict';

  // Cross-browser compatibility
  const browser = window.browser || window.chrome;

  let isEnabled = true;
  let tooltip = null;
  let analysisCache = new Map();
  let jobCards = [];
  let observer = null;

  // Site-specific selectors for job listings
  const SITE_SELECTORS = {
    'linkedin.com': {
      jobCard: '.job-card-container, .jobs-search-results__list-item',
      title: '.job-card-list__title, .job-card-container__link',
      company: '.job-card-container__company-name',
      description: '.job-card-container__job-insight'
    },
    'internshala.com': {
      jobCard: '.individual_internship, .internship_meta',
      title: '.job-internship-name, .profile',
      company: '.company-name, .company_name',
      description: '.internship_other_details'
    },
    'naukri.com': {
      jobCard: '.jobTuple, .jobTupleHeader',
      title: '.title, .jobTuple-title',
      company: '.companyInfo, .subTitle',
      description: '.job-description'
    },
    'indeed.com': {
      jobCard: '.job_seen_beacon, .jobsearch-SerpJobCard',
      title: '.jobTitle, .jcs-JobTitle',
      company: '.companyName',
      description: '.job-snippet'
    },
    'glassdoor.com': {
      jobCard: '.react-job-listing',
      title: '.job-title',
      company: '.employer-name',
      description: '.job-description'
    }
  };

  init();

  function init() {
    browser.storage.local.get(['extensionEnabled'], function(result) {
      isEnabled = result.extensionEnabled !== false;
      if (isEnabled) {
        console.log('🚀 AI Job & Resume Analyzer: Active');
        createTooltip();
        attachListeners();
        detectJobListings();
        observeDOMChanges();
        detectPDFs();
      }
    });
  }

  browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'toggleExtension') {
      isEnabled = request.enabled;
      if (isEnabled) {
        attachListeners();
        detectJobListings();
      } else {
        removeListeners();
        hideTooltip();
        clearJobIndicators();
      }
    } else if (request.action === 'analyzeFullPage') {
      analyzeFullPage();
    }
  });

  function getCurrentSite() {
    const hostname = window.location.hostname;
    for (const site in SITE_SELECTORS) {
      if (hostname.includes(site)) {
        return site;
      }
    }
    return null;
  }

  function detectJobListings() {
    const site = getCurrentSite();
    if (!site) return;

    const selectors = SITE_SELECTORS[site];
    const cards = document.querySelectorAll(selectors.jobCard);
    
    jobCards = [];
    cards.forEach((card, index) => {
      const text = extractJobCardText(card, selectors);
      if (text.length > 50) {
        const analysis = performAnalysis(text);
        if (analysis.type === 'job_listing') {
          jobCards.push({ element: card, analysis, text });
          addJobIndicator(card, analysis, index);
        }
      }
    });

    if (jobCards.length > 0) {
      showBatchNotification(`✓ Analyzed ${jobCards.length} job listings`);
    }
  }

  function extractJobCardText(card, selectors) {
    let text = '';
    
    try {
      const title = card.querySelector(selectors.title);
      const company = card.querySelector(selectors.company);
      const description = card.querySelector(selectors.description);
      
      if (title) text += title.textContent + ' ';
      if (company) text += company.textContent + ' ';
      if (description) text += description.textContent + ' ';
      
      // Fallback to full card text
      if (!text.trim()) {
        text = card.textContent;
      }
    } catch (e) {
      text = card.textContent;
    }
    
    return text.trim();
  }

  function addJobIndicator(card, analysis, index) {
    // Remove existing indicator
    const existing = card.querySelector('.ai-job-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.className = 'ai-job-indicator';
    indicator.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: ${getTrustColor(analysis.trustScore)};
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 1000;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    indicator.textContent = analysis.trustScore;
    indicator.title = `Trust Score: ${analysis.trustScore}%`;

    // Make parent position relative
    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }

    indicator.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = indicator.getBoundingClientRect();
      showDetailedAnalysis(analysis, rect.left, rect.bottom + 5);
    });

    card.appendChild(indicator);
  }

  function getTrustColor(score) {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#eab308';
    return '#ef4444';
  }

  function clearJobIndicators() {
    document.querySelectorAll('.ai-job-indicator').forEach(el => el.remove());
  }

  function observeDOMChanges() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      let shouldReanalyze = false;
      
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1 && node.matches && 
                (node.matches('.job-card-container') || 
                 node.matches('.individual_internship') ||
                 node.matches('.jobTuple'))) {
              shouldReanalyze = true;
            }
          });
        }
      });

      if (shouldReanalyze) {
        setTimeout(detectJobListings, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  async function detectPDFs() {
    // Check if current page is a PDF
    if (document.contentType === 'application/pdf' || 
        window.location.pathname.endsWith('.pdf')) {
      await analyzePDFPage();
    }

    // Monitor for PDF links
    document.addEventListener('click', async (e) => {
      const target = e.target.closest('a');
      if (target && target.href && target.href.endsWith('.pdf')) {
        const pdfUrl = target.href;
        const text = await window.PDFParser.extractText(pdfUrl);
        if (text) {
          const analysis = performAnalysis(text);
          if (analysis.type !== 'unknown') {
            // Show notification about PDF analysis
            showPDFNotification(target, analysis);
          }
        }
      }
    });

    // Monitor file inputs for PDF uploads
    document.querySelectorAll('input[type="file"]').forEach(input => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
          const text = await window.PDFParser.extractFromBlob(file);
          if (text) {
            const analysis = performAnalysis(text);
            showPDFAnalysisResult(analysis);
          }
        }
      });
    });
  }

  async function analyzePDFPage() {
    try {
      const text = await window.PDFParser.extractText(window.location.href);
      if (text) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          showPDFOverlay(analysis);
        }
      }
    } catch (error) {
      console.error('PDF analysis failed:', error);
    }
  }

  function showPDFOverlay(analysis) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      z-index: 999999;
      max-width: 350px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    overlay.innerHTML = generateDetailedHTML(analysis);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #64748b;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeBtn.onclick = () => overlay.remove();

    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);
  }

  function showPDFNotification(linkElement, analysis) {
    const badge = document.createElement('span');
    badge.style.cssText = `
      margin-left: 8px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: ${analysis.type === 'job_listing' ? '#eff6ff' : '#f0fdf4'};
      color: ${analysis.type === 'job_listing' ? '#1e40af' : '#166534'};
    `;
    badge.textContent = analysis.type === 'job_listing' ? 
      `Job (${analysis.trustScore}%)` : 
      `Resume (${analysis.score}%)`;
    
    linkElement.appendChild(badge);
  }

  function showPDFAnalysisResult(analysis) {
    const result = document.createElement('div');
    result.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      z-index: 999999;
      max-width: 300px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: slideIn 0.3s ease-out;
    `;

    result.innerHTML = `
      <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px;">
        📄 PDF Analyzed
      </div>
      <div style="font-size: 14px; color: #64748b;">
        ${analysis.type === 'job_listing' ? 
          `Trust Score: <strong>${analysis.trustScore}%</strong>` : 
          `Profile Strength: <strong>${analysis.score}%</strong>`}
      </div>
    `;

    document.body.appendChild(result);

    setTimeout(() => {
      result.style.transition = 'opacity 0.3s';
      result.style.opacity = '0';
      setTimeout(() => result.remove(), 300);
    }, 5000);
  }

  function createTooltip() {
    if (tooltip) return;

    // Check if current page is PDF
    if (isPDFPage()) {
      await analyzePDFPage();
    }

  function showDetailedAnalysis(analysis, x, y) {
    if (!tooltip) createTooltip();
    
    tooltip.innerHTML = generateDetailedHTML(analysis);
    tooltip.style.display = 'block';
    
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = x - tooltipRect.width / 2;
    let top = y;

    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }
    if (top + tooltipRect.height > window.innerHeight - 10) {
      top = y - tooltipRect.height - 40;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    // Close on click outside
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!tooltip.contains(e.target)) {
          hideTooltip();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);
  }

  function showTooltip(x, y, content) {
    if (!tooltip) createTooltip();
    
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = x - tooltipRect.width / 2;
    let top = y - tooltipRect.height - 10;

    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }
    if (top < 10) top = y + 20;

  async function loadPDFJs() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) {
        pdfJsLoaded = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          pdfJsLoaded = true;
          console.log('✅ PDF.js loaded successfully');
          resolve();
        } else {
          reject(new Error('PDF.js failed to load'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js'));
      document.head.appendChild(script);
    });
  }

  async function extractTextFromPDF(pdfUrl) {
    try {
      if (!pdfJsLoaded) await loadPDFJs();

      const loadingTask = window.pdfjsLib.getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      let fullText = '';

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }

      return fullText.trim();
    } catch (error) {
      console.error('PDF extraction error:', error);
      return null;
    }
  }

  async function extractTextFromBlob(blob) {
    try {
      if (!pdfJsLoaded) await loadPDFJs();

      const arrayBuffer = await blob.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }

    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      const element = e.target;
      
      // Skip if hovering over job card indicator
      if (element.classList.contains('ai-job-indicator')) return;
      
      const text = getElementText(element);
      
      if (text && text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          showPDFOverlay(analysis, text);
        }
      }
    } catch (error) {
      console.error('PDF page analysis failed:', error);
    }
  }

  function handleMouseOut() {
    clearTimeout(hoverTimeout);
    setTimeout(() => {
      if (!tooltip || !tooltip.matches(':hover')) {
        hideTooltip();
      }
    }, 200);
  }

  function getElementText(element) {
    let text = '';
    
    if (element.tagName === 'P' || element.tagName === 'DIV' || 
        element.tagName === 'SECTION' || element.tagName === 'ARTICLE') {
      text = element.innerText || element.textContent;
    }
    
    return text.trim().substring(0, 2000);
  }

  function analyzeText(text, x, y) {
    // Check cache
    if (analysisCache.has(text)) {
      const analysis = analysisCache.get(text);
      if (analysis.type !== 'unknown') {
        const tooltipContent = generateTooltipHTML(analysis);
        showTooltip(x, y, tooltipContent);
      }
      return;
    }

    const analysis = performAnalysis(text);
    analysisCache.set(text, analysis);
    
    if (analysis.type === 'unknown') return;

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'application/pdf') {
        showLoadingNotification('📄 Analyzing uploaded PDF...');
        
        try {
          const text = await extractTextFromBlob(file);
          if (text) {
            const analysis = performAnalysis(text);
            if (analysis.type !== 'unknown') {
              showPDFAnalysisModal(analysis, text, file.name);
            } else {
              showNotification('❌ Could not analyze PDF content');
            }
          }
        } catch (error) {
          console.error('File upload analysis failed:', error);
          showNotification('❌ Failed to analyze PDF');
        }
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
    `;
    closeBtn.onmouseover = () => closeBtn.style.background = '#dc2626';
    closeBtn.onmouseout = () => closeBtn.style.background = '#ef4444';
    closeBtn.onclick = () => overlay.remove();

    modal.style.position = 'relative';
    modal.appendChild(closeBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function showPDFAnalysisModal(analysis, fullText, filename) {
    showPDFOverlay(analysis, fullText);
    showNotification(`✅ ${filename} analyzed successfully!`);
  }

  // ==================== IMPROVED TYPE DETECTION ====================

  function detectType(text) {
    const lower = text.toLowerCase();
    
    const resumeKeywords = ['experience', 'education', 'skills', 'btech', 'graduate', 'resume', 'cv', 'profile', 'portfolio'];
    const jobKeywords = ['looking for', 'hiring', 'job', 'position', 'required', 'apply', 'vacancy', 'opening'];
    
    const resumeScore = resumeKeywords.filter(k => lower.includes(k)).length;
    const jobScore = jobKeywords.filter(k => lower.includes(k)).length;
    
    if (resumeScore > jobScore && resumeScore >= 2) return 'resume';
    if (jobScore > resumeScore && jobScore >= 2) return 'job_listing';
    
    return 'unknown';
  }

  // ==================== IMPROVED JOB SCORING ====================

  function analyzeJob(text) {
    const lower = text.toLowerCase();
    let score = 85; // Start with neutral-positive score
    const flags = [];
    const positives = [];

    const scamPatterns = [
      { pattern: /no experience needed|no experience required/i, flag: 'No experience needed (common scam)', weight: 15 },
      { pattern: /aadhaar|aadhar|pan card|bank passbook|id proof|upload.*id/i, flag: 'Asks for sensitive ID documents', weight: 35 },
      { pattern: /registration fee|pay.*fee|payment.*required|deposit/i, flag: 'Asks for payment/fees', weight: 35 },
      { pattern: /google form|whatsapp|telegram|social media/i, flag: 'Unofficial application method', weight: 25 },
      { pattern: /training.*paid|earn.*training|paid.*learn/i, flag: 'Suspicious training payment claims', weight: 20 },
      { pattern: /fast promotion|quick promotion|immediate promotion/i, flag: 'Unrealistic promotion promises', weight: 20 },
      { pattern: /virtual assistant.*remote.*no experience/i, flag: 'Classic VA scam pattern', weight: 25 },
      { pattern: /payment processing|money transfer|fund transfer/i, flag: 'Money handling scam risk', weight: 30 },
      { pattern: /earn ₹|earn rs|salary ₹\d{5,}/i, flag: 'Unusually high salary promise', weight: 20 },
      { pattern: /work from home.*₹|wfh.*earn/i, flag: 'Work-from-home money scheme', weight: 20 },
      { pattern: /no interview/i, flag: 'No interview process', weight: 18 },
      { pattern: /easy money|quick money|daily income|weekly payment/i, flag: 'Unrealistic earning promises', weight: 20 },
      { pattern: /click here|click.*link|bit\.ly|shortened url/i, flag: 'Suspicious links', weight: 15 },
      { pattern: /urgent.*hiring|immediate.*joining|join today/i, flag: 'Pressure tactics', weight: 12 },
      { pattern: /guaranteed.*income|assured.*salary/i, flag: 'Guaranteed income claims', weight: 18 },
      { pattern: /part.*time.*\d{4,}|side.*income.*\d{4,}/i, flag: 'Unrealistic part-time pay', weight: 15 },
      { pattern: /flexible.*timing|own.*hours|work.*anytime/i, flag: 'Vague work arrangement', weight: 8 },
      { pattern: /simple.*task|easy.*work|basic.*work/i, flag: 'Vague job description', weight: 10 },
      { pattern: /international.*company.*hiring|global.*hiring/i, flag: 'Vague international claims', weight: 12 }
    ];

    // MEDIUM RED FLAGS
    const mediumFlags = [
      { pattern: /\b(no interview|direct joining|immediate joining today)\b/i, 
        flag: '⚠️ No proper hiring process', weight: 15 },
      { pattern: /\b(click here|click.*link|bit\.ly|tinyurl|shortened link)\b/i, 
        flag: '⚠️ Suspicious external links', weight: 12 },
      { pattern: /\b(urgent|hurry|limited slots|only \d+ positions?|first come)\b/i, 
        flag: '⚠️ Pressure tactics', weight: 10 },
      { pattern: /\b(guaranteed income|assured salary|fixed salary|100% payment)\b/i, 
        flag: '⚠️ Guaranteed income promises', weight: 12 },
      { pattern: /\b(work from home|wfh|remote).*\b(easy|simple|basic|copy paste)\b/i, 
        flag: '⚠️ Vague WFH job description', weight: 10 }
    ];

    // Check all red flags
    criticalFlags.forEach(({ pattern, flag, weight }) => {
      if (pattern.test(text)) {
        flags.push(flag);
        score -= weight;
        console.log(`  ❌ ${flag} (-${weight})`);
      }
    });

    highFlags.forEach(({ pattern, flag, weight }) => {
      if (pattern.test(text)) {
        flags.push(flag);
        score -= weight;
        console.log(`  ⚠️  ${flag} (-${weight})`);
      }
    });

    mediumFlags.forEach(({ pattern, flag, weight }) => {
      if (pattern.test(text)) {
        flags.push(flag);
        score -= weight;
        console.log(`  ⚠️  ${flag} (-${weight})`);
      }
    });

    const hasLegitCompany = /(pvt\.?\s*ltd|private limited|inc\.|corporation|technologies|solutions|systems)/i.test(text);
    const hasVagueCompany = /global|international|world|universal|best|top|leading/i.test(text) && 
                            !/pvt|ltd|inc|corp/i.test(text);
    
    if (hasLegitCompany) {
      positives.push('✅ Legitimate company structure');
      score += 5;
    } else if (hasVagueCompany) {
      flags.push('⚠️ Vague company name');
      score -= 12;
    } else if (!/(company|firm|organization|employer):/i.test(text)) {
      flags.push('⚠️ No clear company identity');
      score -= 10;
    }

    const hasProperProcess = /@.*\.(com|in|co)|careers\.|apply.*official|linkedin\.com|naukri\.com/i.test(text);
    const hasUnprofessionalProcess = /google form|whatsapp|telegram|dm|direct message/i.test(lower);
    
    if (hasProperProcess) {
      positives.push('✅ Professional application channel');
      score += 5;
    } else if (hasUnprofessionalProcess) {
      flags.push('⚠️ Unprofessional application method');
      score -= 15;
    }

    const salaryMatch = text.match(/₹\s*(\d+)[,\d]*\s*(?:per month|\/month|pm)/i);
    if (salaryMatch) {
      let monthlySalary;
      if (text.includes('lpa') || text.includes('lakh')) {
        const lpa = parseInt(salaryMatch[1]);
        monthlySalary = (lpa * 100000) / 12;
      } else {
        monthlySalary = parseInt(salaryMatch[1].replace(/,/g, ''));
      }

      const isNoExperience = /\b(no experience|fresher|0[\s-]years?|entry level)\b/i.test(text);
      
      if (monthlySalary > 80000 && isNoExperience) {
        flags.push('⚠️ Unrealistic salary for experience level');
        score -= 25;
      } else if (monthlySalary > 40000 && monthlySalary <= 80000 && isNoExperience) {
        flags.push('⚠️ High salary for entry-level (verify)');
        score -= 10;
      } else if (monthlySalary >= 20000 && monthlySalary <= 150000) {
        positives.push('✅ Reasonable salary range');
        score += 5;
      }
    }

    if (/red flag|warning|suspicious|scam/i.test(text)) {
      flags.push('Job posting mentions red flags');
      score -= 20;
    }

    const finalScore = Math.max(0, Math.min(100, score));
    console.log(`📊 Final job score: ${finalScore}%, Flags: ${flags.length}, Positives: ${positives.length}`);

    return {
      type: 'job_listing',
      trustScore: finalScore,
      flags: flags,
      positives: positives
    };
  }

  // ==================== IMPROVED RESUME SCORING ====================

  function analyzeResume(text) {
    const lower = text.toLowerCase();
    const highlights = [];
    const redFlags = [];
    let score = 60; // Start with base score

    const techSkills = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'aws', 'docker', 'kubernetes', 
                        'ml', 'ai', 'deep learning', 'django', 'flask', 'angular', 'vue', 'mongodb', 'postgresql'];
    const foundSkills = techSkills.filter(skill => lower.includes(skill));
    
    if (foundSkills.length > 0) {
      highlights.push(`💻 ${foundSkills.length} technical skills: ${foundSkills.slice(0, 6).join(', ')}${foundSkills.length > 6 ? '...' : ''}`);
      score += Math.min(20, foundSkills.length * 2);
      console.log(`  ✅ Found ${foundSkills.length} skills (+${Math.min(20, foundSkills.length * 2)})`);
    } else {
      redFlags.push('❌ No technical skills mentioned');
      score -= 20;
      console.log('  ❌ No skills found (-20)');
    }

    // Skill stuffing detection
    if (foundSkills.length > 20) {
      redFlags.push('⚠️ Excessive skills (possible exaggeration)');
      score -= 15;
      console.log('  ⚠️  Too many skills (-15)');
    }

    if (foundSkills.length > 15) {
      redFlags.push('Excessive skills listed (may be exaggerated)');
      score -= 20;
    }

    const expMatch = text.match(/(\d+)\+?\s*years?/i);
    if (expMatch) {
      const years = parseInt(expMatch[1]);
      highlights.push(`${years} years experience`);
      
      if (years <= 2) score += 10;
      else if (years <= 5) score += 18;
      else if (years <= 10) score += 25;
      else if (years <= 20) score += 20;
      else {
        redFlags.push('⚠️ Very long experience (verify dates)');
        score += 5;
      }

      if (years < 2 && foundSkills.length > 12) {
        redFlags.push('Too many skills for experience level');
        score -= 15;
      }
    } else {
      redFlags.push('❌ No clear experience timeline');
      score -= 12;
      console.log('  ❌ No experience (-12)');
    }

    const educationKeywords = ['btech', 'mtech', 'bachelor', 'master', 'degree', 'bs', 'ms', 'phd', 'b.e', 'm.e'];
    const hasEducation = educationKeywords.some(edu => lower.includes(edu));
    
    if (educationFound) {
      highlights.push('🎓 Technical degree mentioned');
      score += 12;
      console.log('  ✅ Education found (+12)');
    } else {
      redFlags.push('❌ No formal education credentials');
      score -= 15;
      console.log('  ❌ No education (-15)');
    }

    const unrealisticPatterns = [
      { pattern: /\b(expert in everything|know everything|master of all)\b/i, 
        flag: '🚩 Claims expertise in everything', weight: 20 },
      { pattern: /\b(100% success|perfect|never failed|always succeeded)\b/i, 
        flag: '🚩 Unrealistic absolute claims', weight: 15 },
      { pattern: /\b(best|top|#1|world-class) (developer|engineer|professional)\b/i, 
        flag: '🚩 Unverifiable superlatives', weight: 12 },
      { pattern: /\b(genius|prodigy|legendary|rockstar|ninja|guru)\b/i, 
        flag: '🚩 Excessive self-promotion', weight: 10 }
    ];

    unrealisticPatterns.forEach(({ pattern, flag, weight }) => {
      if (pattern.test(text)) {
        redFlags.push(flag);
        score -= weight;
        console.log(`  🚩 ${flag} (-${weight})`);
      }
    });

    const hasActionVerbs = /developed|built|created|designed|implemented|managed|led/i.test(text);
    const onlyBuzzwords = /hard working|team player|fast learner/i.test(text) && !hasActionVerbs;
    
    if (hasActionVerbs) {
      highlights.push('✅ Contains specific achievements');
      score += 10;
      console.log('  ✅ Action verbs found (+10)');
    } else if (onlyBuzzwords) {
      redFlags.push('⚠️ Only generic buzzwords, no specifics');
      score -= 12;
      console.log('  ⚠️  Only buzzwords (-12)');
    }

    const hasProjects = /project|github|portfolio|built/i.test(text);
    const hasCompanies = /pvt|ltd|inc|corp|company/i.test(text);
    const hasDates = /\d{4}|\d{2}\/\d{2}/i.test(text);
    
    if (hasProjects) {
      highlights.push('✅ Projects/portfolio mentioned');
      score += 12;
      console.log('  ✅ Projects found (+12)');
    }

    // Work experience companies
    const hasCompanies = /\b(pvt\.?\s*ltd|inc\.|corporation|technologies|solutions|systems|software|company)\b/i.test(text);
    if (hasCompanies) {
      highlights.push('✅ Work experience listed');
      score += 10;
      console.log('  ✅ Companies found (+10)');
    }

    const hasEmail = /@/i.test(text);
    const hasPhone = /\d{10}|\+\d{2}\s?\d{10}/i.test(text);
    const hasLinkedIn = /linkedin/i.test(text);
    
    if (hasEmail || hasPhone) {
      score += 5;
    } else {
      redFlags.push('⚠️ No dates/timeline provided');
      score -= 10;
      console.log('  ⚠️  No dates (-10)');
    }

    // Contact information
    const hasEmail = /@\w+\.\w+/.test(text);
    const hasPhone = /\b(\+?\d{1,3}[\s-]?)?\d{10}\b/.test(text);
    const hasLinkedIn = /linkedin\.com\/in\//i.test(text);
    const hasGitHub = /github\.com\/\w+/i.test(text);
    
    let contactScore = 0;
    if (hasEmail) contactScore += 3;
    if (hasPhone) contactScore += 3;
    if (hasLinkedIn) {
      highlights.push('✅ LinkedIn profile included');
      contactScore += 5;
    }
    if (hasGitHub) {
      highlights.push('✅ GitHub profile included');
      contactScore += 5;
    }
    
    if (contactScore > 0) {
      score += contactScore;
      console.log(`  ✅ Contact info (+${contactScore})`);
    } else {
      redFlags.push('❌ No contact information');
      score -= 12;
      console.log('  ❌ No contact (-12)');
    }

    if (text.length < 200) {
      redFlags.push('Resume appears incomplete');
      score -= 15;
      console.log('  ⚠️  Too short (-15)');
    } else if (text.length > 2000) {
      highlights.push('✅ Comprehensive resume');
      score += 5;
    }

    const commonMistakes = /experiance|exprience|skillz|companey|projcts/i;
    if (commonMistakes.test(text)) {
      redFlags.push('⚠️ Contains spelling errors');
      score -= 10;
      console.log('  ⚠️  Spelling errors (-10)');
    }

    // Certifications
    const hasCertifications = /\b(certification|certified|certificate|credential)\b/i.test(text);
    if (hasCertifications) {
      highlights.push('✅ Certifications mentioned');
      score += 8;
    }

    const finalScore = Math.max(0, Math.min(100, score));
    console.log(`📊 Final resume score: ${finalScore}%, Highlights: ${highlights.length}, Red flags: ${redFlags.length}`);

    return {
      type: 'resume',
      score: finalScore,
      highlights: highlights,
      redFlags: redFlags
    };
  }

  function generateTooltipHTML(analysis) {
    if (analysis.type === 'job_listing') {
      const trustLevel = getTrustLevel(analysis.trustScore);
      
      return `
        <div style="display: flex; align-items: center; margin-bottom: 12px;">
          <div style="font-size: 20px; margin-right: 8px;">🛡️</div>
          <div>
            <div style="font-weight: 600; color: #1e293b;">Job Listing</div>
            <div style="font-size: 11px; color: #64748b;">AI Analysis</div>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 12px; color: #64748b;">Trust Score</span>
          <span style="font-size: 18px; font-weight: 700; color: ${trustLevel.color};">
            ${analysis.trustScore}%
          </span>
        </div>
        
        <div style="background: #f1f5f9; border-radius: 8px; height: 6px; overflow: hidden; margin-bottom: 12px;">
          <div style="background: ${trustLevel.color}; height: 100%; width: ${analysis.trustScore}%; transition: width 0.3s;"></div>
        </div>
        
        ${analysis.flags.length > 0 ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px; font-size: 12px;">
            <div style="font-weight: 600; color: #991b1b; margin-bottom: 6px;">⚠️ Risk Factors:</div>
            ${analysis.flags.slice(0, 5).map(flag => `<div style="color: #dc2626; margin-left: 12px;">• ${flag}</div>`).join('')}
            ${analysis.flags.length > 5 ? `<div style="color: #dc2626; margin-left: 12px;">• +${analysis.flags.length - 5} more</div>` : ''}
          </div>
        ` : `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px; font-size: 12px; color: #166534;">
            ✓ No risk factors detected
          </div>
        `}
      `;
    } else if (analysis.type === 'resume') {
      return `
        <div style="display: flex; align-items: center; margin-bottom: 12px;">
          <div style="font-size: 22px; margin-right: 10px;">📄</div>
          <div>
            <div style="font-weight: 700; color: #1e293b; font-size: 16px;">Resume</div>
            <div style="font-size: 11px; color: #64748b;">AI Analysis</div>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <span style="font-size: 13px; color: #64748b; font-weight: 500;">Profile Strength</span>
          <span style="font-size: 24px; font-weight: 800; color: ${getScoreColor(analysis.score)};">
            ${analysis.score}%
          </span>
        </div>
        
        <div style="background: #f1f5f9; border-radius: 8px; height: 8px; overflow: hidden; margin-bottom: 14px;">
          <div style="background: ${getScoreColor(analysis.score)}; height: 100%; width: ${analysis.score}%; transition: width 0.3s;"></div>
        </div>
        
        ${analysis.highlights.length > 0 ? `
          <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px; padding: 12px; font-size: 12px; margin-bottom: 8px;">
            <div style="font-weight: 700; color: #1e40af; margin-bottom: 8px; font-size: 13px;">✨ Highlights</div>
            ${analysis.highlights.slice(0, 3).map(h => `<div style="color: #2563eb; margin-bottom: 4px; line-height: 1.4;">${h}</div>`).join('')}
          </div>
        ` : ''}
        
        ${analysis.redFlags && analysis.redFlags.length > 0 ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px; font-size: 12px;">
            <div style="font-weight: 600; color: #991b1b; margin-bottom: 6px;">⚠️ Red Flags:</div>
            ${analysis.redFlags.slice(0, 4).map(flag => `<div style="color: #dc2626; margin-left: 12px;">• ${flag}</div>`).join('')}
            ${analysis.redFlags.length > 4 ? `<div style="color: #dc2626; margin-left: 12px;">• +${analysis.redFlags.length - 4} more</div>` : ''}
          </div>
        ` : ''}
      `;
    }
  }

  function generateDetailedHTML(analysis) {
    if (analysis.type === 'job_listing') {
      const trustLevel = getTrustLevel(analysis.trustScore);
      
      return `
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="font-size: 24px; margin-right: 12px;">🛡️</div>
          <div>
            <div style="font-weight: 700; font-size: 18px; color: #1e293b;">Job Listing Analysis</div>
            <div style="font-size: 12px; color: #64748b;">Complete AI Evaluation</div>
          </div>
        </div>
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
          <div style="text-align: center; color: white;">
            <div style="font-size: 14px; margin-bottom: 8px; opacity: 0.9;">Trust Score</div>
            <div style="font-size: 36px; font-weight: 700;">${analysis.trustScore}%</div>
            <div style="font-size: 12px; margin-top: 4px; opacity: 0.9;">${trustLevel.label}</div>
          </div>
        </div>
        
        ${analysis.flags.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px; font-size: 14px;">🚨 Risk Factors Detected</div>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px;">
              ${analysis.flags.map(flag => `<div style="color: #dc2626; margin-bottom: 6px; font-size: 13px;">• ${flag}</div>`).join('')}
            </div>
          </div>
        ` : `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px; font-size: 13px; color: #166534; margin-bottom: 16px;">
            ✓ No major risk factors detected
          </div>
        `}
        
        <div style="font-size: 11px; color: #64748b; text-align: center; padding-top: 12px; border-top: 1px solid #e2e8f0;">
          AI-powered analysis • Always verify independently
        </div>
      `;
    } else if (analysis.type === 'resume') {
      const scoreLevel = getScoreLevel(analysis.score);
      
      return `
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="font-size: 24px; margin-right: 12px;">📄</div>
          <div>
            <div style="font-weight: 700; font-size: 18px; color: #1e293b;">Resume Analysis</div>
            <div style="font-size: 12px; color: #64748b;">Complete Profile Evaluation</div>
          </div>
        </div>
        
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
          <div style="text-align: center; color: white;">
            <div style="font-size: 14px; margin-bottom: 8px; opacity: 0.9;">Profile Strength</div>
            <div style="font-size: 36px; font-weight: 700;">${analysis.score}%</div>
            <div style="font-size: 12px; margin-top: 4px; opacity: 0.9;">${scoreLevel.label}</div>
          </div>
        </div>
        
        ${analysis.highlights.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px; font-size: 14px;">✨ Key Highlights</div>
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px;">
              ${analysis.highlights.map(h => `<div style="color: #2563eb; margin-bottom: 6px; font-size: 13px;">• ${h}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        
        ${analysis.redFlags && analysis.redFlags.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 600; color: #1e293b; margin-bottom: 8px; font-size: 14px;">⚠️ Areas for Improvement</div>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px;">
              ${analysis.redFlags.map(flag => `<div style="color: #dc2626; margin-bottom: 6px; font-size: 13px;">• ${flag}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        
        <div style="font-size: 11px; color: #64748b; text-align: center; padding-top: 12px; border-top: 1px solid #e2e8f0;">
          AI-powered analysis • Always verify independently
        </div>
      `;
    }
  }

  function generateDetailedHTML(analysis, fullText = null) {
    if (analysis.type === 'job_listing') {
      return `
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <div style="font-size: 32px; margin-right: 14px;">💼</div>
          <div>
            <div style="font-weight: 800; font-size: 22px; color: #1e293b;">Job Analysis</div>
            <div style="font-size: 13px; color: #64748b;">Complete AI Evaluation</div>
          </div>
        </div>
        
        <div style="background: linear-gradient(135deg, ${analysis.trustScore >= 75 ? '#22c55e' : analysis.trustScore >= 50 ? '#eab308' : '#ef4444'} 0%, ${analysis.trustScore >= 75 ? '#16a34a' : analysis.trustScore >= 50 ? '#ca8a04' : '#dc2626'} 100%); border-radius: 16px; padding: 24px; margin-bottom: 20px; text-align: center;">
          <div style="color: white; font-size: 16px; margin-bottom: 12px; opacity: 0.95; font-weight: 600;">Trust Score</div>
          <div style="color: white; font-size: 52px; font-weight: 900; line-height: 1;">${analysis.trustScore}%</div>
          <div style="color: white; font-size: 14px; margin-top: 10px; opacity: 0.9;">${getTrustLabel(analysis.trustScore)}</div>
        </div>
        
        ${analysis.positives && analysis.positives.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 700; color: #1e293b; margin-bottom: 10px; font-size: 15px;">✅ Positive Indicators</div>
            <div style="background: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 14px;">
              ${analysis.positives.map(pos => `<div style="color: #166534; margin-bottom: 6px; font-size: 13px; line-height: 1.5;">${pos}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        
        ${analysis.flags.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 700; color: #1e293b; margin-bottom: 10px; font-size: 15px;">🚨 Risk Factors (${analysis.flags.length})</div>
            <div style="background: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 14px; max-height: 250px; overflow-y: auto;">
              ${analysis.flags.map(flag => `<div style="color: #dc2626; margin-bottom: 8px; font-size: 13px; line-height: 1.5;">${flag}</div>`).join('')}
            </div>
          </div>
        ` : `
          <div style="background: #f0fdf4; border: 2px solid #bbf7d0; border-radius: 12px; padding: 16px; font-size: 14px; color: #166534; margin-bottom: 16px; text-align: center; font-weight: 600;">
            ✓ No major risk factors detected
          </div>
        `}
        
        <div style="font-size: 11px; color: #64748b; text-align: center; padding-top: 14px; border-top: 2px solid #e2e8f0; line-height: 1.6;">
          <strong>AI-powered analysis</strong><br>Always verify independently before applying
        </div>
      `;
    } else if (analysis.type === 'resume') {
      return `
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <div style="font-size: 32px; margin-right: 14px;">📄</div>
          <div>
            <div style="font-weight: 800; font-size: 22px; color: #1e293b;">Resume Analysis</div>
            <div style="font-size: 13px; color: #64748b;">Complete Profile Evaluation</div>
          </div>
        </div>
        
        <div style="background: linear-gradient(135deg, ${analysis.score >= 75 ? '#3b82f6' : analysis.score >= 50 ? '#8b5cf6' : '#6b7280'} 0%, ${analysis.score >= 75 ? '#2563eb' : analysis.score >= 50 ? '#7c3aed' : '#4b5563'} 100%); border-radius: 16px; padding: 24px; margin-bottom: 20px; text-align: center;">
          <div style="color: white; font-size: 16px; margin-bottom: 12px; opacity: 0.95; font-weight: 600;">Profile Strength</div>
          <div style="color: white; font-size: 52px; font-weight: 900; line-height: 1;">${analysis.score}%</div>
          <div style="color: white; font-size: 14px; margin-top: 10px; opacity: 0.9;">${getScoreLabel(analysis.score)}</div>
        </div>
        
        ${analysis.highlights.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 700; color: #1e293b; margin-bottom: 10px; font-size: 15px;">✨ Key Highlights</div>
            <div style="background: #eff6ff; border: 2px solid #bfdbfe; border-radius: 12px; padding: 14px;">
              ${analysis.highlights.map(h => `<div style="color: #1e40af; margin-bottom: 6px; font-size: 13px; line-height: 1.5;">${h}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        
        ${analysis.redFlags && analysis.redFlags.length > 0 ? `
          <div style="margin-bottom: 16px;">
            <div style="font-weight: 700; color: #1e293b; margin-bottom: 10px; font-size: 15px;">⚠️ Areas for Improvement (${analysis.redFlags.length})</div>
            <div style="background: #fef2f2; border: 2px solid #fecaca; border-radius: 12px; padding: 14px; max-height: 250px; overflow-y: auto;">
              ${analysis.redFlags.map(flag => `<div style="color: #dc2626; margin-bottom: 8px; font-size: 13px; line-height: 1.5;">${flag}</div>`).join('')}
            </div>
          </div>
        ` : ''}
        
        <div style="font-size: 11px; color: #64748b; text-align: center; padding-top: 14px; border-top: 2px solid #e2e8f0; line-height: 1.6;">
          <strong>AI-powered analysis</strong><br>Use as guidance for improvement
        </div>
      `;
    }
  }

  function getTrustLabel(score) {
    if (score >= 80) return 'Highly Trusted';
    if (score >= 60) return 'Moderately Trusted';
    if (score >= 40) return 'Low Trust - Caution Advised';
    return 'High Risk - Avoid';
  }

  function analyzeFullPage() {
    const elements = document.querySelectorAll('p, div[class*="job"], div[class*="resume"], article, section');
    let analyzed = 0;

    elements.forEach(el => {
      const text = getElementText(el);
      if (text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          el.style.outline = '2px solid #667eea';
          el.style.outlineOffset = '2px';
          analyzed++;
          
          setTimeout(() => {
            el.style.outline = '';
          }, 3000);
        }
      }
    });

  function getScoreColor(score) {
    if (score >= 75) return '#22c55e';
    if (score >= 55) return '#3b82f6';
    if (score >= 35) return '#eab308';
    return '#ef4444';
  }

  // ==================== NOTIFICATIONS ====================

  function showNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      z-index: 99999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      border-left: 4px solid #667eea;
      animation: slideIn 0.3s ease-out;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => {
      notif.style.transition = 'opacity 0.3s, transform 0.3s';
      notif.style.opacity = '0';
      notif.style.transform = 'translateX(20px)';
      setTimeout(() => notif.remove(), 300);
    }, 3000);
  }

  function showBatchNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 24px;
      box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 600;
      animation: slideUp 0.3s ease-out;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => {
      notif.style.transition = 'opacity 0.3s, transform 0.3s';
      notif.style.opacity = '0';
      notif.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(() => notif.remove(), 300);
    }, 4000);
  }

})();