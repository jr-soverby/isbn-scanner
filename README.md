# Book Scanner

Scan the ISBN barcode on a book with your phone's camera and see its title, authors, cover, and description. It's a static Next.js app, so it runs entirely in the browser and deploys to GitHub Pages.

Book data comes from [Open Library](https://openlibrary.org/developers/api) and [Google Books](https://developers.google.com/books), queried in parallel and merged. Neither needs an API key. Barcode reading uses [ZXing](https://github.com/zxing-js/browser), which works in Safari as well as Chrome and Firefox.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Browsers allow camera access on `localhost` without HTTPS. To test on your phone over your local network you'll need HTTPS; `npx next dev --experimental-https` is the quickest route. Otherwise, deploy and test on Pages.

## Deploy to GitHub Pages

1. Push this project to a GitHub repo on the `main` branch.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and deploys on every push. The site will be at `https://<user>.github.io/<repo>/`.

If the repo is named `<user>.github.io` (a user site served from the root), set `NEXT_PUBLIC_BASE_PATH` to an empty string in the workflow.

## How it fits together

- `components/Scanner.tsx` opens the rear camera and decodes EAN-13 barcodes. ZXing is imported inside the effect so the static build never touches browser-only code.
- `lib/isbn.ts` validates checksums and converts ISBN-10 to ISBN-13, so misreads and non-book barcodes are rejected before any network call.
- `lib/lookup.ts` queries both services and merges them: Open Library for bibliographic fields, Google Books for the description, each filling the other's gaps.
- `app/page.tsx` ties it together and keeps the last 20 lookups in `localStorage`.

## Limits

Google Books allows a modest number of anonymous requests per day per IP. For heavier use, create an API key restricted to your Pages domain and append `&key=...` to the Google Books URL in `lib/lookup.ts`.
