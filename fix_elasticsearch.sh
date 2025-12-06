#!/bin/bash

# Script to fix Elasticsearch index and verify search functionality

set -e

echo "=========================================="
echo "Fixing Elasticsearch Index"
echo "=========================================="

# Step 1: Check Elasticsearch cluster health
echo ""
echo "Step 1: Checking Elasticsearch cluster health..."
curl -s -X GET "localhost:9200/_cluster/health?pretty" || echo "Warning: Could not connect to Elasticsearch"

# Step 2: Check current index status
echo ""
echo "Step 2: Checking current index status..."
curl -s -X GET "localhost:9200/_cat/indices?v" || echo "Warning: Could not list indices"

# Step 3: Force delete the broken index
echo ""
echo "Step 3: Force deleting broken index 'documents'..."
curl -s -X DELETE "localhost:9200/documents?pretty" || echo "Index may not exist or already deleted"

# Wait a moment for Elasticsearch to process
sleep 2

# Step 4: Verify index is deleted
echo ""
echo "Step 4: Verifying index deletion..."
curl -s -X GET "localhost:9200/_cat/indices?v" || echo "Warning: Could not list indices"

# Step 5: Recreate index and re-index documents
echo ""
echo "Step 5: Recreating index and re-indexing documents..."
docker exec search_backend python manage.py recreate_index --reindex

# Step 6: Verify index is healthy
echo ""
echo "Step 6: Verifying index is healthy..."
curl -s -X GET "localhost:9200/_cat/indices?v" || echo "Warning: Could not list indices"

# Step 7: Count documents in index
echo ""
echo "Step 7: Counting documents in index..."
curl -s -X GET "localhost:9200/documents/_count?pretty" || echo "Warning: Could not count documents"

# Step 8: Test search API endpoint
echo ""
echo "Step 8: Testing search API endpoint..."
echo "Testing with query 'test'..."
curl -s -X GET "http://localhost:8000/api/search_engine/documents/search/?q=test" | python3 -m json.tool || echo "Warning: Search API test failed"

echo ""
echo "=========================================="
echo "Elasticsearch fix completed!"
echo "=========================================="
echo ""
echo "You can now:"
echo "1. Upload documents to /backend/media/documents/"
echo "2. Search using: GET /api/search_engine/documents/search/?q=YOUR_QUERY"
echo "3. Check document status: GET /api/search_engine/documents/<id>/status/"
