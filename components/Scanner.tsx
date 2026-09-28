'use client';

import { useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error';

type Props = {
  active: boolean;
  onDetected: (text: string) => void;
  onStatusChange?: (status: CameraStatus) => void;
  /** Bumped by the parent after a successful read to trigger the flash. */
  flashKey?: number;
};

type Stop = () => void;

// The Shape Detection API isn't in TypeScript's DOM types yet.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorCtor = {
  new (opts: { formats: string[] }): { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
  getSupportedFormats(): Promise<string[]>;
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

    const video = videoRef.current;
    let stream: MediaStream | undefined;
    let stopDecoder: Stop | undefined;
    let cancelled = false;
    const emit = (text: string) => onDetectedRef.current(text);

    (async () => {
      setStatus('starting');

      if (!video || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setStatus('unavailable');
        else setStatus('error');
        return;
      }
      if (cancelled) {
        stopStream(stream);
        return;
      }

      await tuneCamera(stream);

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay of a muted inline video is allowed; ignore spurious aborts */
      }
      if (cancelled) return;

      try {
        // Native detector first (Chrome on Android, and others that support it);
        // ZXing for browsers without it, such as Safari.
        stopDecoder = (await startNativeDetector(video, emit)) ?? (await startZxing(stream, video, emit));
      } catch (err) {
        console.error('Barcode decoder failed to start:', err);
        if (!cancelled) setStatus('error');
        return;
      }
      if (cancelled) {
        stopDecoder();
        return;
      }
      setStatus('scanning');
    })();

    return () => {
      cancelled = true;
      stopDecoder?.();
      stopStream(stream);
      if (video) video.srcObject = null;
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

function stopStream(stream?: MediaStream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Ask for continuous autofocus and a little zoom where the camera supports it.
 * Many phone main cameras can't focus closer than ~15 cm; 2x zoom lets you hold
 * the book at a distance they can focus on while the barcode still fills the frame.
 */
async function tuneCamera(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return;

  const caps = track.getCapabilities() as MediaTrackCapabilities & {
    focusMode?: string[];
    zoom?: { min: number; max: number };
  };
  const advanced: Record<string, unknown>[] = [];

  if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
  if (caps.zoom && caps.zoom.max >= 1.5) {
    advanced.push({ zoom: Math.min(2, caps.zoom.max) });
  }
  if (!advanced.length) return;

  try {
    await track.applyConstraints({ advanced } as MediaTrackConstraints);
  } catch {
    /* unsupported on this device; carry on with defaults */
  }
}

async function startNativeDetector(video: HTMLVideoElement, emit: (text: string) => void): Promise<Stop | null> {
  const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Detector) return null;

  try {
    const formats = await Detector.getSupportedFormats();
    if (!formats.includes('ean_13')) return null;
  } catch {
    return null;
  }

  const detector = new Detector({ formats: ['ean_13'] });
  let stopped = false;
  let timer: number | undefined;

  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        const codes = await detector.detect(video);
        if (!stopped && codes.length > 0) emit(codes[0].rawValue);
      } catch {
        /* a frame can fail while the camera is settling; try the next one */
      }
    }
    if (!stopped) timer = window.setTimeout(tick, 100);
  };
  tick();

  console.info('Barcode scanning with the native BarcodeDetector');
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

async function startZxing(stream: MediaStream, video: HTMLVideoElement, emit: (text: string) => void): Promise<Stop> {
  // Loaded on demand so browsers with the native detector never download it.
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });

  const controls = await reader.decodeFromStream(stream, video, (result) => {
    if (result) emit(result.getText());
  });

  console.info('Barcode scanning with ZXing');
  return () => controls.stop();
}
