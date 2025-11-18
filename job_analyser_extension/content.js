// ==================== IMPROVED TYPE DETECTION ====================
// This replaces the detectType() function in content.js

function detectType(text) {
  const lower = text.toLowerCase();
  let resumeScore = 0;
  let jobScore = 0;

  // CRITICAL: Check for mutually exclusive indicators first
  
  // STRONG JOB-ONLY INDICATORS (These almost never appear in resumes)
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

  // STRONG RESUME-ONLY INDICATORS (These almost never appear in job postings)
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

  // Count job-only indicators
  jobOnlyIndicators.forEach(pattern => {
    if (pattern.test(text)) {
      jobScore += 10; // Heavy weight for exclusive indicators
      console.log(`  ðŸ'¼ Job-only match: ${pattern}`);
    }
  });

  // Count resume-only indicators
  resumeOnlyIndicators.forEach(pattern => {
    if (pattern.test(text)) {
      resumeScore += 10; // Heavy weight for exclusive indicators
      console.log(`  ðŸ"„ Resume-only match: ${pattern}`);
    }
  });

  // If we have strong exclusive indicators, make early decision
  if (jobScore >= 20 && resumeScore === 0) {
    console.log(`ðŸ" Early detection: Job (exclusive indicators)`);
    return 'job_listing';
  }
  if (resumeScore >= 20 && jobScore === 0) {
    console.log(`ðŸ" Early detection: Resume (exclusive indicators)`);
    return 'resume';
  }

  // CONTEXTUAL INDICATORS (can appear in both, but context matters)
  
  // Job-leaning contextual indicators
  const jobContextual = [
    { pattern: /\b(requirements?|qualifications?|eligibility)\s*:/i, weight: 3 },
    { pattern: /\b(responsibilities|duties|role description)\s*:/i, weight: 3 },
    { pattern: /\b(must have|should have|required)\s*:/i, weight: 2 },
    { pattern: /\b(preferred|nice to have|bonus)\s*:/i, weight: 2 },
    { pattern: /\b(\d+[\+\-]\s*years? of experience (required|needed))\b/i, weight: 3 },
    { pattern: /\b(full[\s-]?time|part[\s-]?time|contract|freelance|remote|hybrid)\s+(position|role|job)/i, weight: 3 },
    { pattern: /\b(competitive salary|market rate compensation)\b/i, weight: 2 },
    { pattern: /\b(location|office|workplace)\s*:/i, weight: 1 }
  ];

  // Resume-leaning contextual indicators
  const resumeContextual = [
    { pattern: /\b(work experience|professional experience|employment history)\s*:/i, weight: 3 },
    { pattern: /\b(education|academic background|qualifications)\s*:/i, weight: 3 },
    { pattern: /\b(skills?|technical skills?|core competencies)\s*:/i, weight: 2 },
    { pattern: /\b(projects?|portfolio|work samples)\s*:/i, weight: 2 },
    { pattern: /\b(certifications?|training|courses)\s*:/i, weight: 2 },
    { pattern: /\b(achievements?|accomplishments?|awards)\s*:/i, weight: 2 },
    { pattern: /\b(intern(ship)?|trainee|co-op) at \w+/i, weight: 2 },
    { pattern: /\b(b\.?tech|m\.?tech|bachelor|master|phd|mba|bca|mca)\b/i, weight: 2 }
  ];

  // Count contextual indicators
  jobContextual.forEach(({ pattern, weight }) => {
    if (pattern.test(text)) {
      jobScore += weight;
    }
  });

  resumeContextual.forEach(({ pattern, weight }) => {
    if (pattern.test(text)) {
      resumeScore += weight;
    }
  });

  // STRUCTURAL ANALYSIS
  
  // Job postings often have company descriptions
  if (/\b(about (us|the company|our company)|company overview|who we are)\b/i.test(text)) {
    jobScore += 3;
  }

  // Resumes have contact details in specific format
  if (/@\w+\.\w+/.test(text) && /\b(\+?\d{10,})\b/.test(text) && text.length < 2000) {
    resumeScore += 3;
  }

  // Job postings often mention "candidate" or "you"
  const candidateMentions = (text.match(/\b(candidate|applicant|you will|you would|you should|your role)\b/gi) || []).length;
  if (candidateMentions >= 3) {
    jobScore += 2;
  }

  // Resumes use first-person more
  const firstPersonMentions = (text.match(/\b(i |my |me |i'm |i've |i'll )\b/gi) || []).length;
  if (firstPersonMentions >= 5) {
    resumeScore += 3;
  }

  // ANTI-CONFUSION MEASURES
  
  // If text has "job description" in title but also has resume indicators
  if (/\b(job description|job posting|job ad)\b/i.test(text)) {
    if (resumeScore > 0) {
      console.log(`  âš ï¸ Contains "job description" but has resume indicators - penalizing resume score`);
      resumeScore = Math.max(0, resumeScore - 8);
    }
    jobScore += 5;
  }

  // If text has "resume" or "CV" in title
  if (/\b(resume|curriculum vitae|cv)\b/i.test(text.substring(0, 200))) {
    resumeScore += 5;
  }

  // Check for timeline patterns (more common in resumes)
  const timelinePatterns = text.match(/\b(20\d{2}|19\d{2})\s*[-–]\s*(20\d{2}|19\d{2}|present|current)\b/gi);
  if (timelinePatterns && timelinePatterns.length >= 2) {
    resumeScore += 3;
  }

  // LENGTH-BASED HEURISTICS
  
  // Very short texts are likely neither
  if (text.length < 150) {
    console.log(`ðŸ" Too short (${text.length} chars) - unknown`);
    return 'unknown';
  }

  // Job postings are usually 500-3000 chars
  // Resumes are usually 1000-5000 chars
  if (text.length > 3000 && resumeScore > jobScore) {
    resumeScore += 2; // Bonus for longer resume
  }

  console.log(`ðŸ" Detection scores - Resume: ${resumeScore}, Job: ${jobScore}`);

  // FINAL DECISION with higher thresholds
  const scoreDiff = Math.abs(resumeScore - jobScore);
  const minDiff = 5; // Require significant difference

  if (resumeScore >= 12 && resumeScore > jobScore && scoreDiff >= minDiff) {
    return 'resume';
  }
  if (jobScore >= 12 && jobScore > resumeScore && scoreDiff >= minDiff) {
    return 'job_listing';
  }
  
  // If scores are too close or too low, return unknown
  if (scoreDiff < minDiff || (resumeScore < 10 && jobScore < 10)) {
    console.log(`ðŸ" Unclear - scores too close or too low`);
    return 'unknown';
  }

  // Fallback to higher score
  if (resumeScore > jobScore) return 'resume';
  if (jobScore > resumeScore) return 'job_listing';
  
  return 'unknown';
}

// ==================== IMPROVED PDF SUPPORT ====================
// Replace setupPDFSupport() and related functions

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
  if (pdfJsLoaded) return;
  
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.pdfjsLib) {
      pdfJsLoaded = true;
      resolve();
      return;
    }

    // Create script with timeout
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    
    const timeout = setTimeout(() => {
      console.error('PDF.js loading timeout');
      reject(new Error('PDF.js loading timeout'));
    }, 10000); // 10 second timeout

    script.onload = () => {
      clearTimeout(timeout);
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        pdfJsLoaded = true;
        console.log('âœ… PDF.js loaded successfully');
        resolve();
      } else {
        reject(new Error('PDF.js failed to initialize'));
      }
    };
    
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load PDF.js script'));
    };
    
    document.head.appendChild(script);
  });
}

