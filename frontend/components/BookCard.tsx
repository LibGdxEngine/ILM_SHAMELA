'use client';

import Link from 'next/link';
import { Document } from '@/lib/api';

interface BookCardProps {
  document: Document;
  formatDate: (date: string) => string;
}

// Generate a consistent color based on string hash
function stringToColor(str: string): { primary: string; secondary: string } {
  const colors = [
    { primary: '#6366f1', secondary: '#818cf8' }, // Indigo
    { primary: '#8b5cf6', secondary: '#a78bfa' }, // Violet
    { primary: '#ec4899', secondary: '#f472b6' }, // Pink
    { primary: '#14b8a6', secondary: '#2dd4bf' }, // Teal
    { primary: '#f59e0b', secondary: '#fbbf24' }, // Amber
    { primary: '#10b981', secondary: '#34d399' }, // Emerald
    { primary: '#3b82f6', secondary: '#60a5fa' }, // Blue
    { primary: '#ef4444', secondary: '#f87171' }, // Red
    { primary: '#06b6d4', secondary: '#22d3ee' }, // Cyan
    { primary: '#84cc16', secondary: '#a3e635' }, // Lime
  ];

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Generate SVG pattern for book cover
function generateCoverPattern(title: string): string {
  const colors = stringToColor(title);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="280" viewBox="0 0 200 280">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colors.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${colors.secondary};stop-opacity:1" />
        </linearGradient>
        <pattern id="pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="3" fill="rgba(255,255,255,0.1)"/>
        </pattern>
      </defs>
      <rect width="200" height="280" fill="url(#grad)"/>
      <rect width="200" height="280" fill="url(#pattern)"/>
      <g transform="translate(60, 100)">
        <path d="M80 0H10C4.477 0 0 4.477 0 10v60c0 5.523 4.477 10 10 10h70c5.523 0 10-4.477 10-10V10c0-5.523-4.477-10-10-10z" fill="rgba(255,255,255,0.2)"/>
        <path d="M75 15H15c-2.761 0-5 2.239-5 5v40c0 2.761 2.239 5 5 5h60c2.761 0 5-2.239 5-5V20c0-2.761-2.239-5-5-5z" fill="rgba(255,255,255,0.15)"/>
        <path d="M45 30v20M35 40h20" stroke="rgba(255,255,255,0.4)" stroke-width="3" stroke-linecap="round"/>
      </g>
    </svg>
  `;
}

export default function BookCard({ document, formatDate }: BookCardProps) {
  const coverSvg = generateCoverPattern(document.title);
  const coverDataUrl = `data:image/svg+xml,${encodeURIComponent(coverSvg)}`;

  return (
    <Link
      href={`/documents/${document.id}`}
      className="group block bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1"
    >
      {/* Book Cover */}
      <div className="relative aspect-[3/4] overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-105"
          style={{ backgroundImage: `url("${coverDataUrl}")` }}
        />
        
        {/* Processing Status Badge */}
        <div className="absolute top-3 right-3">
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full backdrop-blur-sm ${
              document.processed
                ? 'bg-green-500/80 text-white'
                : 'bg-yellow-500/80 text-white'
            }`}
          >
            {document.processed ? '✓ Ready' : '⏳ Processing'}
          </span>
        </div>

        {/* Language Badge */}
        {document.language && (
          <div className="absolute top-3 left-3">
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-white/80 dark:bg-gray-900/80 text-gray-800 dark:text-gray-200 backdrop-blur-sm uppercase">
              {document.language}
            </span>
          </div>
        )}
      </div>

      {/* Book Info */}
      <div className="p-4">
        {/* Title */}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white line-clamp-2 mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
          {document.title}
        </h3>

        {/* Authors */}
        {document.authors && document.authors.length > 0 && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-1">
            <span className="font-medium">By:</span> {document.authors.map(a => a.name).join(', ')}
          </p>
        )}

        {/* Categories */}
        {document.categories && document.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {document.categories.slice(0, 3).map((category) => (
              <span
                key={category}
                className="px-2 py-0.5 text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full"
              >
                {category}
              </span>
            ))}
            {document.categories.length > 3 && (
              <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full">
                +{document.categories.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Date */}
        <div className="flex items-center text-xs text-gray-500 dark:text-gray-500 pt-2 border-t border-gray-100 dark:border-gray-700">
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {formatDate(document.uploaded_at)}
        </div>
      </div>
    </Link>
  );
}
