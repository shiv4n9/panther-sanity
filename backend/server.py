#!/usr/bin/env python3
"""
Panther Sanity — API Server
- Serves CSV files from the mounted CSV directory
- Auto-watches for new CSVs and ingests into PostgreSQL
- Exposes manual ingest trigger endpoint
- Provides 30-day historical data endpoint for the frontend
"""

from flask import Flask, send_file, jsonify, request
from flask_cors import CORS
import os
import re
import time
import threading
from pathlib import Path
from datetime import datetime, date, timedelta
import logging
import psycopg2
import psycopg2.extras
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ─── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ─── App Config ───────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

CSV_DIR      = os.environ.get('CSV_DIR', '/data/csvs')
PORT         = int(os.environ.get('PORT', 3001))
HOST         = os.environ.get('HOST', '0.0.0.0')
DATABASE_URL = os.environ.get('DATABASE_URL', '')

os.makedirs(CSV_DIR, exist_ok=True)

# ─── Database Helpers ─────────────────────────────────────────
def get_db():
    """Get a new database connection."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable not set")
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


def wait_for_db(retries=10, delay=3):
    """Block until Postgres is reachable (gives the db container time to start)."""
    for i in range(retries):
        try:
            conn = get_db()
            conn.close()
            logger.info("Database connection established.")
            return True
        except Exception as e:
            logger.warning(f"Waiting for database... ({i + 1}/{retries}): {e}")
            time.sleep(delay)
    logger.error("Could not connect to database after multiple retries.")
    return False


# ─── CSV Parsing ──────────────────────────────────────────────
def parse_csv_line(line: str) -> list:
    """Parse a CSV line, respecting quoted fields."""
    fields, current, in_quotes = [], '', False
    for char in line:
        if char == '"':
            in_quotes = not in_quotes
        elif char == ',' and not in_quotes:
            fields.append(current.strip())
            current = ''
        else:
            current += char
    fields.append(current.strip())
    return fields


def parse_csv_file(file_path: str) -> dict:
    """Parse a sanity CSV file into metadata + rows."""
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        lines = [l.rstrip('\n') for l in f.readlines()]

    if len(lines) < 3:
        raise ValueError(f"CSV too short: {file_path}")

    platform   = lines[0].split(',')[1].strip() if ',' in lines[0] else 'Unknown'
    image_name = lines[1].split(',')[1].strip() if ',' in lines[1] else 'Unknown'

    rows = []
    for line in lines[3:]:
        line = line.strip()
        if not line:
            continue
        fields = parse_csv_line(line)
        if len(fields) < 3:
            continue

        # Test case names may contain unquoted commas (e.g. "IPSEC VPN Throughput (S2S, PSK, AES256-GCM)")
        # Always use LAST field as throughput, SECOND-TO-LAST as parameter,
        # and join everything before as the test case name.
        throughput = fields[-1].strip()
        parameter  = fields[-2].strip()
        test_case  = ','.join(f.strip() for f in fields[:-2]).strip()

        # Skip the column header row
        if test_case.upper() == 'TESTCASE':
            continue
        if not test_case:
            continue

        cpu_match = re.search(r'CPU:\s*(\d+)%', throughput, re.IGNORECASE)
        cpu = (cpu_match.group(1) + '%') if cpu_match else None

        rows.append({
            'test_case':  test_case,
            'parameter':  parameter,
            'throughput': throughput,
            'cpu':        cpu,
            'memory':     None,   # extend when source data has it
            'shm':        None,
        })

    return {
        'platform':   platform,
        'image_name': image_name,
        'rows':       rows,
    }


def ingest_csv(file_path: str) -> dict:
    """
    Parse a CSV file and insert its rows into sanity_runs.
    Skips rows that already exist for this csv_filename + run_date.
    Returns a summary dict.
    """
    path     = Path(file_path)
    filename = path.name

    # Derive run_date from filename (YYYYMMDD) or file mtime
    date_match = re.search(r'(\d{4})(\d{2})(\d{2})', filename)
    if date_match:
        run_date = date(int(date_match.group(1)),
                        int(date_match.group(2)),
                        int(date_match.group(3)))
    else:
        mtime    = path.stat().st_mtime
        run_date = datetime.fromtimestamp(mtime).date()

    logger.info(f"Ingesting {filename} (run_date={run_date})")

    parsed  = parse_csv_file(file_path)
    rows    = parsed['rows']
    inserted = 0
    skipped  = 0

    conn = get_db()
    try:
        with conn.cursor() as cur:
            force = request.args.get('force', 'false').lower() == 'true'
            
            # Check if this file has already been ingested for this date
            cur.execute(
                "SELECT COUNT(*) FROM sanity_runs WHERE csv_filename=%s AND run_date=%s",
                (filename, run_date)
            )
            existing = cur.fetchone()[0]
            if existing > 0 and not force:
                logger.info(f"Already ingested {filename} for {run_date}, skipping.")
                return {'status': 'skipped', 'filename': filename, 'reason': 'already ingested'}

            if force and existing > 0:
                 # Delete existing rows for this file so they get cleanly re-inserted
                 cur.execute("DELETE FROM sanity_runs WHERE csv_filename=%s AND run_date=%s", (filename, run_date))

            for row in rows:
                cur.execute(
                    """
                    INSERT INTO sanity_runs
                      (run_date, test_case, parameter, throughput, cpu, memory, shm,
                       platform, image_name, csv_filename)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_date,
                        row['test_case'],
                        row['parameter'],
                        row['throughput'],
                        row['cpu'],
                        row['memory'],
                        row['shm'],
                        parsed['platform'],
                        parsed['image_name'],
                        filename,
                    )
                )
                inserted += 1

        conn.commit()
        logger.info(f"Ingested {inserted} rows from {filename}")
        return {
            'status':   'success',
            'filename': filename,
            'run_date': str(run_date),
            'inserted': inserted,
            'skipped':  skipped,
        }
    except Exception as e:
        conn.rollback()
        logger.error(f"Ingest failed for {filename}: {e}")
        raise
    finally:
        conn.close()


