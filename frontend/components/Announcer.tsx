import { useEffect, useRef } from 'react';

interface AnnouncerProps {
  message: string;
  priority?: 'polite' | 'assertive';
}

/**
 * Component for screen reader announcements
 * Uses aria-live region to announce dynamic content changes
 */
export default function Announcer({ message, priority = 'polite' }: AnnouncerProps) {
  const announcerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message && announcerRef.current) {
      // Clear previous message to ensure new message is announced
      announcerRef.current.textContent = '';
      // Use setTimeout to ensure the clear happens before the new message
      setTimeout(() => {
        if (announcerRef.current) {
          announcerRef.current.textContent = message;
        }
      }, 100);
    }
  }, [message]);

  return (
    <div
      ref={announcerRef}
      role="status"
      aria-live={priority}
      aria-atomic="true"
      className="sr-only"
      aria-label={message}
    />
  );
}
