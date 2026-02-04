'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import UploadZone from '@/components/UploadZone';

export default function UploadPage() {
  const router = useRouter();
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleUploadSuccess = () => {
    setUploadSuccess(true);
    // Redirect to documents list after 2 seconds
    setTimeout(() => {
      router.push('/documents');
    }, 2000);
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Upload Documents
          </h1>
          <p className="text-gray-600">
            Upload PDF, DOC, DOCX, or TXT files to add them to the system
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-8">
          <UploadZone onUploadSuccess={handleUploadSuccess} />
        </div>

        {uploadSuccess && (
          <div className="mt-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded-lg">
            <p className="font-medium">Upload successful! Redirecting to documents list...</p>
          </div>
        )}
      </div>
    </main>
  );
}