# ─── Watchdog ─────────────────────────────────────────────────
class CSVHandler(FileSystemEventHandler):
    """Auto-ingest newly created or moved CSV files."""

    def _handle(self, event):
        if event.is_directory:
            return
        src = getattr(event, 'dest_path', event.src_path)
        if src.endswith('.csv'):
            logger.info(f"Watchdog detected: {src}")
            try:
                ingest_csv(src)
            except Exception as e:
                logger.error(f"Auto-ingest error: {e}")

    on_created = _handle
    on_moved   = _handle


def start_watcher():
    handler  = CSVHandler()
    observer = Observer()
    observer.schedule(handler, CSV_DIR, recursive=False)
    observer.start()
    logger.info(f"Watchdog watching: {CSV_DIR}")
    return observer


# ─── Routes ───────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health_check():
    db_ok = False
    try:
        conn  = get_db()
        conn.close()
        db_ok = True
    except Exception:
        pass

    return jsonify({
        'status':       'healthy' if db_ok else 'degraded',
        'db_connected': db_ok,
        'csv_dir':      CSV_DIR,
        'timestamp':    datetime.now().isoformat()
    })


@app.route('/api/sanity-results/latest', methods=['GET'])
def get_latest():
    """Serve the most recent CSV file (raw download)."""
    try:
        csv_files = sorted(
            Path(CSV_DIR).glob('*.csv'),
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        if not csv_files:
            return jsonify({'error': 'No CSV files found'}), 404

        latest = csv_files[0]
        logger.info(f"Serving latest: {latest.name}")
        return send_file(latest, mimetype='text/csv', as_attachment=False,
                         download_name=latest.name)
    except Exception as e:
        logger.error(f"Error serving latest: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/sanity-results', methods=['GET'])
def list_files():
    """List all CSV files with metadata."""
    try:
        files = []
        for p in sorted(Path(CSV_DIR).glob('*.csv'),
                        key=lambda x: x.stat().st_mtime, reverse=True):
            st = p.stat()
            files.append({
                'name':     p.name,
                'size':     st.st_size,
                'modified': datetime.fromtimestamp(st.st_mtime).isoformat(),
            })
        return jsonify({'files': files, 'count': len(files)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/sanity-results/<filename>', methods=['GET'])
def get_file(filename):
    """Serve a specific CSV file."""
    try:
        filename  = os.path.basename(filename)
        file_path = os.path.join(CSV_DIR, filename)
        if not os.path.exists(file_path):
            return jsonify({'error': f'Not found: {filename}'}), 404
        if not filename.endswith('.csv'):
            return jsonify({'error': 'Only CSV files allowed'}), 400
        return send_file(file_path, mimetype='text/csv', as_attachment=False,
                         download_name=filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ingest', methods=['POST'])
def manual_ingest():
    """
    Manual ingest trigger.
    POST with no body → ingests the latest CSV.
    POST with JSON {"filename": "foo.csv"} → ingests that specific file.
    """
    try:
        body     = request.get_json(silent=True) or {}
        filename = body.get('filename')

        if filename:
            file_path = os.path.join(CSV_DIR, os.path.basename(filename))
        else:
            # Pick the latest CSV
            csv_files = sorted(
                Path(CSV_DIR).glob('*.csv'),
                key=lambda x: x.stat().st_mtime,
                reverse=True
            )
            if not csv_files:
                return jsonify({'error': 'No CSV files found'}), 404
            file_path = str(csv_files[0])

        if not os.path.exists(file_path):
            return jsonify({'error': f'File not found: {file_path}'}), 404

        result = ingest_csv(file_path)
        return jsonify(result), 200

    except Exception as e:
        logger.error(f"Manual ingest error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/history', methods=['GET'])
def get_history():
    """
    30-day historical data for a specific test case + parameter.
    Query params: ?test_case=...&parameter=...&days=30
    Returns daily aggregated throughput, cpu, memory, shm values.
    """
    test_case = request.args.get('test_case', '')
    parameter = request.args.get('parameter', '')
    days      = int(request.args.get('days', 30))

    if not test_case or not parameter:
        return jsonify({'error': 'test_case and parameter are required'}), 400

    since = date.today() - timedelta(days=days)

    try:
        conn = get_db()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                  run_date,
                  throughput,
                  cpu,
                  memory,
                  shm,
                  platform,
                  image_name
                FROM sanity_runs
                WHERE test_case = %s
                  AND parameter = %s
                  AND run_date  >= %s
                ORDER BY run_date ASC
                """,
                (test_case, parameter, since)
            )
            rows = cur.fetchall()
        conn.close()

        # Build response — one point per day
        history = []
        for i, row in enumerate(rows):
            history.append({
                'day':        f"Day {i + 1}",
                'date':       str(row['run_date']),
                'throughput': _extract_throughput_value(row['throughput']),
                'cpu':        row['cpu'] or 'N/A',
                'memory':     row['memory'] or 'N/A',
                'shm':        row['shm'] or 'N/A',
                'platform':   row['platform'],
                'image_name': row['image_name'],
            })

        return jsonify({
            'test_case': test_case,
            'parameter': parameter,
            'days':      days,
            'count':     len(history),
            'history':   history,
        })

    except Exception as e:
        logger.error(f"History query error: {e}")
        return jsonify({'error': str(e)}), 500


def _extract_throughput_value(throughput_str: str) -> float:
    """
    Extract a numeric Gbps value from a throughput string like
    '1.8 Gbps, CPU: 85%' or '1.75'.
    """
    if not throughput_str:
        return 0.0
    # Strip CPU annotation
    clean = re.sub(r',?\s*CPU:\s*\d+%', '', throughput_str, flags=re.IGNORECASE).strip()
    # Find first float
    m = re.search(r'[\d.]+', clean)
    return float(m.group()) if m else 0.0


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500


# ─── Entry Point ──────────────────────────────────────────────
if __name__ == '__main__':
    # Wait for Postgres before starting the server
    if DATABASE_URL:
        wait_for_db()
    else:
        logger.warning("DATABASE_URL not set — running without database support")

    # Start watchdog in a background thread
    observer = start_watcher()

    logger.info(f"Starting Panther Sanity API on http://{HOST}:{PORT}")
    try:
        app.run(
            host=HOST,
            port=PORT,
            debug=os.environ.get('DEBUG', 'false').lower() == 'true',
            use_reloader=False   # disable reloader so watchdog thread survives
        )
    finally:
        observer.stop()
        observer.join()
