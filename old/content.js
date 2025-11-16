(function() {
  'use strict';

  let isEnabled = true;
  let tooltip = null;
  let currentAnalysis = null;

  // Initialize
  init();

  function init() {
    chrome.storage.local.get(['extensionEnabled'], function(result) {
      isEnabled = result.extensionEnabled !== false;
      if (isEnabled) {
        createTooltip();
        attachListeners();
      }
    });
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'toggleExtension') {
      isEnabled = request.enabled;
      if (isEnabled) {
        attachListeners();
      } else {
        removeListeners();
        hideTooltip();
      }
    } else if (request.action === 'analyzeFullPage') {
      analyzeFullPage();
    }
  });

  function createTooltip() {
    if (tooltip) return;

    tooltip = document.createElement('div');
    tooltip.id = 'ai-analyzer-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
      padding: 16px;
      min-width: 280px;
      max-width: 400px;
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      color: #1e293b;
      border: 2px solid #e2e8f0;
    `;
    document.body.appendChild(tooltip);
  }

  function showTooltip(x, y, content) {
    if (!tooltip) createTooltip();
    
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    
    // Position tooltip
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = x - tooltipRect.width / 2;
    let top = y - tooltipRect.height - 10;

    // Keep tooltip in viewport
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
      const text = getElementText(element);
      
      if (text.length > 50) {
        analyzeText(text, e.clientX, e.clientY);
      }
    }, 300);
  }

  function handleMouseOut() {
    clearTimeout(hoverTimeout);
    setTimeout(hideTooltip, 200);
  }

  function getElementText(element) {
    // Get text from element, avoiding script/style tags
    let text = '';
    
    if (element.tagName === 'P' || element.tagName === 'DIV' || 
        element.tagName === 'SECTION' || element.tagName === 'ARTICLE') {
      text = element.innerText || element.textContent;
    }
    
    return text.trim().substring(0, 2000);
  }

  function analyzeText(text, x, y) {
    const analysis = performAnalysis(text);
    
    if (analysis.type === 'unknown') return;

    const tooltipContent = generateTooltipHTML(analysis);
    showTooltip(x, y, tooltipContent);
  }

  function performAnalysis(text) {
    const type = detectType(text);
    
    if (type === 'job_listing') {
      return analyzeJob(text);
    } else if (type === 'resume') {
      return analyzeResume(text);
    }
    
    return { type: 'unknown' };
  }

  function detectType(text) {
    const lower = text.toLowerCase();
    
    const resumeKeywords = ['experience', 'education', 'skills', 'btech', 'graduate', 'resume', 'cv', 'profile'];
    const jobKeywords = ['looking for', 'hiring', 'job', 'position', 'required', 'apply', 'vacancy'];
    
    const resumeScore = resumeKeywords.filter(k => lower.includes(k)).length;
    const jobScore = jobKeywords.filter(k => lower.includes(k)).length;
    
    if (resumeScore > jobScore && resumeScore >= 2) return 'resume';
    if (jobScore > resumeScore && jobScore >= 2) return 'job_listing';
    
    return 'unknown';
  }

  function analyzeJob(text) {
    const lower = text.toLowerCase();
    let score = 100;
    const flags = [];

    const scamPatterns = [
      // Critical red flags (higher weight)
      { pattern: /no experience needed|no experience required/i, flag: 'No experience needed (common scam)', weight: 15 },
      { pattern: /aadhaar|aadhar|pan card|bank passbook|id proof|upload.*id/i, flag: 'Asks for sensitive ID documents', weight: 35 },
      { pattern: /registration fee|pay.*fee|payment.*required|deposit/i, flag: 'Asks for payment/fees', weight: 35 },
      { pattern: /google form|whatsapp|telegram|social media/i, flag: 'Unofficial application method', weight: 25 },
      { pattern: /training.*paid|earn.*training|paid.*learn/i, flag: 'Suspicious training payment claims', weight: 20 },
      { pattern: /fast promotion|quick promotion|immediate promotion/i, flag: 'Unrealistic promotion promises', weight: 20 },
      
      // High red flags
      { pattern: /virtual assistant.*remote.*no experience/i, flag: 'Classic VA scam pattern', weight: 25 },
      { pattern: /payment processing|money transfer|fund transfer/i, flag: 'Money handling scam risk', weight: 30 },
      { pattern: /earn ₹|earn rs|salary ₹\d{5,}/i, flag: 'Unusually high salary promise', weight: 20 },
      { pattern: /work from home.*₹|wfh.*earn/i, flag: 'Work-from-home money scheme', weight: 20 },
      
      // Medium red flags
      { pattern: /no interview/i, flag: 'No interview process', weight: 18 },
      { pattern: /easy money|quick money|daily income|weekly payment/i, flag: 'Unrealistic earning promises', weight: 20 },
      { pattern: /click here|click.*link|bit\.ly|shortened url/i, flag: 'Suspicious links', weight: 15 },
      { pattern: /urgent.*hiring|immediate.*joining|join today/i, flag: 'Pressure tactics', weight: 12 },
      { pattern: /guaranteed.*income|assured.*salary/i, flag: 'Guaranteed income claims', weight: 18 },
      { pattern: /part.*time.*\d{4,}|side.*income.*\d{4,}/i, flag: 'Unrealistic part-time pay', weight: 15 },
      
      // Vague job descriptions
      { pattern: /flexible.*timing|own.*hours|work.*anytime/i, flag: 'Vague work arrangement', weight: 8 },
      { pattern: /simple.*task|easy.*work|basic.*work/i, flag: 'Vague job description', weight: 10 },
      { pattern: /international.*company.*hiring|global.*hiring/i, flag: 'Vague international claims', weight: 12 }
    ];

    scamPatterns.forEach(({ pattern, flag, weight }) => {
      if (pattern.test(text)) {
        flags.push(flag);
        score -= weight;
      }
    });

    // Check for legitimate company indicators
    const hasLegitCompany = /(pvt\.?\s*ltd|private limited|inc\.|corporation|technologies|solutions|systems)/i.test(text);
    const hasVagueCompany = /global|international|world|universal|best|top|leading/i.test(text) && 
                            !/pvt|ltd|inc|corp/i.test(text);
    
    if (hasVagueCompany) {
      flags.push('Vague/Generic company name');
      score -= 15;
    } else if (!hasLegitCompany && !/company:/i.test(text)) {
      flags.push('No verifiable company');
      score -= 12;
    }

    // Check for professional application process
    const hasProperProcess = /@.*\.(com|in|co)|careers\.|apply.*official|linkedin\.com|naukri\.com/i.test(text);
    const hasUnprofessionalProcess = /google form|whatsapp|telegram|dm|direct message/i.test(lower);
    
    if (hasUnprofessionalProcess && !hasProperProcess) {
      flags.push('Non-professional application');
      score -= 15;
    } else if (!hasProperProcess && !hasUnprofessionalProcess) {
      flags.push('Unclear application process');
      score -= 8;
    }

    // Check salary reasonableness (₹80,000/month for no experience = red flag)
    const salaryMatch = text.match(/₹\s*(\d+)[,\d]*\s*(?:per month|\/month|pm)/i);
    if (salaryMatch) {
      const salary = parseInt(salaryMatch[1].replace(/,/g, ''));
      if (salary > 50000 && /no experience|fresher/i.test(text)) {
        flags.push('Unrealistic salary for experience level');
        score -= 25;
      }
    }

    // Red flags section mentioned explicitly
    if (/red flag|warning|suspicious|scam/i.test(text)) {
      flags.push('Job posting mentions red flags');
      score -= 20;
    }

    return {
      type: 'job_listing',
      trustScore: Math.max(0, score),
      flags: flags
    };
  }

  function analyzeResume(text) {
    const lower = text.toLowerCase();
    const highlights = [];
    const redFlags = [];
    let score = 70;

    // Skills detection with validation
    const techSkills = ['python', 'javascript', 'java', 'react', 'node', 'sql', 'aws', 'docker', 'kubernetes', 
                        'ml', 'ai', 'deep learning', 'django', 'flask', 'angular', 'vue', 'mongodb', 'postgresql'];
    const foundSkills = techSkills.filter(skill => lower.includes(skill));
    
    if (foundSkills.length > 0) {
      highlights.push(`Skills: ${foundSkills.slice(0, 5).join(', ')}`);
      score += Math.min(15, foundSkills.length * 2);
    } else {
      redFlags.push('No technical skills mentioned');
      score -= 15;
    }

    // Check for skill stuffing (too many skills = suspicious)
    if (foundSkills.length > 15) {
      redFlags.push('Excessive skills listed (may be exaggerated)');
      score -= 20;
    }

    // Experience validation
    const expMatch = text.match(/(\d+)\+?\s*years?/i);
    if (expMatch) {
      const years = parseInt(expMatch[1]);
      highlights.push(`${years} years experience`);
      
      if (years <= 2) {
        score += 8;
      } else if (years <= 5) {
        score += 15;
      } else if (years <= 10) {
        score += 20;
      } else if (years > 15) {
        redFlags.push('Unusually long experience (verify dates)');
        score -= 5;
      }

      // Check experience vs skills mismatch
      if (years < 2 && foundSkills.length > 12) {
        redFlags.push('Too many skills for experience level');
        score -= 15;
      }
    } else {
      redFlags.push('No clear experience mentioned');
      score -= 10;
    }

    // Education validation
    const educationKeywords = ['btech', 'mtech', 'bachelor', 'master', 'degree', 'bs', 'ms', 'phd', 'b.e', 'm.e'];
    const hasEducation = educationKeywords.some(edu => lower.includes(edu));
    
    if (hasEducation) {
      highlights.push('Technical degree');
      score += 10;
    } else {
      redFlags.push('No education credentials');
      score -= 12;
    }

    // Check for unrealistic claims
    const unrealisticPatterns = [
      { pattern: /expert.*everything|know.*all|master.*all/i, flag: 'Claims expertise in everything' },
      { pattern: /100%|perfectly|always|never failed/i, flag: 'Absolute/unrealistic claims' },
      { pattern: /top.*performer|best.*employee|#1/i, flag: 'Unverifiable superlatives' },
      { pattern: /guaranteed.*results|100%.*success/i, flag: 'Unrealistic guarantees' }
    ];

    unrealisticPatterns.forEach(({ pattern, flag }) => {
      if (pattern.test(text)) {
        redFlags.push(flag);
        score -= 15;
      }
    });

    // Check for vague content
    const vaguePatterns = [
      { pattern: /hard working|team player|fast learner/i, flag: 'Generic buzzwords only', weight: 5 },
      { pattern: /responsible for|handled|managed/i, isGood: true },
      { pattern: /developed|built|created|designed|implemented/i, isGood: true }
    ];

    const hasActionVerbs = vaguePatterns.some(p => p.isGood && p.pattern.test(text));
    const onlyBuzzwords = /hard working|team player|fast learner/i.test(text) && !hasActionVerbs;
    
    if (onlyBuzzwords) {
      redFlags.push('Lacks specific achievements');
      score -= 10;
    }

    // Check for proper structure indicators
    const hasProjects = /project|github|portfolio|built/i.test(text);
    const hasCompanies = /pvt|ltd|inc|corp|company/i.test(text);
    const hasDates = /\d{4}|\d{2}\/\d{2}/i.test(text);
    
    if (hasProjects) {
      highlights.push('Projects/Portfolio mentioned');
      score += 10;
    }
    
    if (hasCompanies) {
      highlights.push('Work experience listed');
      score += 8;
    }

    if (!hasDates) {
      redFlags.push('No dates/timeline provided');
      score -= 8;
    }

    // Contact info validation
    const hasEmail = /@/i.test(text);
    const hasPhone = /\d{10}|\+\d{2}\s?\d{10}/i.test(text);
    const hasLinkedIn = /linkedin/i.test(text);
    
    if (hasEmail || hasPhone) {
      score += 5;
    } else {
      redFlags.push('No contact information');
      score -= 10;
    }

    if (hasLinkedIn) {
      highlights.push('LinkedIn profile included');
      score += 5;
    }

    // Check resume length indicators (too short = incomplete)
    if (text.length < 200) {
      redFlags.push('Resume appears incomplete');
      score -= 15;
    }

    // Spelling/grammar check (basic)
    const commonMistakes = /experiance|exprience|skillz|companey|projcts/i;
    if (commonMistakes.test(text)) {
      redFlags.push('Contains spelling errors');
      score -= 10;
    }

    return {
      type: 'resume',
      score: Math.max(0, Math.min(100, score)),
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
            ${analysis.flags.map(flag => `<div style="color: #dc2626; margin-left: 12px;">• ${flag}</div>`).join('')}
          </div>
        ` : `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px; font-size: 12px; color: #166534;">
            ✓ No risk factors detected
          </div>
        `}
      `;
    } else if (analysis.type === 'resume') {
      const scoreLevel = getScoreLevel(analysis.score);
      
      return `
        <div style="display: flex; align-items: center; margin-bottom: 12px;">
          <div style="font-size: 20px; margin-right: 8px;">📄</div>
          <div>
            <div style="font-weight: 600; color: #1e293b;">Resume</div>
            <div style="font-size: 11px; color: #64748b;">AI Analysis</div>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-size: 12px; color: #64748b;">Profile Strength</span>
          <span style="font-size: 18px; font-weight: 700; color: ${scoreLevel.color};">
            ${analysis.score}%
          </span>
        </div>
        
        <div style="background: #f1f5f9; border-radius: 8px; height: 6px; overflow: hidden; margin-bottom: 12px;">
          <div style="background: ${scoreLevel.color}; height: 100%; width: ${analysis.score}%; transition: width 0.3s;"></div>
        </div>
        
        ${analysis.highlights.length > 0 ? `
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px; font-size: 12px; margin-bottom: 8px;">
            <div style="font-weight: 600; color: #1e40af; margin-bottom: 6px;">✨ Highlights:</div>
            ${analysis.highlights.map(h => `<div style="color: #2563eb; margin-left: 12px;">• ${h}</div>`).join('')}
          </div>
        ` : ''}
        
        ${analysis.redFlags && analysis.redFlags.length > 0 ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px; font-size: 12px;">
            <div style="font-weight: 600; color: #991b1b; margin-bottom: 6px;">⚠️ Red Flags:</div>
            ${analysis.redFlags.map(flag => `<div style="color: #dc2626; margin-left: 12px;">• ${flag}</div>`).join('')}
          </div>
        ` : ''}
      `;
    }
  }

  function getTrustLevel(score) {
    if (score >= 80) return { label: 'High Trust', color: '#22c55e' };
    if (score >= 60) return { label: 'Moderate', color: '#eab308' };
    return { label: 'Low Trust', color: '#ef4444' };
  }

  function getScoreLevel(score) {
    if (score >= 75) return { label: 'Strong Profile', color: '#22c55e' };
    if (score >= 55) return { label: 'Good Profile', color: '#3b82f6' };
    if (score >= 35) return { label: 'Needs Improvement', color: '#eab308' };
    return { label: 'Weak Profile', color: '#ef4444' };
  }

  function analyzeFullPage() {
    // Find all potential job/resume content
    const elements = document.querySelectorAll('p, div[class*="job"], div[class*="resume"], article, section');
    let analyzed = 0;

    elements.forEach(el => {
      const text = getElementText(el);
      if (text.length > 100) {
        const analysis = performAnalysis(text);
        if (analysis.type !== 'unknown') {
          // Add visual indicator
          el.style.outline = '2px solid #667eea';
          el.style.outlineOffset = '2px';
          analyzed++;
          
          setTimeout(() => {
            el.style.outline = '';
          }, 3000);
        }
      }
    });

    if (analyzed > 0) {
      showNotification(`✓ Analyzed ${analyzed} items on this page`);
    } else {
      showNotification('ℹ️ No job listings or resumes detected');
    }
  }

  function showNotification(message) {
    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 500;
      color: #1e293b;
      border-left: 4px solid #667eea;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => {
      notif.style.transition = 'opacity 0.3s';
      notif.style.opacity = '0';
      setTimeout(() => notif.remove(), 300);
    }, 3000);
  }

})();