'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Scanner, { type CameraStatus } from '@/components/Scanner';
import { isEan13, normalizeIsbn } from '@/lib/isbn';
import { lookupBook, type Book } from '@/lib/lookup';

type HistoryItem = { isbn: string; title: string; authors: string[]; cover?: string };

const HISTORY_KEY = 'book-scanner:history';
const HISTORY_MAX = 20;

export default function Home() {
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [flashKey, setFlashKey] = useState(0);
  const [manual, setManual] = useState('');
  const [loadingIsbn, setLoadingIsbn] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const lastReadRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setHistory(JSON.parse(saved));
    } catch {
      /* storage unavailable: history just won't persist */
    }
  }, []);

  const saveHistory = useCallback((items: HistoryItem[]) => {
    setHistory(items);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, []);

  const lookup = useCallback(
    async (isbn: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoadingIsbn(isbn);
      setMessage(null);
      setBook(null);

      try {
        const result = await lookupBook(isbn, controller.signal);
        if (controller.signal.aborted) return;
        if (!result) {
          setMessage(`No record found for ISBN ${isbn}. Check the number, or try the ISBN printed inside the cover.`);
          return;
        }
        setBook(result);
        setHistory((prev) => {
          const next = [
            { isbn, title: result.title, authors: result.authors, cover: result.cover },
            ...prev.filter((h) => h.isbn !== isbn),
          ].slice(0, HISTORY_MAX);
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setMessage('The book services didn’t respond. Check your connection and try again.');
      } finally {
        if (abortRef.current === controller) setLoadingIsbn(null);
      }
    },
    [],
  );

  const handleDetected = useCallback(
    (text: string) => {
      // The reader fires on every frame it can decode; ignore repeats for a moment.
      const now = Date.now();
      const last = lastReadRef.current;
      if (last && last.code === text && now - last.at < 2500) return;
      lastReadRef.current = { code: text, at: now };

      const isbn = normalizeIsbn(text);
      if (!isbn) {
        if (isEan13(text)) setMessage('That barcode isn’t an ISBN. Book barcodes start with 978 or 979.');
        return;
      }

      navigator.vibrate?.(60);
      setFlashKey((k) => k + 1);
      setCameraOn(false);
      setManual(isbn);
      lookup(isbn);
    },
    [lookup],
  );

  const handleManual = (e: FormEvent) => {
    e.preventDefault();
    const isbn = normalizeIsbn(manual);
    if (!isbn) {
      setBook(null);
      setMessage('That isn’t a valid ISBN. Enter the 10 or 13 digits printed above the barcode.');
      return;
    }
    setCameraOn(false);
    lookup(isbn);
  };

  const cameraMessage =
    cameraStatus === 'denied'
      ? 'Camera access is blocked. Allow it in your browser’s site settings, or type the ISBN below.'
      : cameraStatus === 'unavailable'
        ? 'No camera was found on this device. Type the ISBN below instead.'
        : cameraStatus === 'error'
          ? 'The camera couldn’t start. Reload the page and try again.'
          : null;

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Book Scanner</h1>
        <p>Point your camera at the barcode on the back cover.</p>
      </header>

      <section className="scan" aria-label="Scanner">
        <Scanner
          active={cameraOn}
          onDetected={handleDetected}
          onStatusChange={setCameraStatus}
          flashKey={flashKey}
        />
        <div className="scan-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCameraOn((on) => !on)}>
            {cameraOn ? 'Stop camera' : book ? 'Scan another book' : 'Start camera'}
          </button>
        </div>
        {cameraMessage && <p className="notice">{cameraMessage}</p>}

        <form className="manual" onSubmit={handleManual}>
          <label htmlFor="isbn">Or type an ISBN</label>
          <div className="manual-row">
            <input
              id="isbn"
              inputMode="numeric"
              autoComplete="off"
              placeholder="978…"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button type="submit" className="btn">
              Look up
            </button>
          </div>
        </form>
      </section>

      <section className="result" aria-live="polite">
        {loadingIsbn && <p className="status">Looking up {loadingIsbn}…</p>}
        {!loadingIsbn && message && <p className="notice">{message}</p>}
        {!loadingIsbn && book && <BookCard book={book} />}
      </section>

      {history.length > 0 && (
        <section className="history">
          <div className="history-head">
            <h2>Recent scans</h2>
            <button type="button" className="link-btn" onClick={() => saveHistory([])}>
              Clear
            </button>
          </div>
          <ul>
            {history.map((h) => (
              <li key={h.isbn}>
                <button
                  type="button"
                  className="history-item"
                  onClick={() => {
                    setManual(h.isbn);
                    lookup(h.isbn);
                  }}
                >
                  {h.cover ? <img src={h.cover} alt="" /> : <span className="spine" aria-hidden="true" />}
                  <span>
                    <strong>{h.title}</strong>
                    {h.authors.length > 0 && <span className="muted">{h.authors.join(', ')}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function BookCard({ book }: { book: Book }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const facts: [string, string | number | undefined][] = [
    ['Publisher', book.publisher],
    ['Published', book.published],
    ['Pages', book.pages],
    ['ISBN', book.isbn],
  ];

  return (
    <article className="card">
      <div className="card-cover">
        {book.cover && !coverFailed ? (
          <img src={book.cover} alt={`Cover of ${book.title}`} onError={() => setCoverFailed(true)} />
        ) : (
          <div className="cover-blank" aria-hidden="true">
            <span>{book.title}</span>
          </div>
        )}
      </div>

      <div className="card-body">
        <h2 className="card-title">{book.title}</h2>
        {book.subtitle && <p className="card-subtitle">{book.subtitle}</p>}
        {book.authors.length > 0 && <p className="card-authors">{book.authors.join(', ')}</p>}

        <dl className="facts">
          {facts
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      </div>

      {book.description && <p className="card-description">{book.description}</p>}

      {book.subjects.length > 0 && (
        <ul className="subjects" aria-label="Subjects">
          {book.subjects.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}

      {book.link && (
        <a className="card-link" href={book.link} target="_blank" rel="noreferrer">
          View full record
        </a>
      )}
    </article>
  );
}
