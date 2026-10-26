import { useEffect, useState } from 'react';

type ArtworkFile = 'campaign' | 'characters' | 'objects' | 'charms-enemies';
const RETRY_DELAYS = [1000, 3000, 8000] as const;

/** Retry transient download failures without touching the player's game state. */
export function useArtwork(file: ArtworkFile) {
  const [load, setLoad] = useState({ attempt: 0, failed: false });
  const delay = RETRY_DELAYS[load.attempt];
  useEffect(() => {
    if (!load.failed || delay === undefined) return;
    const timer = window.setTimeout(() => {
      setLoad(previous => ({ attempt: previous.attempt + 1, failed: false }));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [load.failed, load.attempt, delay]);

  const suffix = load.attempt ? `?retry=${load.attempt}` : '';
  return {
    src: `${import.meta.env.BASE_URL}art/${file}.webp${suffix}`,
    failed: load.failed,
    onError: () => setLoad(previous => previous.failed ? previous : { ...previous, failed: true }),
    onLoad: () => setLoad(previous => previous.failed ? { ...previous, failed: false } : previous),
  };
}
