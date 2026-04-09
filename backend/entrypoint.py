#!/usr/bin/env python3
"""
Entrypoint: starts the watchdog CSV watcher in a background thread,
then serves the Flask app via Gunicorn (production WSGI server).
"""
import os
import time
import threading
import logging
import subprocess

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL', '')
CSV_DIR      = os.environ.get('CSV_DIR', '/data/csvs')


def wait_for_db(retries=15, delay=3):
    import psycopg2
    for i in range(retries):
        try:
            conn = psycopg2.connect(DATABASE_URL)
            conn.close()
            logger.info("Database connection established.")
            return True
        except Exception as e:
            logger.warning(f"Waiting for database... ({i + 1}/{retries}): {e}")
            time.sleep(delay)
    logger.error("Could not connect to database.")
    return False


def start_watchdog():
    """Run the watchdog in a daemon thread."""
    from watchdog.observers import Observer
    from server import CSVHandler, ingest_csv
    import re
    from pathlib import Path
    from datetime import datetime, date

    handler  = CSVHandler()
    observer = Observer()
    observer.schedule(handler, CSV_DIR, recursive=False)
    observer.daemon = True
    observer.start()
    logger.info(f"Watchdog started: watching {CSV_DIR}")


if __name__ == '__main__':
    os.makedirs(CSV_DIR, exist_ok=True)

    if DATABASE_URL:
        wait_for_db()
    else:
        logger.warning("DATABASE_URL not set — no database support")

    # Start watchdog in background thread
    t = threading.Thread(target=start_watchdog, daemon=True)
    t.start()

    workers = int(os.environ.get('GUNICORN_WORKERS', 4))
    port    = int(os.environ.get('PORT', 3001))

    logger.info(f"Starting Gunicorn with {workers} workers on port {port}")

    os.execv('/usr/local/bin/gunicorn', [
        'gunicorn',
        '--workers', str(workers),
        '--bind',    f'0.0.0.0:{port}',
        '--timeout', '60',
        '--access-logfile', '-',
        '--error-logfile',  '-',
        'server:app'
    ])
