/**
 * Parse CSV content into structured data for the dashboard
 * @param {string} csvContent - Raw CSV file content
 * @returns {object} Parsed data with metadata and test results
 */
export const parseCSV = (csvContent) => {
  const lines = csvContent.trim().split('\n');
  
  // Extract metadata from first two lines
  const platformLine = lines[0].split(',');
  const imageLine = lines[1].split(',');
  
  const metadata = {
    platform: platformLine[1]?.trim() || 'Unknown',
    image: imageLine[1]?.trim() || 'Unknown'
  };
  
  // Parse test data (skip first 3 lines: Platform, Image, Header)
  const testData = [];
  let idCounter = 1;
  
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Handle CSV with quoted fields containing commas
    const fields = parseCSVLine(line);
    
    if (fields.length >= 3) {
      const testCase = fields[0]?.trim() || '';
      const parameter = fields[1]?.trim() || '';
      const throughput = fields[2]?.trim() || '';
      
      // Skip the column header row
      if (testCase.toUpperCase() === 'TESTCASE') continue;
      // Skip blank test cases
      if (!testCase) continue;
      
      // Extract CPU, Memory, SHM if available
      const cpuMatch = throughput.match(/CPU:\s*(\d+)%/i);
      const cpu = cpuMatch ? cpuMatch[1] + '%' : '85%'; // Default for GNATS issues
      
      // Mock memory and SHM data (would come from additional source in production)
      const memory = cpuMatch ? `${(4.5 + Math.random() * 1.5).toFixed(1)}GB` : '5.2GB';
      const shm = cpuMatch ? '512MB' : '1GB';
      
      testData.push({
        id: idCounter++,
        testCase,
        parameter,
        throughput,
        cpu,
        memory,
        shm,
        // Check if throughput is a GNATS issue ID (numeric only)
        isGnatsIssue: /^\d+$/.test(throughput.trim()),
        gnatsUrl: /^\d+$/.test(throughput.trim()) 
          ? `https://gnats.juniper.net/web/default/${throughput.trim()}#description_tab` 
          : null
      });
    }
  }
  
  return {
    metadata,
    testData
  };
};

/**
 * Parse a single CSV line handling quoted fields
 * @param {string} line - CSV line
 * @returns {array} Array of field values
 */
const parseCSVLine = (line) => {
  const fields = [];
  let currentField = '';
  let insideQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  
  // Push the last field
  fields.push(currentField);
  
  return fields;
};

/**
 * Load CSV file from server
 * @param {string} filePath - Path to CSV file (default: latest)
 * @returns {Promise<object>} Parsed CSV data
 */
export const loadCSVFromServer = async (filePath = '/api/sanity-results/latest') => {
  try {
    // In production: VITE_API_URL is '' so URLs are relative (nginx proxies /api/ to backend)
    // In local dev: set VITE_API_URL=http://localhost:3001 in .env
    const API_BASE = import.meta.env.VITE_API_URL || '';
    const url = filePath.startsWith('http') ? filePath : `${API_BASE}${filePath}`;
    
    console.log('Loading CSV from:', url);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const csvContent = await response.text();
    return parseCSV(csvContent);
  } catch (error) {
    console.error('Error loading CSV:', error);
    throw error;
  }
};

/**
 * Generate mock historical data for a test case
 * This would be replaced with actual historical CSV parsing
 * @param {number} testId - Test case ID
 * @returns {array} Historical data points
 */
export const generateHistoricalData = (testId) => {
  const days = 30;
  const historicalData = [];
  
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (days - i - 1));
    
    historicalData.push({
      day: `Day ${i + 1}`,
      date: date.toISOString().split('T')[0],
      throughput: (1.72 + Math.random() * 0.11).toFixed(2),
      cpu: `${Math.floor(81 + Math.random() * 5)}%`,
      memory: `${(5.0 + Math.random() * 0.4).toFixed(1)}GB`,
      shm: '1GB'
    });
  }
  
  return historicalData;
};
