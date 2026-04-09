# Production API Setup Guide

## Overview
This guide explains how to set up the backend API to serve CSV files from your server.

## Server File Location
```
/root/gramasub/PANTHER_SANITY/
├── 25.4X300-202603150112.0-EVO.csv
└── (other CSV files)
```

## Option 1: Node.js/Express Backend

### Install Dependencies
```bash
npm install express cors
```

### Create API Server (server.js)
```javascript
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const CSV_DIR = '/root/gramasub/PANTHER_SANITY';

app.use(cors());

// Get latest CSV file
app.get('/api/sanity-results/latest', (req, res) => {
  try {
    const files = fs.readdirSync(CSV_DIR)
      .filter(file => file.endsWith('.csv'))
      .map(file => ({
        name: file,
        time: fs.statSync(path.join(CSV_DIR, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);
    
    if (files.length === 0) {
      return res.status(404).json({ error: 'No CSV files found' });
    }
    
    const latestFile = files[0].name;
    const filePath = path.join(CSV_DIR, latestFile);
    const content = fs.readFileSync(filePath, 'utf8');
    
    res.type('text/csv').send(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific CSV file
app.get('/api/sanity-results/:filename', (req, res) => {
  try {
    const filePath = path.join(CSV_DIR, req.params.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    res.type('text/csv').send(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all CSV files
app.get('/api/sanity-results', (req, res) => {
  try {
    const files = fs.readdirSync(CSV_DIR)
      .filter(file => file.endsWith('.csv'))
      .map(file => ({
        name: file,
        size: fs.statSync(path.join(CSV_DIR, file)).size,
        modified: fs.statSync(path.join(CSV_DIR, file)).mtime
      }))
      .sort((a, b) => b.modified - a.modified);
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
```

### Run the Server
```bash
node server.js
```

## Option 2: Python/Flask Backend

### Install Dependencies
```bash
pip install flask flask-cors
```

### Create API Server (server.py)
```python
from flask import Flask, send_file, jsonify
from flask_cors import CORS
import os
from pathlib import Path

app = Flask(__name__)
CORS(app)

CSV_DIR = '/root/gramasub/PANTHER_SANITY'

@app.route('/api/sanity-results/latest')
def get_latest():
    try:
        files = sorted(
            Path(CSV_DIR).glob('*.csv'),
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        
        if not files:
            return jsonify({'error': 'No CSV files found'}), 404
        
        return send_file(files[0], mimetype='text/csv')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sanity-results/<filename>')
def get_file(filename):
    try:
        file_path = os.path.join(CSV_DIR, filename)
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(file_path, mimetype='text/csv')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sanity-results')
def list_files():
    try:
        files = [
            {
                'name': f.name,
                'size': f.stat().st_size,
                'modified': f.stat().st_mtime
            }
            for f in sorted(
                Path(CSV_DIR).glob('*.csv'),
                key=lambda x: x.stat().st_mtime,
                reverse=True
            )
        ]
        
        return jsonify({'files': files})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3001)
```

### Run the Server
```bash
python server.py
```

## Frontend Configuration

Update `src/utils/csvParser.js`:

```javascript
export const loadCSVFromServer = async (filePath = '/api/sanity-results/latest') => {
  try {
    const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';
    const response = await fetch(`${API_BASE}${filePath}`);
    
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
```

## Environment Variables

Create `.env` file in your React project:
```
REACT_APP_API_URL=http://your-server-ip:3001
```

## Production Deployment

### Using PM2 (Node.js)
```bash
npm install -g pm2
pm2 start server.js --name sanity-api
pm2 save
pm2 startup
```

### Using systemd (Python)
Create `/etc/systemd/system/sanity-api.service`:
```ini
[Unit]
Description=Sanity Test API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/api
ExecStart=/usr/bin/python3 /root/api/server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
systemctl enable sanity-api
systemctl start sanity-api
```

## Testing

```bash
# Test latest file endpoint
curl http://localhost:3001/api/sanity-results/latest

# Test specific file
curl http://localhost:3001/api/sanity-results/25.4X300-202603150112.0-EVO.csv

# List all files
curl http://localhost:3001/api/sanity-results
```

## Security Considerations

1. Add authentication if needed
2. Implement rate limiting
3. Use HTTPS in production
4. Restrict CORS to specific origins
5. Validate file paths to prevent directory traversal

## Current Status

✅ Frontend configured to load CSV from `/sample-data.csv` (development)
✅ CSV parser handles GNATS issue IDs
✅ Links automatically generated for numeric throughput values
✅ Loading and error states implemented

🔄 Next: Set up production API endpoint and update `REACT_APP_API_URL`
