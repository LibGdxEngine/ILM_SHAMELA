import React from 'react';

interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export default function ErrorDisplay({ message, onRetry, className = '' }: ErrorDisplayProps) {
  return (
    <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800 mb-2">
            {message}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-sm text-red-700 hover:text-red-900 font-medium underline focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
