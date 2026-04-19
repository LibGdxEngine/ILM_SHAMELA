import { useEffect, useRef } from 'react';

interface ReaderPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: 'wide' | 'narrow' | 'xl';
}

export default function ReaderPopover({ isOpen, onClose, children, width = 'wide' }: ReaderPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const widthClass = width === 'xl' ? 'w-[420px]' : width === 'wide' ? 'w-80' : 'w-64';

  return (
    <div
      ref={ref}
      className={`absolute bottom-full mb-2 ${widthClass} max-h-[60vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl animate-popover-in`}
      role="dialog"
    >
      {children}
    </div>
  );
}
