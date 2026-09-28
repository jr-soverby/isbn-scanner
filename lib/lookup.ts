import { normalizeIsbn } from './isbn';

// Inlined at build time. Restrict the key by HTTP referrer in Google Cloud.
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_KEY;

export type Book = {
  isbn: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  published?: string;
  pages?: number;
  description?: string;
  cover?: string;
  subjects: string[];
  link?: string;
};

type Found = Omit<Book, 'isbn'> | null;

/**
 * Queries Open Library and Google Books in parallel and merges the results.
 * Open Library is preferred for bibliographic fields; Google Books usually
 * has the better description and fills gaps. Returns null if neither knows it.
 */
export async function lookupBook(isbn: string, signal?: AbortSignal): Promise<Book | null> {
  const [ol, gb] = await Promise.allSettled([fromOpenLibrary(isbn, signal), fromGoogleBooks(isbn, signal)]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (ol.status === 'rejected') console.warn('Open Library lookup failed:', ol.reason);
  if (gb.status === 'rejected') console.warn('Google Books lookup failed:', gb.reason);

  const a = ol.status === 'fulfilled' ? ol.value : null;
  const b = gb.status === 'fulfilled' ? gb.value : null;

  if (!a && !b) {
    // Both failed outright (network down, rate limit) is different from "not found".
    if (ol.status === 'rejected' && gb.status === 'rejected') {
      throw new Error('Both book services failed to respond.');
    }
    return null;
  }

  const primary = a ?? b!;
  const secondary = a ? b : null;

  return {
    isbn,
    title: primary.title || secondary?.title || 'Untitled',
    subtitle: primary.subtitle ?? secondary?.subtitle,
    authors: primary.authors.length ? primary.authors : secondary?.authors ?? [],
    publisher: primary.publisher ?? secondary?.publisher,
    published: primary.published ?? secondary?.published,
    pages: primary.pages ?? secondary?.pages,
    description: b?.description ?? a?.description,
    cover: a?.cover ?? b?.cover,
    subjects: (primary.subjects.length ? primary.subjects : secondary?.subjects ?? []).slice(0, 6),
    link: primary.link ?? secondary?.link,
  };
}

/* ---------------- Open Library ---------------- */

async function fromOpenLibrary(isbn: string, signal?: AbortSignal): Promise<Found> {
  // The bare /api/books path has been returning 404 for every ISBN since
  // mid-September 2026; /api/books.json serves the same data. If that fails
  // too, fall back to the search API, which is a separate service.
  try {
    return await fromOpenLibraryBooksApi(isbn, signal);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return await fromOpenLibrarySearch(isbn, signal);
  }
}

async function fromOpenLibraryBooksApi(isbn: string, signal?: AbortSignal): Promise<Found> {
  const url = `https://openlibrary.org/api/books.json?bibkeys=ISBN:${isbn}&jscmd=data&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open Library Books API responded ${res.status}`);
  const json = await res.json();
  const d = json[`ISBN:${isbn}`];
  if (!d) return null; // This endpoint answers an unknown ISBN with 200 {}.

  return {
    title: d.title,
    subtitle: d.subtitle,
    authors: (d.authors ?? []).map((x: { name: string }) => x.name),
    publisher: d.publishers?.[0]?.name,
    published: d.publish_date,
    pages: d.number_of_pages,
    cover: d.cover?.large ?? d.cover?.medium,
    subjects: (d.subjects ?? []).map((x: { name: string }) => x.name),
    link: d.url,
  };
}

async function fromOpenLibrarySearch(isbn: string, signal?: AbortSignal): Promise<Found> {
  const fields = 'key,title,subtitle,author_name,publisher,publish_date,number_of_pages_median,cover_i,subject';
  const url = `https://openlibrary.org/search.json?isbn=${isbn}&fields=${fields}&limit=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open Library search responded ${res.status}`);
  const json = await res.json();
  const d = json.docs?.[0];
  if (!d) return null;

  return {
    title: d.title,
    subtitle: d.subtitle,
    authors: d.author_name ?? [],
    publisher: d.publisher?.[0],
    published: d.publish_date?.[0],
    pages: d.number_of_pages_median,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    subjects: d.subject ?? [],
    link: d.key ? `https://openlibrary.org${d.key}` : undefined,
  };
}

/* ---------------- Google Books ---------------- */

type GoogleVolume = {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    infoLink?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    industryIdentifiers?: { type: string; identifier: string }[];
  };
};

async function fromGoogleBooks(isbn: string, signal?: AbortSignal): Promise<Found> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : ''}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Google Books responded ${res.status}`);
  const json = await res.json();

  // q=isbn: can fuzzy-match an unknown ISBN to an unrelated book, so only
  // accept a volume that actually lists this ISBN.
  const items: GoogleVolume[] = json.items ?? [];
  const v = items.find((item) =>
    item.volumeInfo?.industryIdentifiers?.some((id) => normalizeIsbn(id.identifier) === isbn),
  )?.volumeInfo;
  if (!v) return null;

  const thumb = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail;

  return {
    title: v.title ?? '',
    subtitle: v.subtitle,
    authors: v.authors ?? [],
    publisher: v.publisher,
    published: v.publishedDate,
    pages: v.pageCount || undefined,
    description: v.description ? stripTags(v.description) : undefined,
    cover: thumb?.replace(/^http:/, 'https:').replace('&edge=curl', ''),
    subjects: v.categories ?? [],
    link: v.infoLink,
  };
}

function stripTags(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}
