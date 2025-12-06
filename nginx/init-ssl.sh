#!/bin/sh
set -e

CERT_DIR="/etc/nginx/certs"
CERT_FILE="${CERT_DIR}/selfsigned.crt"
KEY_FILE="${CERT_DIR}/selfsigned.key"

# Create certs directory if it doesn't exist
mkdir -p "${CERT_DIR}"

# Check if certificate already exists
if [ ! -f "${CERT_FILE}" ]; then
    echo "Generating self-signed SSL certificate..."
    
    # Generate self-signed certificate
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "${KEY_FILE}" \
        -out "${CERT_FILE}" \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
    
    # Set proper permissions
    chmod 600 "${KEY_FILE}"
    chmod 644 "${CERT_FILE}"
    
    echo "Self-signed SSL certificate generated successfully."
else
    echo "SSL certificate already exists, skipping generation."
fi

exit 0
