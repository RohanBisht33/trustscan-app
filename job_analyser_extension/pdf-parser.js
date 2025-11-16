(function() {
  'use strict';

  // Use CDN-hosted PDF.js
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  
  window.PDFParser = {
    initialized: false,
    
    async init() {
      if (this.initialized) return;
      
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PDFJS_URL;
        script.onload = () => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            this.initialized = true;
            resolve();
          } else {
            reject(new Error('PDF.js failed to load'));
          }
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    },
    
    async extractText(pdfUrl) {
      try {
        await this.init();
        
        const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
        let fullText = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + '\n';
        }
        
        return fullText;
      } catch (error) {
        console.error('PDF parsing error:', error);
        return null;
      }
    },
    
    async extractFromBlob(blob) {
      try {
        await this.init();
        
        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + '\n';
        }
        
        return fullText;
      } catch (error) {
        console.error('PDF parsing error:', error);
        return null;
      }
    }
  };
})();