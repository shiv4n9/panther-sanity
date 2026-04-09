# Database Integration Changes

## Summary

Removed mock data fallback from HistoricalExecutionDetails.jsx to ensure the application only displays real data from the PostgreSQL database.

## Changes Made

### 1. Updated `src/HistoricalExecutionDetails.jsx`

#### Removed Mock Data Generator
- **Deleted**: `generateMockHistory()` function
- **Reason**: Application should only show real database data, not fake data

#### Enhanced Error Handling
- **Before**: Silently fell back to mock data on API errors
- **After**: Shows clear error messages with actionable guidance

#### Improved Empty State UI
- **Added**: Distinct states for different scenarios:
  - **Loading**: Animated skeleton loader
  - **API Error**: Error message with "Go to Dashboard" button
  - **No Data**: Helpful message explaining data needs to be ingested
  - **Has Data**: Shows real historical chart and table

#### Better Logging
- **Added**: Console logging for API requests and responses
- **Added**: Detailed error messages showing HTTP status and error text

### 2. Created `TEST_DATABASE.md`

Comprehensive testing guide covering:
- Docker stack startup
- Health checks
- Manual and automatic CSV ingestion
- Database verification
- API testing
- Troubleshooting common issues
- Performance tips
- Monitoring setup

## User Experience Changes

### Before
```
User clicks throughput → Always sees 30 days of fake data
No way to know if database is working
```

### After
```
User clicks throughput → Sees one of:
  1. Loading spinner (while fetching)
  2. Real data from database (if available)
  3. "No data yet, click Ingest Latest" (if DB empty)
  4. Error message with details (if API fails)
```

## API Integration

The frontend now properly integrates with the backend `/api/history` endpoint:

**Request:**
```
GET /api/history?test_case=Firewall%20Throughput&parameter=UDP%2064B&days=30
```

**Response (Success):**
```json
{
  "test_case": "Firewall Throughput",
  "parameter": "UDP 64B",
  "days": 30,
  "count": 5,
  "history": [
    {
      "day": "Day 1",
      "date": "2024-04-04",
      "throughput": 560.0,
      "cpu": "99%",
      "memory": "N/A",
      "shm": "N/A",
      "platform": "SRX400",
      "image_name": "25.4X300-202603150112.0-EVO"
    },
    ...
  ]
}
```

**Response (Empty):**
```json
{
  "test_case": "Firewall Throughput",
  "parameter": "UDP 64B",
  "days": 30,
  "count": 0,
  "history": []
}
```

## Testing Checklist

- [ ] Start Docker stack: `docker-compose up -d`
- [ ] Verify health: `curl http://localhost/health`
- [ ] Ingest CSV: Click "Ingest Latest" button on dashboard
- [ ] Check database: `docker-compose exec db psql -U sanity -d panther_sanity -c "SELECT COUNT(*) FROM sanity_runs;"`
- [ ] View historical data: Click any throughput value with CPU data
- [ ] Verify chart shows real data (not mock data)
- [ ] Test empty state: Query a test case that doesn't exist in DB
- [ ] Test error state: Stop backend and try to view history

## Deployment Notes

### Environment Variables

Ensure these are set in `.env`:

```bash
# Frontend (build-time)
VITE_API_URL=

# Backend (runtime)
CSV_DIR=/data/csvs
DATABASE_URL=postgresql://sanity:password@db:5432/panther_sanity
PORT=3001
HOST=0.0.0.0
DEBUG=false
GUNICORN_WORKERS=4

# Database (runtime)
POSTGRES_DB=panther_sanity
POSTGRES_USER=sanity
POSTGRES_PASSWORD=changeme_in_production
```

### First-Time Setup

```bash
# 1. Clone repository
git clone https://github.com/shiv4n9/panther-sanity.git
cd panther-sanity

# 2. Configure environment
cp .env.example .env
nano .env  # Edit with production values

# 3. Start services
docker-compose up -d

# 4. Wait for services to be healthy
docker-compose ps

# 5. Ingest initial data
curl -X POST http://localhost/api/ingest

# 6. Verify
curl http://localhost/health
```

### Cross-Server Setup (esst-srv25 → esstsrv2-arm)

```bash
# On esstsrv2-arm, mount CSV directory from esst-srv25
sudo mkdir -p /mnt/panther-sanity-csv
sudo mount -t nfs esst-srv25:/root/gramasub/PANTHER_SANITY /mnt/panther-sanity-csv

# Update .env
echo "CSV_DIR=/mnt/panther-sanity-csv" >> .env

# Start stack
docker-compose up -d
```

## Rollback Plan

If issues occur, revert to previous version:

```bash
git log --oneline  # Find commit before changes
git checkout <commit-hash> src/HistoricalExecutionDetails.jsx
docker-compose restart frontend
```

## Future Enhancements

Potential improvements for future iterations:

1. **Real-time updates**: WebSocket connection for live data streaming
2. **Data aggregation**: Show hourly/daily/weekly aggregates
3. **Comparison view**: Compare multiple test runs side-by-side
4. **Export functionality**: Download historical data as CSV/JSON
5. **Alerting**: Email/Slack notifications for performance degradation
6. **Retention policy**: Automatic cleanup of old data
7. **Multi-platform support**: Filter by platform (SRX400 vs SRX440)

## Questions?

- Check `TEST_DATABASE.md` for troubleshooting
- Check `DEPLOYMENT_CROSS_SERVER.md` for NFS setup
- Check `README.md` for general documentation
- Check backend logs: `docker-compose logs -f backend`
