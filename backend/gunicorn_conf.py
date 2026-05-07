"""
Gunicorn configuration — hooks for post-worker initialization.
Starts the Watchdog file watcher and DB connection pool inside each worker.
Only worker 0 runs the Watchdog to avoid duplicate ingestion.
"""
import os
import threading
import logging

logger = logging.getLogger(__name__)

# Track which workers have started watchdog
_watchdog_started = False


def post_worker_init(worker):
    """Called by Gunicorn after a worker process has been initialized."""
    global _watchdog_started

    # Initialize the DB connection pool inside this worker process
    from server import init_db_pool, DATABASE_URL
    if DATABASE_URL:
        try:
            init_db_pool()
        except Exception as e:
            logger.error(f"Failed to init DB pool in worker: {e}")

    # Only start watchdog in the first worker to avoid duplicate ingestion
    if not _watchdog_started:
        _watchdog_started = True
        _start_watchdog_thread()


def _start_watchdog_thread():
    """Start the CSV watchdog in a daemon thread inside this worker."""
    CSV_DIR = os.environ.get('CSV_DIR', '/data/csvs')

    def run_watcher():
        try:
            from server import CSVHandler
            from watchdog.observers import Observer

            handler  = CSVHandler()
            observer = Observer()
            observer.schedule(handler, CSV_DIR, recursive=False)
            observer.daemon = True
            observer.start()
            logger.info(f"Watchdog started in worker: watching {CSV_DIR}")
            # Keep thread alive — observer runs in its own threads
            observer.join()
        except Exception as e:
            logger.error(f"Watchdog thread failed: {e}")

    t = threading.Thread(target=run_watcher, daemon=True)
    t.start()
