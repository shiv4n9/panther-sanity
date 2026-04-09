# Testing Database Integration

## Quick Test Guide

### 1. Start the Docker Stack

```bash
cd /opt/panther-sanity
docker-compose up -d
```

### 2. Check Container Health

```bash
# Check all containers are running
docker-compose ps

# Check backend logs
docker-compose logs -f backend

# Check database logs
docker-compose logs -f db
```

### 3. Verify Database Connection

```bash
# Test health endpoint
curl http://localhost/health

# Expected response:
# {
#   "status": "healthy",
#   "db_connected": true,
#   "csv_dir": "/data/csvs",
#   "timestamp": "2024-04-09T..."
# }
```

### 4. Ingest CSV Data

**Option A: Via API (Recommended)**
```bash
# Ingest the latest CSV file
curl -X POST http://localhost/api/ingest

# Expected response:
# {
#   "status": "success",
#   "filename": "25.4X300-202603150112.0-EVO.csv",
#   "run_date": "2024-04-08",
#   "inserted": 9,
#   "skipped": 0
# }
```

**Option B: Via Dashboard UI**
1. Open browser: `http://esstsrv2-arm`
2. Click the "Ingest Latest" button in the header
3. Wait for success message

### 5. Verify Data in Database

```bash
# Connect to PostgreSQL
docker-compose exec db psql -U sanity -d panther_sanity

# Check ingested data
SELECT COUNT(*) FROM sanity_runs;
SELECT DISTINCT test_case FROM sanity_runs;
SELECT * FROM sanity_runs LIMIT 5;

# Exit psql
\q
```

### 6. Test Historical API

```bash
# Query historical data for a specific test case
curl "http://localhost/api/history?test_case=Firewall%20Throughput&parameter=UDP%2064B&days=30"

# Expected response:
# {
#   "test_case": "Firewall Throughput",
#   "parameter": "UDP 64B",
#   "days": 30,
#   "count": 1,
#   "history": [
#     {
#       "day": "Day 1",
#       "date": "2024-04-08",
#       "throughput": 560.0,
#       "cpu": "99%",
#       "memory": "N/A",
#       "shm": "N/A",
#       "platform": "SRX400",
#       "image_name": "25.4X300-202603150112.0-EVO"
#     }
#   ]
# }
```

### 7. Test Frontend Historical View

1. Open dashboard: `http://esstsrv2-arm`
2. Click on any throughput value with CPU data (e.g., "560KPPS/376Mbps, CPU: 99%")
3. You should see the historical chart with real data from the database
4. If no data appears, check browser console (F12) for errors

## Troubleshooting

### Issue: "No historical data found"

**Cause**: Database is empty - no CSV has been ingested yet.

**Solution**:
```bash
# Check if CSV files exist
docker-compose exec backend ls -la /data/csvs

# Manually trigger ingest
curl -X POST http://localhost/api/ingest

# Check backend logs
docker-compose logs backend | grep -i ingest
```

### Issue: "Failed to load historical data: HTTP 500"

**Cause**: Database connection error or query failure.

**Solution**:
```bash
# Check database is running
docker-compose ps db

# Check database logs
docker-compose logs db

# Verify DATABASE_URL in backend
docker-compose exec backend env | grep DATABASE_URL

# Test database connection
docker-compose exec backend python -c "
import psycopg2
import os
conn = psycopg2.connect(os.environ['DATABASE_URL'])
print('✅ Database connection successful')
conn.close()
"
```

### Issue: CSV files not visible in backend

**Cause**: NFS mount not configured or CSV_DIR path incorrect.

**Solution**:
```bash
# Check if NFS mount exists on host
ls -la /mnt/panther-sanity-csv

# Check CSV_DIR environment variable
docker-compose exec backend env | grep CSV_DIR

# Check mounted volume in container
docker-compose exec backend ls -la /data/csvs

# If empty, check docker-compose.yml volumes section
# and ensure CSV_DIR in .env points to correct path
```

### Issue: Watchdog not auto-ingesting new CSVs

**Cause**: Watchdog thread not started or permission issues.

**Solution**:
```bash
# Check backend logs for watchdog messages
docker-compose logs backend | grep -i watchdog

# Expected: "Watchdog started: watching /data/csvs"

# Manually trigger ingest to test
curl -X POST http://localhost/api/ingest

# Restart backend to restart watchdog
docker-compose restart backend
```

## Data Flow Verification

### Complete End-to-End Test

1. **Add a new CSV file** (simulate daily run):
   ```bash
   # On esst-srv25 (CSV source server)
   cp /root/gramasub/PANTHER_SANITY/existing.csv \
      /root/gramasub/PANTHER_SANITY/test-$(date +%Y%m%d).csv
   ```

2. **Verify watchdog detects it**:
   ```bash
   # On esstsrv2-arm (application server)
   docker-compose logs -f backend
   # Should see: "Watchdog detected: /data/csvs/test-20240409.csv"
   # Should see: "Ingested X rows from test-20240409.csv"
   ```

3. **Check database**:
   ```bash
   docker-compose exec db psql -U sanity -d panther_sanity -c \
     "SELECT csv_filename, COUNT(*) FROM sanity_runs GROUP BY csv_filename;"
   ```

4. **Refresh dashboard**:
   - Open `http://esstsrv2-arm`
   - Click "Ingest Latest" (if watchdog didn't auto-ingest)
   - Click any throughput value to view history
   - Should see multiple data points if you have multiple days of data

## Performance Tips

### Speed up ingestion for large CSV files

```bash
# Increase Gunicorn workers (default: 4)
# Edit docker-compose.yml:
environment:
  GUNICORN_WORKERS: 8
```

### Clear old data

```bash
# Delete data older than 90 days
docker-compose exec db psql -U sanity -d panther_sanity -c \
  "DELETE FROM sanity_runs WHERE run_date < NOW() - INTERVAL '90 days';"

# Vacuum to reclaim space
docker-compose exec db psql -U sanity -d panther_sanity -c "VACUUM ANALYZE sanity_runs;"
```

### Backup database

```bash
# Create backup
docker-compose exec db pg_dump -U sanity panther_sanity > backup_$(date +%Y%m%d).sql

# Restore backup
cat backup_20240409.sql | docker-compose exec -T db psql -U sanity panther_sanity
```

## Expected Behavior

✅ **Correct**: Historical page shows real data from database
✅ **Correct**: Empty state with helpful message if no data ingested yet
✅ **Correct**: Error message with details if API fails
❌ **Incorrect**: Mock/fake data appearing (this has been removed)
❌ **Incorrect**: Silent failures with no error messages

## Monitoring

### Check ingestion status

```bash
# View all ingested files
curl http://localhost/api/sanity-results | jq '.files[] | {name, modified}'

# Check database row count
docker-compose exec db psql -U sanity -d panther_sanity -c \
  "SELECT 
    COUNT(*) as total_rows,
    COUNT(DISTINCT csv_filename) as unique_files,
    MIN(run_date) as oldest_date,
    MAX(run_date) as newest_date
   FROM sanity_runs;"
```

### Set up monitoring alerts

```bash
# Add to crontab for daily health check
0 9 * * * curl -f http://esstsrv2-arm/health || echo "Panther Sanity API is down!" | mail -s "Alert" admin@example.com
```

## Need Help?

1. Check logs: `docker-compose logs -f`
2. Check health: `curl http://localhost/health`
3. Check database: `docker-compose exec db psql -U sanity -d panther_sanity`
4. Restart services: `docker-compose restart`
5. Full reset: `docker-compose down -v && docker-compose up -d`
