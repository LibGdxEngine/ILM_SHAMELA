import Image from 'next/image';
import type { CSSProperties } from 'react';

interface LogoProps {
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
}

/** The "مكتبة عِلم" lockup — arch, book and star mark with the Arabic wordmark. */
export default function Logo({ className = 'h-10 w-auto', style, priority = false }: LogoProps) {
  return (
    <Image
      src="/brand/ilm-logo.png"
      alt="مكتبة عِلم"
      width={860}
      height={718}
      priority={priority}
      className={className}
      style={style}
    />
  );
}
