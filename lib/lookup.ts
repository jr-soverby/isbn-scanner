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

type Partial = Omit<Book, 'isbn'> | null;

/**
 * Queries Open Library and Google Books in parallel and merges the results.
 * Open Library is preferred for bibliographic fields; Google Books usually
 * has the better description and fills gaps. Returns null if neither knows it.
 */
export async function lookupBook(isbn: string, signal?: AbortSignal): Promise<Book | null> {
  const [ol, gb] = await Promise.allSettled([fromOpenLibrary(isbn, signal), fromGoogleBooks(isbn, signal)]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

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

async function fromOpenLibrary(isbn: string, signal?: AbortSignal): Promise<Partial> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open Library responded ${res.status}`);
  const json = await res.json();
  const d = json[`ISBN:${isbn}`];
  if (!d) return null;

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

async function fromGoogleBooks(isbn: string, signal?: AbortSignal): Promise<Partial> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Google Books responded ${res.status}`);
  const json = await res.json();
  const v = json.items?.[0]?.volumeInfo;
  if (!v) return null;

  const thumb: string | undefined = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail;

  return {
    title: v.title,
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
