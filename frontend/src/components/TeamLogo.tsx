'use client';

import { useEffect, useMemo, useState } from 'react';
import { generatedLogoFor } from '@/lib/teamProfile';

type Props = {
  /** If present, this should already be a normalized https://… or data: URL. */
  src?: string;
  /** Deterministic fallback seed — use the team owner address. */
  seed: string;
  alt?: string;
  className?: string;
};

export function TeamLogo({
  src,
  seed,
  alt = 'Team logo',
  className = 'h-12 w-12 rounded-2xl object-cover ring-1 ring-white/15',
}: Props) {
  const fallback = useMemo(() => generatedLogoFor(seed), [seed]);
  const [img, setImg] = useState(src || fallback);

  useEffect(() => {
    setImg(src || fallback);
  }, [src, fallback]);

  return (
    // Using a plain <img> avoids next/image’s remote host restrictions
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={img}
      alt={alt}
      className={className}
      onError={() => setImg(fallback)}
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
    />
  );
}
