import React, { useState } from 'react';
import { Shield, AlertCircle, CheckCircle, AlertTriangle, Upload, Link, Zap, Loader2 } from 'lucide-react';

export default function TrustScan() {
  const [currentPage, setCurrentPage] = useState('home');
  const [jobInput, setJobInput] = useState('');
  const [scanResults, setScanResults] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [reportedJobs, setReportedJobs] = useState([]);
  const [reportJobId, setReportJobId] = useState('');
  const [reportDescription, setReportDescription] = useState('');

  const handleScan = async () => {
    if (!jobInput.trim()) return;

    setIsScanning(true);

    try {
      // Call Claude API for real AI analysis
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `You are an expert job scam detector. Analyze this job posting and return ONLY a JSON object with no markdown formatting or backticks.

Job Posting:
${jobInput}

Return this exact JSON structure:
{
  "trustScore": <number 0-100>,
  "riskLevel": "<safe|moderate|risky>",
  "redFlags": ["flag1", "flag2"],
  "greenFlags": ["positive1", "positive2"],
  "companyVerification": "<verified|unverified|suspicious>",
  "explanation": "<detailed explanation>",
  "recommendation": "<what the user should do>"
}

Analyze for:
- Scam keywords (guaranteed income, wire money, no experience, too good to be true)
- Email domains (free emails like gmail/yahoo vs company domains)
- Vague job descriptions
- Missing company information
- Salary promises vs realistic expectations
- Urgency tactics
- Upfront payment requests
- Poor grammar/spelling
- Legitimate company indicators`
            }
          ]
        })
      });

      const data = await response.json();
      const aiResponse = data.content[0].text;

      // Parse JSON response
      let results;
      try {
        // Remove any markdown formatting
        const cleanJson = aiResponse.replace(/```json\n?|\n?```/g, '').trim();
        results = JSON.parse(cleanJson);
      } catch (e) {
        // Fallback if JSON parsing fails
        results = {
          trustScore: 50,
          riskLevel: "moderate",
          redFlags: ["Unable to fully analyze - please try again"],
          greenFlags: [],
          companyVerification: "unverified",
          explanation: "Analysis encountered an error. Please reformat your input and try again.",
          recommendation: "Proceed with caution and verify company details independently."
        };
      }

      setScanResults({
        ...results,
        timestamp: new Date().toLocaleString()
      });
      setCurrentPage('results');

    } catch (error) {
      console.error('Scan error:', error);
      setScanResults({
        trustScore: 50,
        riskLevel: "moderate",
        redFlags: ["Analysis error - please try again"],
        greenFlags: [],
        companyVerification: "unverified",
        explanation: "We encountered an error analyzing this posting. Please try again.",
        recommendation: "Verify company details independently before applying.",
        timestamp: new Date().toLocaleString()
      });
      setCurrentPage('results');
    } finally {
      setIsScanning(false);
    }
  };

  const handleReport = async () => {
    if (reportJobId.trim()) {
      const newReport = {
        id: reportJobId,
        description: reportDescription,
        date: new Date().toLocaleString()
      };

      try {
        // Load existing reports
        const existing = await window.storage.get('reported-jobs', true);
        const reports = existing ? JSON.parse(existing.value) : [];
        reports.push(newReport);

        // Save updated reports
        await window.storage.set('reported-jobs', JSON.stringify(reports), true);

        setReportedJobs(reports);
        setReportJobId('');
        setReportDescription('');
        alert('Job reported successfully! Thank you for helping keep our community safe.');
      } catch (error) {
        console.error('Report error:', error);
        alert('Report submitted! (Note: Storage may be limited)');
      }
    }
  };

  const loadReports = async () => {
    try {
      const data = await window.storage.get('reported-jobs', true);
      if (data) {
        setReportedJobs(JSON.parse(data.value));
      }
    } catch (error) {
      console.log('No reports found');
    }
  };

  React.useEffect(() => {
    if (currentPage === 'report') {
      loadReports();
    }
  }, [currentPage]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50 font-sans">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setCurrentPage('home'); setScanResults(null); }}>
            <Shield className="w-7 h-7 text-blue-600" />
            <span className="text-2xl font-bold text-slate-900">TrustScan</span>
          </div>
          <div className="flex gap-8 text-sm font-medium">
            {['home', 'scan', 'report', 'about'].map(item => (
              <button
                key={item}
                onClick={() => setCurrentPage(item)}
                className={`transition-colors capitalize ${currentPage === item
                  ? 'text-blue-600 border-b-2 border-blue-600 pb-1'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Home Page */}
      {currentPage === 'home' && !scanResults && (
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-16">
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-blue-100 rounded-full">
                <Shield className="w-12 h-12 text-blue-600" />
              </div>
            </div>
            <h1 className="text-5xl font-bold text-slate-900 mb-4">Don't get scammed.</h1>
            <h2 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent mb-6">Get scanned.</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              AI-powered verification for every job listing. Detect fake companies, scam keywords, and unsafe URLs in seconds.
            </p>
          </div>

          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-8 border border-slate-200">
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-900 mb-3">Paste Job Post or URL</label>
              <textarea
                value={jobInput}
                onChange={(e) => setJobInput(e.target.value)}
                placeholder="Paste the full job description here or enter the job posting URL...

Example:
'Hiring: Remote Data Entry Clerk - $5000/week guaranteed! No experience needed. Start immediately. Send $50 processing fee to secure your position. Contact: jobsoffer@gmail.com'"
                className="w-full h-40 p-4 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none transition-colors text-slate-700"
              />
            </div>

            <button
              onClick={handleScan}
              disabled={!jobInput.trim() || isScanning}
              className="w-full py-3 px-6 bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold rounded-lg hover:shadow-xl hover:shadow-blue-500/30 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  AI Scanning...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Scan with AI
                </>
              )}
            </button>
          </div>

          {/* Features */}
          <div className="grid grid-cols-3 gap-6 mt-16">
            {[
              { icon: CheckCircle, title: 'AI-Powered Analysis', desc: 'Claude AI analyzes job postings in real-time' },
              { icon: AlertTriangle, title: 'Red Flag Detection', desc: 'Identifies scam patterns & suspicious keywords' },
              { icon: Shield, title: 'Risk Assessment', desc: 'Trust scores from 0-100 with detailed explanations' }
            ].map((feature, i) => (
              <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
                <feature.icon className="w-8 h-8 text-blue-600 mb-3" />
                <h3 className="font-bold text-slate-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scanning Animation */}
      {isScanning && (
        <div className="max-w-6xl mx-auto px-6 py-20 flex items-center justify-center">
          <div className="text-center">
            <div className="relative w-32 h-32 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 border-r-blue-600 animate-spin"></div>
              <div className="absolute inset-4 rounded-full border-4 border-transparent border-b-cyan-600 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Zap className="w-12 h-12 text-blue-600 animate-pulse" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">AI Analyzing Job Posting</h2>
            <p className="text-slate-600">Claude AI is scanning for scam indicators, verifying details, and assessing risk level...</p>
          </div>
        </div>
      )}

      {/* Results Page */}
      {currentPage === 'results' && scanResults && (
        <div className="max-w-4xl mx-auto px-6 py-12">
          <button
            onClick={() => { setCurrentPage('home'); setScanResults(null); setJobInput(''); }}
            className="mb-8 text-blue-600 hover:text-blue-700 font-medium text-sm"
          >
            ← Back to Scan
          </button>

          {/* Trust Score Card */}
          <div className={`rounded-2xl p-8 mb-8 border-2 ${scanResults.riskLevel === 'safe' ? 'bg-green-50 border-green-300' :
            scanResults.riskLevel === 'moderate' ? 'bg-yellow-50 border-yellow-300' :
              'bg-red-50 border-red-300'
            }`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium mb-1">TRUST SCORE</p>
                <h2 className="text-5xl font-bold text-slate-900">{scanResults.trustScore}/100</h2>
                <p className="text-slate-600 mt-2">Company: {scanResults.companyVerification}</p>
              </div>
              <div className={`text-right p-6 rounded-xl ${scanResults.riskLevel === 'safe' ? 'bg-green-100' :
                scanResults.riskLevel === 'moderate' ? 'bg-yellow-100' :
                  'bg-red-100'
                }`}>
                {scanResults.riskLevel === 'safe' && <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-2" />}
                {scanResults.riskLevel === 'moderate' && <AlertTriangle className="w-12 h-12 text-yellow-600 mx-auto mb-2" />}
                {scanResults.riskLevel === 'risky' && <AlertCircle className="w-12 h-12 text-red-600 mx-auto mb-2" />}
                <p className="font-bold capitalize text-sm">{scanResults.riskLevel}</p>
              </div>
            </div>
          </div>

          {/* Red Flags */}
          {scanResults.redFlags && scanResults.redFlags.length > 0 && (
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8 mb-8">
              <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                Red Flags Detected
              </h3>
              <div className="space-y-3">
                {scanResults.redFlags.map((flag, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 flex-shrink-0"></div>
                    <p className="text-sm text-slate-700">{flag}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Green Flags */}
          {scanResults.greenFlags && scanResults.greenFlags.length > 0 && (
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8 mb-8">
              <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Positive Indicators
              </h3>
              <div className="space-y-3">
                {scanResults.greenFlags.map((flag, i) => (
                  <div key={i} className="flex gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full mt-1.5 flex-shrink-0"></div>
                    <p className="text-sm text-slate-700">{flag}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Explanation */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl shadow-md border border-blue-200 p-8 mb-6">
            <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600" />
              AI Analysis
            </h3>
            <p className="text-slate-700 leading-relaxed mb-4">{scanResults.explanation}</p>
            <div className="bg-white/50 rounded-lg p-4 mt-4">
              <p className="font-semibold text-slate-900 mb-2">Recommendation:</p>
              <p className="text-slate-700">{scanResults.recommendation}</p>
            </div>
            <p className="text-xs text-slate-500 mt-4">Scanned on {scanResults.timestamp}</p>
          </div>

          <button
            onClick={() => setCurrentPage('report')}
            className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors"
          >
            Report This Job as Scam
          </button>
        </div>
      )}

      {/* Scan Page (redirect to home) */}
      {currentPage === 'scan' && (() => { setCurrentPage('home'); return null; })()}

      {/* Report Page */}
      {currentPage === 'report' && (
        <div className="max-w-4xl mx-auto px-6 py-12">
          <h1 className="text-3xl font-bold text-slate-900 mb-8">Report Scam Jobs</h1>

          <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8 mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Submit a Report</h2>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Job posting URL or Company Name"
                value={reportJobId}
                onChange={(e) => setReportJobId(e.target.value)}
                className="w-full p-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none text-slate-700"
              />
              <textarea
                placeholder="Describe why you believe this is a scam job (e.g., asked for money upfront, fake company, etc.)"
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                className="w-full h-24 p-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none resize-none text-slate-700"
              />
              <button
                onClick={handleReport}
                disabled={!reportJobId.trim()}
                className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Report
              </button>
            </div>
          </div>

          {reportedJobs.length > 0 && (
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Community Reports ({reportedJobs.length})</h2>
              <div className="space-y-3">
                {reportedJobs.slice(-10).reverse().map((job, i) => (
                  <div key={i} className="p-4 bg-red-50 rounded-lg border border-red-200">
                    <p className="font-medium text-slate-900">{job.id}</p>
                    {job.description && <p className="text-sm text-slate-600 mt-1">{job.description}</p>}
                    <p className="text-xs text-slate-500 mt-2">Reported: {job.date}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* About Page */}
      {currentPage === 'about' && (
        <div className="max-w-4xl mx-auto px-6 py-12">
          <h1 className="text-3xl font-bold text-slate-900 mb-8">About TrustScan</h1>

          <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8">
              <h2 className="text-xl font-bold text-slate-900 mb-3">Our Mission</h2>
              <p className="text-slate-700 leading-relaxed">
                TrustScan uses Claude AI to protect job seekers from fraudulent job postings and scammers. Our advanced AI analyzes job listings in real-time to detect scam patterns, verify company information, and provide trust scores to help you make informed decisions.
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-8">
              <h2 className="text-xl font-bold text-slate-900 mb-4">How It Works</h2>
              <div className="space-y-4 text-slate-700">
                <div className="flex gap-3">
                  <span className="font-bold text-blue-600 flex-shrink-0">1.</span>
                  <div>
                    <span className="font-semibold">AI Analysis:</span> Claude AI examines job postings using natural language processing to understand context and detect suspicious patterns
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="font-bold text-blue-600 flex-shrink-0">2.</span>
                  <div>
                    <span className="font-semibold">Pattern Detection:</span> Identifies common scam indicators like guaranteed income, upfront fees, urgency tactics, and vague descriptions
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="font-bold text-blue-600 flex-shrink-0">3.</span>
                  <div>
                    <span className="font-semibold">Company Verification:</span> Checks email domains, company information, and contact details for legitimacy
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="font-bold text-blue-600 flex-shrink-0">4.</span>
                  <div>
                    <span className="font-semibold">Risk Assessment:</span> Generates a comprehensive trust score (0-100) with detailed explanations and recommendations
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border border-blue-200 p-8">
              <h2 className="text-xl font-bold text-slate-900 mb-3">Powered by AI</h2>
              <p className="text-slate-700 mb-4">TrustScan uses Claude AI (Sonnet 4) by Anthropic for intelligent job scam detection with:</p>
              <div className="grid grid-cols-2 gap-4 text-sm text-slate-700">
                <div>• Real-time AI analysis</div>
                <div>• Pattern recognition</div>
                <div>• Context understanding</div>
                <div>• Risk assessment</div>
                <div>• Natural language processing</div>
                <div>• Detailed explanations</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}