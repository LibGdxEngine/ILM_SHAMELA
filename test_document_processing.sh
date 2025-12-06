#!/bin/bash

# Script to test document upload and verify processing status
# This script helps verify that files are uploaded and processed correctly

echo "=========================================="
echo "Document Upload and Processing Test"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if backend container is running
if ! docker ps | grep -q search_backend; then
    echo -e "${RED}✗ Backend container is not running${NC}"
    exit 1
fi

# Check if celery worker is running
if ! docker ps | grep -q search_celery_worker; then
    echo -e "${YELLOW}⚠ Celery worker is not running - processing will not work${NC}"
fi

echo "1. Checking backend logs for recent uploads..."
echo "----------------------------------------"
docker logs search_backend --tail 50 | grep -E "\[UPLOAD\]|POST request received" | tail -10
echo ""

echo "2. Checking Celery worker logs for processing tasks..."
echo "----------------------------------------"
docker logs search_celery_worker --tail 50 | grep -E "\[CELERY TASK\]|\[STEP" | tail -20
echo ""

echo "3. Checking for unprocessed documents..."
echo "----------------------------------------"
docker exec search_backend python manage.py shell -c "
from search_engine.models import Document
unprocessed = Document.objects.filter(processed=False)
print(f'Unprocessed documents: {unprocessed.count()}')
for doc in unprocessed[:5]:
    print(f'  - ID: {doc.id}, Title: {doc.title}, Uploaded: {doc.uploaded_at}')
"
echo ""

echo "4. Checking recent documents status..."
echo "----------------------------------------"
docker exec search_backend python manage.py shell -c "
from search_engine.models import Document
from django.utils import timezone
from datetime import timedelta

recent = Document.objects.filter(
    uploaded_at__gte=timezone.now() - timedelta(hours=24)
).order_by('-uploaded_at')[:5]

print(f'Recent documents (last 24h): {recent.count()}')
for doc in recent:
    status = '✓' if doc.processed else '✗'
    content_len = len(doc.content) if doc.content else 0
    print(f'  {status} ID: {doc.id}, Title: {doc.title[:50]}')
    print(f'    Processed: {doc.processed}, Content: {content_len} chars, Language: {doc.language}')
"
echo ""

echo "5. Testing document status endpoint..."
echo "----------------------------------------"
# Get the latest document ID
LATEST_DOC_ID=$(docker exec search_backend python manage.py shell -c "
from search_engine.models import Document
doc = Document.objects.order_by('-id').first()
if doc:
    print(doc.id)
" 2>/dev/null | tail -1)

if [ ! -z "$LATEST_DOC_ID" ] && [ "$LATEST_DOC_ID" != "None" ]; then
    echo "Checking status for document ID: $LATEST_DOC_ID"
    docker exec search_backend curl -s "http://localhost:8000/api/search_engine/documents/${LATEST_DOC_ID}/status/" | python3 -m json.tool 2>/dev/null || echo "Could not parse JSON response"
else
    echo "No documents found to check"
fi
echo ""

echo "6. Checking Elasticsearch connection..."
echo "----------------------------------------"
docker exec search_backend python manage.py shell -c "
from elasticsearch_dsl import connections
from search_engine.documents import DocumentIndex

try:
    es = connections.get_connection()
    info = es.info()
    print(f'✓ Elasticsearch connected: {info.get(\"cluster_name\", \"unknown\")}')
    
    # Check if index exists
    index_name = DocumentIndex._index._name
    if es.indices.exists(index=index_name):
        count = es.count(index=index_name)['count']
        print(f'✓ Index \"{index_name}\" exists with {count} documents')
    else:
        print(f'✗ Index \"{index_name}\" does not exist')
except Exception as e:
    print(f'✗ Error connecting to Elasticsearch: {str(e)}')
"
echo ""

echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "To monitor logs in real-time:"
echo "  Backend:    docker logs -f search_backend"
echo "  Celery:     docker logs -f search_celery_worker"
echo ""
echo "To check a specific document status:"
echo "  curl http://localhost:8000/api/search_engine/documents/<ID>/status/"
echo ""
