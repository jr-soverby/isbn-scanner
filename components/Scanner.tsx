'use client';

import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';

export type CameraStatus = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error';

type Props = {
  active: boolean;
  onDetected: (text: string) => void;
  onStatusChange?: (status: CameraStatus) => void;
  /** Bumped by the parent after a successful read to trigger the flash. */
  flashKey?: number;
};

export default function Scanner({ active, onDetected, onStatusChange, flashKey = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const onStatusRef = useRef(onStatusChange);
  const [status, setStatus] = useState<CameraStatus>('idle');

  useEffect(() => {
    onDetectedRef.current = onDetected;
    onStatusRef.current = onStatusChange;
  });

  useEffect(() => {
    onStatusRef.current?.(status);
  }, [status]);

  useEffect(() => {
    if (!active) return;

    let controls: IScannerControls | undefined;
    let cancelled = false;

    (async () => {
      setStatus('starting');

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        return;
      }

      // Loaded on demand so the static prerender never touches browser-only code.
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      if (cancelled) return;

      // Books use EAN-13. Restricting formats makes decoding faster and avoids false reads.
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });

      try {
        const c = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current ?? undefined,
          (result) => {
            if (result) onDetectedRef.current(result.getText());
          },
        );
        if (cancelled) {
          c.stop();
          return;
        }
        controls = c;
        setStatus('scanning');
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setStatus('unavailable');
        else setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
      setStatus('idle');
    };
  }, [active]);

  const live = active && (status === 'scanning' || status === 'starting');

  return (
    <div className={`viewfinder${live ? ' is-live' : ''}`}>
      <video ref={videoRef} muted playsInline aria-label="Camera preview" />
      <div className="viewfinder-frame" aria-hidden="true">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        {flashKey > 0 && <span key={flashKey} className="flash" />}
      </div>
      {!live && (
        <p className="viewfinder-hint">
          {status === 'denied'
            ? 'Camera access is blocked'
            : status === 'unavailable'
              ? 'No camera available'
              : status === 'error'
                ? 'The camera couldn’t start'
                : 'Camera is off'}
        </p>
      )}
      {status === 'starting' && <p className="viewfinder-hint">Starting camera…</p>}
    </div>
  );
}
