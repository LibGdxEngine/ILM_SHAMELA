/**
 * Pure helper: split a string into segments at the boundaries of a set of
 * ranges. Overlapping ranges are all attributed to each affected segment.
 * Out-of-bounds values are clamped to [0, content.length]. Zero-length or
 * inverted ranges (after clamping) are silently dropped.
 *
 * Used by the entity-mention overlay to split page text into plain/marked
 * sections before injecting <mark> elements via dangerouslySetInnerHTML.
 */

export interface TextRange {
  start: number;
  end: number;
}

export interface TextSegment {
  text: string;
  /** Indices (into the original input array) of ranges that cover this segment. */
  activeRangeIndices: number[];
}

export function segmentTextWithRanges(
  content: string,
  ranges: ReadonlyArray<TextRange>,
): TextSegment[] {
  const len = content.length;

  // Clamp and validate each range, keeping the original index for attribution.
  const valid: Array<{ start: number; end: number; index: number }> = [];
  for (let i = 0; i < ranges.length; i++) {
    const start = Math.max(0, Math.min(ranges[i].start, len));
    const end = Math.max(0, Math.min(ranges[i].end, len));
    if (end > start) {
      valid.push({ start, end, index: i });
    }
  }

  if (valid.length === 0) {
    // No ranges: the whole string is a single plain segment (or empty).
    if (len === 0) return [];
    return [{ text: content, activeRangeIndices: [] }];
  }

  // Collect unique boundary positions.
  const boundaries = new Set<number>([0, len]);
  for (const r of valid) {
    boundaries.add(r.start);
    boundaries.add(r.end);
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  const segments: TextSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i];
    const segEnd = sorted[i + 1];
    if (segStart >= segEnd) continue;
    const text = content.slice(segStart, segEnd);
    const activeRangeIndices = valid
      .filter((r) => r.start <= segStart && r.end >= segEnd)
      .map((r) => r.index);
    segments.push({ text, activeRangeIndices });
  }

  return segments;
}
