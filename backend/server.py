#!/usr/bin/env python3
"""
Sanity Test Results API Server
Serves CSV files from /root/gramasub/PANTHER_SANITY/
"""

from flask import Flask, send_file, jsonify, request
from flask_cors import CORS
import os
from pathlib import Path
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configuration
CSV_DIR = os.environ.get('CSV_DIR', '/root/gramasub/PANTHER_SANITY')
PORT = int(os.environ.get('PORT', 3001))
HOST = os.environ.get('HOST', '0.0.0.0')

# Ensure CSV directory exists
if not os.path.exists(CSV_DIR):
    logger.warning(f"CSV directory does not exist: {CSV_DIR}")
    logger.info("Creating directory...")
    os.makedirs(CSV_DIR, exist_ok=True)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'csv_dir': CSV_DIR,
        'csv_dir_exists': os.path.exists(CSV_DIR),
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/sanity-results/latest', methods=['GET'])
def get_latest():
    """Get the most recent CSV file"""
    try:
        csv_files = sorted(
            Path(CSV_DIR).glob('*.csv'),
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        
        if not csv_files:
            logger.warning(f"No CSV files found in {CSV_DIR}")
            return jsonify({'error': 'No CSV files found'}), 404
        
        latest_file = csv_files[0]
        logger.info(f"Serving latest file: {latest_file.name}")
        
        return send_file(
            latest_file,
            mimetype='text/csv',
            as_attachment=False,
            download_name=latest_file.name
        )
    except Exception as e:
        logger.error(f"Error getting latest file: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sanity-results/<filename>', methods=['GET'])
def get_file(filename):
    """Get a specific CSV file by name"""
    try:
        # Sanitize filename to prevent directory traversal
        filename = os.path.basename(filename)
        file_path = os.path.join(CSV_DIR, filename)
        
        if not os.path.exists(file_path):
            logger.warning(f"File not found: {filename}")
            return jsonify({'error': f'File not found: {filename}'}), 404
        
        if not file_path.endswith('.csv'):
            logger.warning(f"Invalid file type requested: {filename}")
            return jsonify({'error': 'Only CSV files are allowed'}), 400
        
        logger.info(f"Serving file: {filename}")
        
        return send_file(
            file_path,
            mimetype='text/csv',
            as_attachment=False,
            download_name=filename
        )
    except Exception as e:
        logger.error(f"Error getting file {filename}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sanity-results', methods=['GET'])
def list_files():
    """List all available CSV files with metadata"""
    try:
        csv_files = []
        
        for file_path in Path(CSV_DIR).glob('*.csv'):
            stat = file_path.stat()
            csv_files.append({
                'name': file_path.name,
                'size': stat.st_size,
                'size_human': format_bytes(stat.st_size),
                'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                'modified_human': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
            })
        
        # Sort by modification time (newest first)
        csv_files.sort(key=lambda x: x['modified'], reverse=True)
        
        logger.info(f"Listed {len(csv_files)} CSV files")
        
        return jsonify({
            'files': csv_files,
            'count': len(csv_files),
            'directory': CSV_DIR
        })
    except Exception as e:
        logger.error(f"Error listing files: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/sanity-results/metadata/<filename>', methods=['GET'])
def get_metadata(filename):
    """Get metadata from a CSV file without downloading it"""
    try:
        filename = os.path.basename(filename)
        file_path = os.path.join(CSV_DIR, filename)
        
        if not os.path.exists(file_path):
            return jsonify({'error': f'File not found: {filename}'}), 404
        
        # Read first 3 lines to get metadata
        with open(file_path, 'r') as f:
            lines = [f.readline().strip() for _ in range(3)]
        
        platform = lines[0].split(',')[1] if len(lines) > 0 else 'Unknown'
        image = lines[1].split(',')[1] if len(lines) > 1 else 'Unknown'
        
        # Count test cases
        with open(file_path, 'r') as f:
            test_count = sum(1 for line in f) - 3  # Subtract header lines
        
        stat = Path(file_path).stat()
        
        return jsonify({
            'filename': filename,
            'platform': platform,
            'image': image,
            'test_count': test_count,
            'size': stat.st_size,
            'size_human': format_bytes(stat.st_size),
            'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            'modified_human': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
        })
    except Exception as e:
        logger.error(f"Error getting metadata for {filename}: {str(e)}")
        return jsonify({'error': str(e)}), 500

def format_bytes(bytes_size):
    """Format bytes to human readable format"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} TB"

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    logger.info(f"Starting Sanity Test API Server")
    logger.info(f"CSV Directory: {CSV_DIR}")
    logger.info(f"Server: http://{HOST}:{PORT}")
    logger.info(f"Health Check: http://{HOST}:{PORT}/health")
    
    app.run(
        host=HOST,
        port=PORT,
        debug=os.environ.get('DEBUG', 'False').lower() == 'true'
    )
