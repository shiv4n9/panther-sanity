# CSV Integration Guide

## CSV File Structure

The dashboard expects CSV files in the following format:

```csv
Platform,SRX400
Image,25.4X300-202603150112.0-EVO
TESTCASE,PARAMETER,THROUGHPUT
Firewall Throughput,UDP 64B,"560KPPS/376Mbps, CPU: 99%"
Firewall Throughput,UDP IMIX,"610KPPS/1820Mbps, CPU: 98%"
IPSEC VPN Throughput (S2S, PSK, AES256-GCM),UDP 64B,1940446
AppSec Throughput,HTTP 64KB,1938096
```

## GNATS Issue Links

Numeric-only throughput values are treated as GNATS issue IDs and automatically linked to:
`https://gnats.juniper.net/web/default/{ISSUE_ID}`

Examples:
- `1940446` → https://gnats.juniper.net/web/default/1940446
- `1938096` → https://gnats.juniper.net/web/default/1938096

## Server Deployment

1. Place CSV files in: `/root/gramasub/PANTHER_SANITY/`
2. Create an API endpoint to serve CSV files
3. Update `src/utils/csvParser.js` to fetch from your API

## API Endpoint Example

```javascript
// Backend API (Node.js/Express example)
app.get('/api/sanity-results/:filename', (req, res) => {
  const filePath = `/root/gramasub/PANTHER_SANITY/${req.params.filename}`;
  res.sendFile(filePath);
});
```

## Frontend Integration

```javascript
import { loadCSVFromServer } from './utils/csvParser';

// Load latest CSV
const data = await loadCSVFromServer('/api/sanity-results/25.4X300-202603150112.0-EVO.csv');

// Pass to dashboard
<DailySanityDashboard data={data.testData} metadata={data.metadata} />
```

## Current Implementation

The dashboard currently uses mock data. To integrate real CSV data:

1. Set up the backend API endpoint
2. Update `DailySanityDashboard.jsx` to fetch CSV on mount
3. Parse CSV using the provided `csvParser.js` utility
4. Numeric throughput values will automatically link to GNATS

## Link Behavior

- **Numeric values** (e.g., 1940446): Opens GNATS issue in new tab
- **Throughput with CPU** (e.g., "560KPPS/376Mbps, CPU: 99%"): Links to historical view
