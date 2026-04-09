# Sanity Test API Server (Python/Flask)

Backend API server to serve CSV files from `/root/gramasub/PANTHER_SANITY/`

## Features

- ✅ Serve latest CSV file
- ✅ Serve specific CSV file by name
- ✅ List all available CSV files
- ✅ Get CSV metadata without downloading
- ✅ CORS enabled for frontend
- ✅ Health check endpoint
- ✅ Logging and error handling
- ✅ Systemd service support

## Quick Start

### 1. Installation

```bash
cd backend
chmod +x install.sh
./install.sh
```

### 2. Configuration

Edit `.env` file:
```bash
nano .env
```

Set your CSV directory:
```
CSV_DIR=/root/gramasub/PANTHER_SANITY
PORT=3001
HOST=0.0.0.0
DEBUG=False
```

### 3. Start Server

```bash
chmod +x start.sh
./start.sh
```

The server will start on `http://0.0.0.0:3001`

## API Endpoints

### Health Check
```bash
GET /health
```
Returns server status and configuration.

**Example:**
```bash
curl http://localhost:3001/health
```

**Response:**
```json
{
  "status": "healthy",
  "csv_dir": "/root/gramasub/PANTHER_SANITY",
  "csv_dir_exists": true,
  "timestamp": "2026-04-09T15:30:00"
}
```

### Get Latest CSV
```bash
GET /api/sanity-results/latest
```
Returns the most recent CSV file.

**Example:**
```bash
curl http://localhost:3001/api/sanity-results/latest
```

### Get Specific CSV
```bash
GET /api/sanity-results/:filename
```
Returns a specific CSV file.

**Example:**
```bash
curl http://localhost:3001/api/sanity-results/25.4X300-202603150112.0-EVO.csv
```

### List All CSV Files
```bash
GET /api/sanity-results
```
Returns list of all CSV files with metadata.

**Example:**
```bash
curl http://localhost:3001/api/sanity-results
```

**Response:**
```json
{
  "files": [
    {
      "name": "25.4X300-202603150112.0-EVO.csv",
      "size": 541,
      "size_human": "541 B",
      "modified": "2026-04-08T22:14:00",
      "modified_human": "2026-04-08 22:14:00"
    }
  ],
  "count": 1,
  "directory": "/root/gramasub/PANTHER_SANITY"
}
```

### Get CSV Metadata
```bash
GET /api/sanity-results/metadata/:filename
```
Returns metadata without downloading the file.

**Example:**
```bash
curl http://localhost:3001/api/sanity-results/metadata/25.4X300-202603150112.0-EVO.csv
```

**Response:**
```json
{
  "filename": "25.4X300-202603150112.0-EVO.csv",
  "platform": "SRX400",
  "image": "25.4X300-202603150112.0-EVO",
  "test_count": 9,
  "size": 541,
  "size_human": "541 B",
  "modified": "2026-04-08T22:14:00",
  "modified_human": "2026-04-08 22:14:00"
}
```

## Production Deployment

### Option 1: Systemd Service (Recommended)

1. Copy service file:
```bash
sudo cp sanity-api.service /etc/systemd/system/
```

2. Edit service file to match your paths:
```bash
sudo nano /etc/systemd/system/sanity-api.service
```

3. Reload systemd:
```bash
sudo systemctl daemon-reload
```

4. Enable and start service:
```bash
sudo systemctl enable sanity-api
sudo systemctl start sanity-api
```

5. Check status:
```bash
sudo systemctl status sanity-api
```

6. View logs:
```bash
sudo journalctl -u sanity-api -f
```

### Option 2: Screen Session

```bash
screen -S sanity-api
cd backend
./start.sh
# Press Ctrl+A then D to detach
```

Reattach:
```bash
screen -r sanity-api
```

### Option 3: nohup

```bash
cd backend
source venv/bin/activate
nohup python server.py > server.log 2>&1 &
```

## Testing

### Test Health Check
```bash
curl http://localhost:3001/health
```

### Test Latest CSV
```bash
curl http://localhost:3001/api/sanity-results/latest
```

### Test List Files
```bash
curl http://localhost:3001/api/sanity-results
```

### Test from Frontend
Update frontend `.env`:
```
REACT_APP_API_URL=http://your-server-ip:3001
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3001
sudo lsof -i :3001

# Kill the process
sudo kill -9 <PID>
```

### Permission Denied
```bash
# Make scripts executable
chmod +x install.sh start.sh server.py
```

### CSV Directory Not Found
```bash
# Check if directory exists
ls -la /root/gramasub/PANTHER_SANITY/

# Create if needed
sudo mkdir -p /root/gramasub/PANTHER_SANITY
```

### CORS Issues
The server has CORS enabled for all origins. If you need to restrict:

Edit `server.py`:
```python
CORS(app, origins=['http://your-frontend-domain.com'])
```

## Security Considerations

1. **Firewall**: Only expose port 3001 to trusted networks
2. **Authentication**: Add API key authentication if needed
3. **HTTPS**: Use nginx reverse proxy with SSL
4. **File Access**: Server validates filenames to prevent directory traversal
5. **Rate Limiting**: Consider adding rate limiting for production

## Monitoring

### Check Server Status
```bash
curl http://localhost:3001/health
```

### View Logs (systemd)
```bash
sudo journalctl -u sanity-api -f
```

### View Logs (manual)
```bash
tail -f server.log
```

## Updating

```bash
cd backend
git pull  # if using git
source venv/bin/activate
pip install -r requirements.txt --upgrade
sudo systemctl restart sanity-api  # if using systemd
```

## Uninstall

### Stop Service
```bash
sudo systemctl stop sanity-api
sudo systemctl disable sanity-api
sudo rm /etc/systemd/system/sanity-api.service
sudo systemctl daemon-reload
```

### Remove Files
```bash
cd ..
rm -rf backend
```

## Support

For issues:
1. Check logs: `sudo journalctl -u sanity-api -f`
2. Verify CSV directory exists and has files
3. Test endpoints with curl
4. Check firewall settings
5. Verify Python version (3.8+)

## License

MIT
