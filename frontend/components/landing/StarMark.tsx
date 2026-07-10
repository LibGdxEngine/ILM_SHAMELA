type StarMarkProps = {
  /** Rendered width/height in px. */
  size?: number;
  className?: string;
  /** Fill of the small center hole — set to match the surface behind the mark. */
  holeColor?: string;
};

/**
 * The "مكتبة عِلم" eight-point khatim star logo mark (an 8-point star with a
 * parchment center and an inner five-point star). The star itself uses
 * `currentColor`, so color it via a text utility (e.g. `text-gold`).
 */
export default function StarMark({
  size = 34,
  className,
  holeColor = "#efe5ce",
}: StarMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M20 1 L25 11 L36 7 L31.5 18 L40 20 L31.5 22 L36 33 L25 29 L20 39 L15 29 L4 33 L8.5 22 L0 20 L8.5 18 L4 7 L15 11 Z"
        fill="currentColor"
      />
      <circle cx="20" cy="20" r="6.6" fill={holeColor} />
      <path
        d="M20 14.4 L21.4 18.2 L25.4 18.2 L22.2 20.7 L23.4 24.6 L20 22.2 L16.6 24.6 L17.8 20.7 L14.6 18.2 L18.6 18.2 Z"
        fill="currentColor"
      />
    </svg>
  );
}
