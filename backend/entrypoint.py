#!/usr/bin/env python3
"""
Entrypoint: starts Gunicorn with a post_worker_init hook that launches
the Watchdog CSV watcher inside each worker process — ensuring it survives
the os.execv that Gunicorn performs internally.
"""
import os
import time
import logging

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL', '')
CSV_DIR      = os.environ.get('CSV_DIR', '/data/csvs')


def wait_for_db(retries=15, delay=3):
    """Block until Postgres is reachable (reuses server.py's pool-less fallback)."""
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


if __name__ == '__main__':
    os.makedirs(CSV_DIR, exist_ok=True)

    if DATABASE_URL:
        wait_for_db()
    else:
        logger.warning("DATABASE_URL not set — no database support")

    workers = int(os.environ.get('GUNICORN_WORKERS', 4))
    port    = int(os.environ.get('PORT', 3001))

    logger.info(f"Starting Gunicorn with {workers} workers on port {port}")

    # Use subprocess instead of os.execv so we stay in control.
    # Gunicorn is configured with a post_worker_init hook (gunicorn_conf.py)
    # that starts the Watchdog inside worker 0.
    os.execv('/usr/local/bin/gunicorn', [
        'gunicorn',
        '--workers', str(workers),
        '--bind',    f'0.0.0.0:{port}',
        '--timeout', '60',
        '--config',  'gunicorn_conf.py',
        '--access-logfile', '-',
        '--error-logfile',  '-',
        'server:app'
    ])
