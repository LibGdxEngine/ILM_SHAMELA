#!/bin/bash

# Test reachability between frontend and backend containers
# This script tests network connectivity from frontend to backend

echo "=========================================="
echo "Testing Frontend -> Backend Reachability"
echo "=========================================="
echo ""

# Test 1: Basic connectivity test using wget
echo "Test 1: Basic HTTP connectivity (wget)"
echo "----------------------------------------"
docker exec search_frontend wget -qO- --spider --timeout=5 http://backend:8000/api/search_engine/documents/ 2>&1 | head -5
if [ $? -eq 0 ]; then
    echo "✓ Connection successful"
else
    echo "✗ Connection failed"
fi
echo ""

# Test 2: GET request using Node.js fetch
echo "Test 2: GET request via Node.js fetch"
echo "----------------------------------------"
docker exec search_frontend node -e "
fetch('http://backend:8000/api/search_engine/documents/')
  .then(r => {
    if (r.status === 200) {
      console.log('✓ Status:', r.status, r.statusText);
    } else {
      console.log('✗ Status:', r.status, r.statusText);
    }
    return r.text();
  })
  .then(t => {
    try {
      const json = JSON.parse(t);
      console.log('Response:', JSON.stringify(json, null, 2));
    } catch(e) {
      console.log('Response (text):', t.substring(0, 200));
    }
  })
  .catch(e => console.error('✗ Error:', e.message));
"
echo ""

# Test 3: POST request using Node.js fetch
echo "Test 3: POST request via Node.js fetch"
echo "----------------------------------------"
docker exec search_frontend node -e "
fetch('http://backend:8000/api/search_engine/documents/', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({})
})
  .then(r => {
    if (r.status === 200 || r.status === 201) {
      console.log('✓ Status:', r.status, r.statusText);
    } else if (r.status === 400) {
      console.log('⚠ Status:', r.status, r.statusText, '(Validation error - expected for empty body)');
    } else {
      console.log('✗ Status:', r.status, r.statusText);
    }
    return r.text();
  })
  .then(t => {
    console.log('Response:', t.substring(0, 300));
  })
  .catch(e => console.error('✗ Error:', e.message));
"
echo ""

# Test 4: Verify backend is responding from within backend container
echo "Test 4: Backend self-test (from backend container)"
echo "----------------------------------------"
docker exec search_backend curl -s -X GET http://localhost:8000/api/search_engine/documents/ | head -3
echo ""

echo "=========================================="
echo "Reachability Test Complete"
echo "=========================================="
