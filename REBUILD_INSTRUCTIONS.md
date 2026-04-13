# Fix Date Issue - Rebuild Instructions

## Problem
The backend code has been updated to use file modification time instead of filename date, but:
1. The backend container is still running the old code
2. The database contains old records with incorrect dates

## Solution
Run these commands on the server (esst-srv2-arm):

```bash
# 1. Pull latest code
git pull

# 2. Rebuild and restart the backend container
docker-compose up -d --build backend

# 3. Clear all existing records from database
docker-compose exec db psql -U sanity -d panther_sanity -c "DELETE FROM sanity_runs;"

# 4. Verify backend is healthy
docker-compose ps
docker-compose logs backend --tail=50

# 5. Now go to the dashboard and click "Ingest Latest"
# The dates should now be correct (today's date)
```

## Verification
After clicking "Ingest Latest":
- Check the dashboard - dates should show today's date
- Click on a test case to view historical data
- The date should match when the test was actually run (file modification time)

## What Changed
- **Before**: Used date from filename (e.g., `20260315` from `25.4X300-202603150112.0-EVO.csv`)
  - This is the image build date, not test execution date
- **After**: Uses file modification time (`mtime`) as the actual test run date
  - This is when the test was actually executed

## Code Reference
See `backend/server.py` lines 140-143:
```python
# Use file modification time as the run date (when test was actually executed)
# The date in filename is the image build date, not test execution date
mtime    = path.stat().st_mtime
run_date = datetime.fromtimestamp(mtime).date()
```
