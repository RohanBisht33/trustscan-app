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
  let pdfJsLoaded = false;

  // Initialize
  init();

  function init() {
    browser.storage.local.get(['extensionEnabled'], function(result) {
      isEnabled = result.extensionEnabled !== false;
      if (isEnabled) {
        console.log('🚀 AI Job & Resume Analyzer: Active');
        createTooltip();
        attachListeners();
        detectJobListings();
        setupPDFSupport();
      }
    });
  }

  // Listen for messages
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

  // ==================== PDF SUPPORT ====================
  
  async function setupPDFSupport() {
    // Load PDF.js library
    if (!pdfJsLoaded) {
      await loadPDFJs();
    }

    // Check if current page is PDF
    if (isPDFPage()) {
      await analyzePDFPage();
    }

    // Monitor PDF links
    monitorPDFLinks();
    
    // Monitor file uploads
    monitorFileUploads();
  }

  function isPDFPage() {
    return document.contentType === 'application/pdf' || 
           window.location.href.toLowerCase().endsWith('.pdf') ||
           document.querySelector('embed[type="application/pdf"]') !== null;
  }

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

      return fullText.trim();
    } catch (error) {
      console.error('PDF blob extraction error:', error);
      return null;
    }
  }

  async function analyzePDFPage() {
    try {
      console.log('📄 Analyzing PDF page...');
      const text = await extractTextFromPDF(window.location.href);
      
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

  function monitorPDFLinks() {
    document.addEventListener('click', async (e) => {
      const target = e.target.closest('a');
      if (target && target.href && target.href.toLowerCase().endsWith('.pdf')) {
        e.preventDefault();
        
        showLoadingNotification('📄 Analyzing PDF...');
        
        try {
          const text = await extractTextFromPDF(target.href);
          if (text) {
            const analysis = performAnalysis(text);
            if (analysis.type !== 'unknown') {
              showPDFAnalysisModal(analysis, text, target.href);
            } else {
              showNotification('❌ Could not analyze PDF content');
            }
          }
        } catch (error) {
          showNotification('❌ Failed to load PDF');
        }
        
        // Allow opening in new tab after 1 second
        setTimeout(() => {
          window.open(target.href, '_blank');
        }, 1000);
      }
    });
  }

  function monitorFileUploads() {
    // Monitor existing file inputs
    document.querySelectorAll('input[type="file"]').forEach(attachFileHandler);

    // Monitor new file inputs
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            if (node.matches && node.matches('input[type="file"]')) {
              attachFileHandler(node);
            }
            node.querySelectorAll && node.querySelectorAll('input[type="file"]').forEach(attachFileHandler);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function attachFileHandler(input) {
    if (input.dataset.aiAnalyzerAttached) return;
    input.dataset.aiAnalyzerAttached = 'true';

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
    let resumeScore = 0;
    let jobScore = 0;

    // Strong resume indicators (weight: 3)
    const strongResumeIndicators = [
      /\b(resume|curriculum vitae|cv)\b/i,
      /\b(objective|career objective|professional summary)\b/i,
      /\beducation\s*(history|background)?:/i,
      /\bwork experience:/i,
      /\bprofessional experience:/i,
      /\bcertifications?:/i,
      /\bprojects?:/i,
      /\b(b\.?tech|m\.?tech|bachelor|master|phd|mba)\b/i,
      /\b(cgpa|gpa|percentage|marks)\b/i,
      /linkedin\.com\/in\//i,
      /github\.com\/[a-z]/i
    ];

    // Medium resume indicators (weight: 2)
    const mediumResumeIndicators = [
      /\b(skills?|technical skills?|core competencies)\b/i,
      /\b(languages?|programming)\b/i,
      /\b(achievements?|accomplishments?)\b/i,
      /\b(references?|hobbies|interests)\b/i,
      /\b\d+\s*years?\s*(of\s*)?experience\b/i,
      /\b(intern|internship|co-op)\b/i
    ];

    // Weak resume indicators (weight: 1)
    const weakResumeIndicators = [
      /\b(email|phone|mobile|contact)\s*:/i,
      /\b[a-z]+@[a-z]+\.[a-z]+\b/i,
      /\b\+?\d{10,}\b/
    ];

    // Strong job indicators (weight: 3)
    const strongJobIndicators = [
      /\b(job description|job opening|position|vacancy|role)\b/i,
      /\b(we are hiring|looking for|seeking|wanted)\b/i,
      /\b(apply now|apply here|submit application)\b/i,
      /\b(requirements?|qualifications?|eligibility)\b/i,
      /\b(responsibilities|duties|what you('ll| will) do)\b/i,
      /\b(salary|compensation|ctc|package|benefits?)\b/i,
      /\b(join our team|work with us)\b/i,
      /\b(full[- ]?time|part[- ]?time|contract|freelance|remote)\b/i
    ];

    // Medium job indicators (weight: 2)
    const mediumJobIndicators = [
      /\b(company|organization|firm|startup)\b/i,
      /\b(location|office|workplace|work from home|wfh)\b/i,
      /\b(deadline|last date|apply by)\b/i,
      /\b(experience required|years of experience)\b/i,
      /\b(skills? required|must have|should have)\b/i
    ];

    // Count indicators
    strongResumeIndicators.forEach(pattern => {
      if (pattern.test(text)) resumeScore += 3;
    });
    mediumResumeIndicators.forEach(pattern => {
      if (pattern.test(text)) resumeScore += 2;
    });
    weakResumeIndicators.forEach(pattern => {
      if (pattern.test(text)) resumeScore += 1;
    });

    strongJobIndicators.forEach(pattern => {
      if (pattern.test(text)) jobScore += 3;
    });
    mediumJobIndicators.forEach(pattern => {
      if (pattern.test(text)) jobScore += 2;
    });

    // Additional context checks
    if (/\b(dear|hi|hello)\s+(sir|madam|hiring manager|recruiter)/i.test(text)) {
      resumeScore += 2; // Cover letter
    }

    if (/\b(posted|published)\s+\d+\s+(day|hour|week)s?\s+ago/i.test(text)) {
      jobScore += 2;
    }

    console.log(`🔍 Detection scores - Resume: ${resumeScore}, Job: ${jobScore}`);

    // Determine type with threshold
    if (resumeScore >= 6 && resumeScore > jobScore) return 'resume';
    if (jobScore >= 6 && jobScore > resumeScore) return 'job_listing';
    if (resumeScore > jobScore && resumeScore >= 4) return 'resume';
    if (jobScore > resumeScore && jobScore >= 4) return 'job_listing';
    
    return 'unknown';
  }

  // ==================== IMPROVED JOB SCORING ====================

  function analyzeJob(text) {
    const lower = text.toLowerCase();
    let score = 85; // Start with neutral-positive score
    const flags = [];
    const positives = [];

    console.log('💼 Analyzing job listing...');

    // CRITICAL RED FLAGS (Very High Weight)
    const criticalFlags = [
      { pattern: /\b(aadhaar|aadhar|pan card|passport|id card|voter id|bank passbook|account details)\b/i, 
        flag: '🚨 Asks for sensitive ID/financial documents', weight: 40 },
      { pattern: /\b(registration fee|joining fee|security deposit|advance payment|pay.*fee)\b/i, 
        flag: '🚨 Demands payment/fees upfront', weight: 40 },
      { pattern: /\b(money transfer|payment processing agent|fund transfer|bitcoin|cryptocurrency)\b/i, 
        flag: '🚨 Suspicious money handling role', weight: 35 }
    ];

    // HIGH RED FLAGS
    const highFlags = [
      { pattern: /\b(no experience|no qualification|anyone can apply|no skills required)\b/i, 
        flag: '⚠️ No experience needed (common scam)', weight: 20 },
      { pattern: /\b(whatsapp|telegram|instagram dm|facebook message)\b.*\b(apply|contact|join)\b/i, 
        flag: '⚠️ Unofficial communication channel', weight: 25 },
      { pattern: /\b(google form|form\.google|typeform).*\b(apply|submit)\b/i, 
        flag: '⚠️ Non-professional application method', weight: 20 },
      { pattern: /\b(earn|make|get paid)\s*₹?\s*\d{4,}.*\b(daily|per day|everyday)\b/i, 
        flag: '⚠️ Unrealistic daily earning claims', weight: 25 },
      { pattern: /\b(training.*paid|get paid.*training|earn while.*learn)\b/i, 
        flag: '⚠️ Suspicious training payment model', weight: 20 }
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

    // Company verification
    const hasLegitCompany = /\b(pvt\.?\s*ltd|private limited|inc\.|incorporated|corporation|llp|technologies|solutions|systems|software)\b/i.test(text);
    const hasVagueCompany = /\b(global|international|world|universal|best|top|leading)\b.*\b(company|firm|organization)\b/i.test(text) && !hasLegitCompany;
    
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

    // Application process check
    const hasProperProcess = /@\w+\.(com|in|co|org)|careers\.|apply\..*\.(com|in)|linkedin\.com\/jobs|naukri\.com|indeed\.com/i.test(text);
    const hasUnprofessionalProcess = /\b(whatsapp|telegram|dm|message me|contact.*\d{10})\b/i.test(lower);
    
    if (hasProperProcess) {
      positives.push('✅ Professional application channel');
      score += 5;
    } else if (hasUnprofessionalProcess) {
      flags.push('⚠️ Unprofessional application method');
      score -= 15;
    }

    // Salary reasonableness
    const salaryMatch = text.match(/₹\s*(\d+)[,\d]*\s*(?:per month|\/month|pm|monthly)/i) ||
                       text.match(/(\d+)\s*(?:lpa|lakhs? per annum)/i);
    
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

    // Job description quality
    const hasDetailedDesc = text.length > 300 && /\b(responsibilities|requirements|qualifications|what you('ll| will) do)\b/i.test(text);
    if (hasDetailedDesc) {
      positives.push('✅ Detailed job description');
      score += 5;
    } else if (text.length < 150) {
      flags.push('⚠️ Very brief job posting');
      score -= 8;
    }

    // Self-aware red flags
    if (/\b(red flag|warning|scam|fake|fraud|beware)\b/i.test(text)) {
      flags.push('🚨 Contains warning/scam keywords');
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

    console.log('📄 Analyzing resume...');

    // Technical skills detection
    const techSkills = [
      'python', 'javascript', 'java', 'c++', 'c#', 'ruby', 'php', 'swift', 'kotlin', 'go',
      'react', 'angular', 'vue', 'node', 'express', 'django', 'flask', 'spring', 'laravel',
      'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'oracle',
      'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins', 'git',
      'machine learning', 'deep learning', 'ai', 'data science', 'nlp', 'computer vision',
      'html', 'css', 'typescript', 'sass', 'webpack', 'rest api', 'graphql'
    ];
    
    const foundSkills = techSkills.filter(skill => 
      new RegExp(`\\b${skill.replace(/\+/g, '\\+')}\\b`, 'i').test(text)
    );
    
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

    // Experience detection
    const expPatterns = [
      /(\d+)[\s\+]*years?\s+(?:of\s+)?experience/i,
      /experience[:\s]+(\d+)[\s\+]*years?/i,
      /(\d+)[\s\+]*yrs?\s+exp/i
    ];
    
    let years = null;
    for (const pattern of expPatterns) {
      const match = text.match(pattern);
      if (match) {
        years = parseInt(match[1]);
        break;
      }
    }

    if (years !== null) {
      highlights.push(`⏱️ ${years}+ years of experience`);
      
      if (years <= 2) score += 10;
      else if (years <= 5) score += 18;
      else if (years <= 10) score += 25;
      else if (years <= 20) score += 20;
      else {
        redFlags.push('⚠️ Very long experience (verify dates)');
        score += 5;
      }

      console.log(`  ✅ ${years} years experience`);

      // Experience vs skills mismatch
      if (years < 2 && foundSkills.length > 15) {
        redFlags.push('⚠️ Too many skills for experience level');
        score -= 18;
        console.log('  ⚠️  Skill-experience mismatch (-18)');
      }
      if (years > 5 && foundSkills.length < 5) {
        redFlags.push('⚠️ Few skills for experience level');
        score -= 10;
      }
    } else {
      redFlags.push('❌ No clear experience timeline');
      score -= 12;
      console.log('  ❌ No experience (-12)');
    }

    // Education detection
    const educationPatterns = [
      /\b(b\.?tech|bachelor of technology)\b/i,
      /\b(m\.?tech|master of technology)\b/i,
      /\b(b\.?e\.?|bachelor of engineering)\b/i,
      /\b(m\.?e\.?|master of engineering)\b/i,
      /\b(bsc|b\.sc|bachelor of science)\b/i,
      /\b(msc|m\.sc|master of science)\b/i,
      /\b(bca|bachelor of computer applications)\b/i,
      /\b(mca|master of computer applications)\b/i,
      /\b(mba|master of business administration)\b/i,
      /\b(phd|ph\.d|doctorate)\b/i
    ];

    const educationFound = educationPatterns.some(pattern => pattern.test(text));
    
    if (educationFound) {
      highlights.push('🎓 Technical degree mentioned');
      score += 12;
      console.log('  ✅ Education found (+12)');
    } else {
      redFlags.push('❌ No formal education credentials');
      score -= 15;
      console.log('  ❌ No education (-15)');
    }

    // Unrealistic claims detection
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

    // Action verbs and achievements
    const actionVerbs = ['developed', 'built', 'created', 'designed', 'implemented', 'led', 'managed', 'delivered', 'architected', 'optimized', 'improved', 'reduced', 'increased'];
    const hasActionVerbs = actionVerbs.some(verb => new RegExp(`\\b${verb}\\b`, 'i').test(text));
    const onlyBuzzwords = /\b(hard[\s-]?working|team player|fast learner|motivated|dedicated)\b/i.test(text) && !hasActionVerbs;
    
    if (hasActionVerbs) {
      highlights.push('✅ Contains specific achievements');
      score += 10;
      console.log('  ✅ Action verbs found (+10)');
    } else if (onlyBuzzwords) {
      redFlags.push('⚠️ Only generic buzzwords, no specifics');
      score -= 12;
      console.log('  ⚠️  Only buzzwords (-12)');
    }

    // Projects and portfolio
    const hasProjects = /\b(project|portfolio|github|gitlab|bitbucket|built|developed)\b/i.test(text);
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

    // Timeline and dates
    const hasDates = /\b(20\d{2}|19\d{2})\b/.test(text) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(text);
    if (hasDates) {
      highlights.push('✅ Timeline with dates');
      score += 8;
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

    // Resume length check
    if (text.length < 300) {
      redFlags.push('⚠️ Resume appears too short/incomplete');
      score -= 15;
      console.log('  ⚠️  Too short (-15)');
    } else if (text.length > 2000) {
      highlights.push('✅ Comprehensive resume');
      score += 5;
    }

    // Spelling/grammar check
    const commonMistakes = /\b(experiance|exprience|experince|skillz|companey|projcts|recieved|occured)\b/i;
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

  // ==================== JOB LISTING DETECTION ====================

  function detectJobListings() {
    const site = getCurrentSite();
    if (!site) return;

    const selectors = SITE_SELECTORS[site];
    const cards = document.querySelectorAll(selectors.jobCard);
    
    let analyzed = 0;
    cards.forEach((card, index) => {
      const text = extractJobCardText(card, selectors);
      if (text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type === 'job_listing') {
          addJobIndicator(card, analysis, index);
          analyzed++;
        }
      }
    });

    if (analyzed > 0) {
      showBatchNotification(`✅ Analyzed ${analyzed} job listings`);
    }
  }

  const SITE_SELECTORS = {
    'linkedin.com': {
      jobCard: '.job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item',
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
      jobCard: '.jobTuple, .srp-jobtuple-wrapper',
      title: '.title, .jobTuple-title',
      company: '.companyInfo, .subTitle',
      description: '.job-description'
    },
    'indeed.com': {
      jobCard: '.job_seen_beacon, .jobsearch-SerpJobCard',
      title: '.jobTitle, .jcs-JobTitle',
      company: '.companyName',
      description: '.job-snippet'
    }
  };

  function getCurrentSite() {
    const hostname = window.location.hostname;
    for (const site in SITE_SELECTORS) {
      if (hostname.includes(site)) {
        return site;
      }
    }
    return null;
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
      
      if (!text.trim()) {
        text = card.textContent;
      }
    } catch (e) {
      text = card.textContent;
    }
    return text.trim();
  }

  function addJobIndicator(card, analysis, index) {
    const existing = card.querySelector('.ai-job-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.className = 'ai-job-indicator';
    const color = getTrustColor(analysis.trustScore);
    
    indicator.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      min-width: 36px;
      height: 36px;
      border-radius: 18px;
      background: ${color};
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      padding: 0 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 10000;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transition: all 0.2s;
    `;
    indicator.textContent = `${analysis.trustScore}%`;
    indicator.title = 'Click for detailed analysis';

    if (getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }

    indicator.addEventListener('mouseenter', () => {
      indicator.style.transform = 'scale(1.1)';
    });
    
    indicator.addEventListener('mouseleave', () => {
      indicator.style.transform = 'scale(1)';
    });

    indicator.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const rect = indicator.getBoundingClientRect();
      showDetailedAnalysis(analysis, rect.left + rect.width/2, rect.bottom + 10);
    });

    card.appendChild(indicator);
  }

  function getTrustColor(score) {
    if (score >= 75) return '#22c55e';
    if (score >= 50) return '#eab308';
    return '#ef4444';
  }

  function clearJobIndicators() {
    document.querySelectorAll('.ai-job-indicator').forEach(el => el.remove());
  }

  // ==================== ANALYSIS FUNCTIONS ====================

  function performAnalysis(text) {
    const cacheKey = text.substring(0, 200);
    if (analysisCache.has(cacheKey)) {
      return analysisCache.get(cacheKey);
    }

    const type = detectType(text);
    let analysis;
    
    if (type === 'job_listing') {
      analysis = analyzeJob(text);
    } else if (type === 'resume') {
      analysis = analyzeResume(text);
    } else {
      analysis = { type: 'unknown' };
    }
    
    analysisCache.set(cacheKey, analysis);
    return analysis;
  }

  // ==================== TOOLTIP SYSTEM ====================

  function createTooltip() {
    if (tooltip) return;

    tooltip = document.createElement('div');
    tooltip.id = 'ai-analyzer-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 99999999;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
      padding: 20px;
      min-width: 320px;
      max-width: 450px;
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      color: #1e293b;
      border: 2px solid #e2e8f0;
    `;
    document.body.appendChild(tooltip);
  }

  function showDetailedAnalysis(analysis, x, y) {
    if (!tooltip) createTooltip();
    
    tooltip.innerHTML = generateDetailedHTML(analysis);
    tooltip.style.display = 'block';
    
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = x - tooltipRect.width / 2;
    let top = y + 5;

    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }
    if (top + tooltipRect.height > window.innerHeight - 10) {
      top = y - tooltipRect.height - 45;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    setTimeout(() => {
      const closeHandler = (e) => {
        if (!tooltip.contains(e.target) && !e.target.classList.contains('ai-job-indicator')) {
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

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  // ==================== EVENT LISTENERS ====================

  function attachListeners() {
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
  }

  function removeListeners() {
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
  }

  let hoverTimeout;
  function handleMouseOver(e) {
    if (!isEnabled) return;

    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      const element = e.target;
      
      if (element.classList.contains('ai-job-indicator')) return;
      
      const text = getElementText(element);
      
      if (text.length > 100) {
        analyzeText(text, e.clientX, e.clientY);
      }
    }, 400);
  }

  function handleMouseOut() {
    clearTimeout(hoverTimeout);
  }

  function getElementText(element) {
    let text = '';
    
    if (element.tagName === 'P' || element.tagName === 'DIV' || 
        element.tagName === 'SECTION' || element.tagName === 'ARTICLE' ||
        element.tagName === 'SPAN') {
      text = element.innerText || element.textContent;
    }
    
    return text.trim().substring(0, 3000);
  }

  function analyzeText(text, x, y) {
    const analysis = performAnalysis(text);
    
    if (analysis.type === 'unknown') return;

    const tooltipContent = generateTooltipHTML(analysis);
    showTooltip(x, y, tooltipContent);
  }

  // ==================== HTML GENERATION ====================

  function generateTooltipHTML(analysis) {
    if (analysis.type === 'job_listing') {
      return `
        <div style="display: flex; align-items: center; margin-bottom: 12px;">
          <div style="font-size: 22px; margin-right: 10px;">💼</div>
          <div>
            <div style="font-weight: 700; color: #1e293b; font-size: 16px;">Job Listing</div>
            <div style="font-size: 11px; color: #64748b;">AI Analysis</div>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <span style="font-size: 13px; color: #64748b; font-weight: 500;">Trust Score</span>
          <span style="font-size: 24px; font-weight: 800; color: ${getTrustColor(analysis.trustScore)};">
            ${analysis.trustScore}%
          </span>
        </div>
        
        <div style="background: #f1f5f9; border-radius: 8px; height: 8px; overflow: hidden; margin-bottom: 14px;">
          <div style="background: ${getTrustColor(analysis.trustScore)}; height: 100%; width: ${analysis.trustScore}%; transition: width 0.3s;"></div>
        </div>
        
        ${analysis.flags.length > 0 ? `
          <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 10px; padding: 12px; font-size: 12px; margin-bottom: 8px;">
            <div style="font-weight: 700; color: #991b1b; margin-bottom: 8px; font-size: 13px;">⚠️ Risk Factors (${analysis.flags.length})</div>
            ${analysis.flags.slice(0, 4).map(flag => `<div style="color: #dc2626; margin-bottom: 4px; line-height: 1.4;">• ${flag}</div>`).join('')}
            ${analysis.flags.length > 4 ? `<div style="color: #dc2626; margin-top: 4px; font-style: italic;">+ ${analysis.flags.length - 4} more issues</div>` : ''}
          </div>
        ` : `
          <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 10px; padding: 12px; font-size: 12px; color: #166534; margin-bottom: 8px;">
            <strong>✓ No major risk factors detected</strong>
          </div>
        `}
        
        ${analysis.positives && analysis.positives.length > 0 ? `
          <div style="font-size: 11px; color: #22c55e; margin-top: 8px;">
            ${analysis.positives.slice(0, 2).join(' • ')}
          </div>
        ` : ''}
        
        <div style="font-size: 10px; color: #94a3b8; text-align: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0;">
          Click job badge for full details
        </div>
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
          <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 10px; padding: 12px; font-size: 12px;">
            <div style="font-weight: 700; color: #991b1b; margin-bottom: 8px; font-size: 13px;">⚠️ Red Flags (${analysis.redFlags.length})</div>
            ${analysis.redFlags.slice(0, 3).map(flag => `<div style="color: #dc2626; margin-bottom: 4px; line-height: 1.4;">${flag}</div>`).join('')}
            ${analysis.redFlags.length > 3 ? `<div style="color: #dc2626; margin-top: 4px; font-style: italic;">+ ${analysis.redFlags.length - 3} more</div>` : ''}
          </div>
        ` : ''}
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

  function getScoreLabel(score) {
    if (score >= 75) return 'Strong Profile';
    if (score >= 55) return 'Good Profile';
    if (score >= 35) return 'Needs Improvement';
    return 'Weak Profile';
  }

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
      animation: slideInRight 0.3s ease-out;
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

  function showLoadingNotification(message) {
    const notif = document.createElement('div');
    notif.id = 'ai-loading-notif';
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
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    
    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 20px;
      height: 20px;
      border: 3px solid #e2e8f0;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    `;
    
    notif.appendChild(spinner);
    notif.appendChild(document.createTextNode(message));
    
    const existing = document.getElementById('ai-loading-notif');
    if (existing) existing.remove();
    
    document.body.appendChild(notif);
  }

  function showBatchNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 14px 28px;
      border-radius: 28px;
      box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
      z-index: 99999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 700;
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

  function analyzeFullPage() {
    const elements = document.querySelectorAll('p, div, article, section');
    let analyzed = 0;

    elements.forEach(el => {
      const text = getElementText(el);
      if (text.length > 150) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          el.style.outline = '3px solid #667eea';
          el.style.outlineOffset = '3px';
          analyzed++;
          
          setTimeout(() => {
            el.style.outline = '';
          }, 3000);
        }
      }
    });

    if (analyzed > 0) {
      showNotification(`✅ Found ${analyzed} items on this page`);
    } else {
      showNotification('ℹ️ No job listings or resumes detected');
    }
  }

})();