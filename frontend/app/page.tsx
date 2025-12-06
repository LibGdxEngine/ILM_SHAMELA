import UploadZone from '@/components/UploadZone';
import SearchInterface from '@/components/SearchInterface';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            ILM Shamela
          </h1>
          <p className="text-gray-600">
            Upload documents and search through them with ease
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Upload Documents
            </h2>
            <UploadZone />
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Search Documents
            </h2>
            <SearchInterface />
          </div>
        </div>
      </div>
    </main>
  );
}