async function extractTextFromPDF(pdfUrl) {
  try {
    await loadPDFJsSafe();

    const loadingTask = window.pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: false // Avoid CORS issues
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';

    // Limit to first 10 pages for performance
    const maxPages = Math.min(pdf.numPages, 10);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => item.str)
        .filter(str => str.trim().length > 0)
        .join(' ');
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
    await loadPDFJsSafe();

    // Validate blob
    if (!blob || blob.type !== 'application/pdf') {
      throw new Error('Invalid PDF blob');
    }

    const arrayBuffer = await blob.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ 
      data: arrayBuffer,
      verbosity: 0 // Suppress console warnings
    });
    
    const pdf = await loadingTask.promise;
    let fullText = '';

    // Limit to first 10 pages
    const maxPages = Math.min(pdf.numPages, 10);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => item.str)
        .filter(str => str.trim().length > 0)
        .join(' ');
      fullText += pageText + '\n';
    }

    return fullText.trim();
  } catch (error) {
    console.error('PDF blob extraction error:', error);
    return null;
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
    showLoadingNotification('ðŸ"„ Analyzing PDF...');
    
    try {
      await loadPDFJsSafe(); // Load PDF.js first
      const text = await extractTextFromPDF(target.href);
      
      if (text && text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          showPDFAnalysisModal(analysis, text, target.href);
        } else {
          showNotification('âŒ Could not identify content type');
        }
      } else {
        showNotification('âŒ Could not extract text from PDF');
      }
    } catch (error) {
      console.error('PDF analysis failed:', error);
      showNotification('âŒ Failed to analyze PDF');
    }
    
    // Option to open anyway
    setTimeout(() => {
      const openAnyway = confirm('Open PDF in new tab?');
      if (openAnyway) {
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
      showNotification('âš ï¸ PDF too large (max 5MB)');
      return;
    }

    showLoadingNotification('ðŸ"„ Analyzing uploaded PDF...');
    
    try {
      await loadPDFJsSafe(); // Ensure PDF.js is loaded
      const text = await extractTextFromBlob(file);
      
      if (text && text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          showPDFAnalysisModal(analysis, text, file.name);
        } else {
          showNotification('âŒ Could not identify content type');
        }
      } else {
        showNotification('âŒ Could not extract text from PDF');
      }
    } catch (error) {
      console.error('File upload analysis failed:', error);
      showNotification('âŒ Failed to analyze PDF');
    } finally {
      // Remove loading notification
      const loadingNotif = document.getElementById('ai-loading-notif');
      if (loadingNotif) loadingNotif.remove();
    }
  });
}