# Jazz Recovery SEO implementation notes

## Added in this source update
- Descriptive page title and meta description for the main website.
- Canonical URL uses `https://jazzrecovery.com` (apex host).
- Open Graph and Twitter card metadata for link previews.
- SoftwareApplication JSON-LD structured data with only supported product facts.
- Route-specific title, description and canonical metadata for `/privacy-policy` and `/delete-account`.
- `public/robots.txt` permits public crawling, blocks `/api/`, and points to the sitemap.
- `public/sitemap.xml` lists only the public home, privacy policy and account-deletion pages.
- Account-deletion help text now identifies the new canonical hostname and the old Pages hostname where browser-local data may also remain.

## Deliberately not included
- No private dashboard/API routes are added to the sitemap.
- No fabricated Google Play listing, ratings, reviews, contact address, or pricing claims are included in structured data.
- No Search Console ownership token is embedded. Verify the Domain property in Google Search Console using its DNS TXT record, then submit `https://jazzrecovery.com/sitemap.xml`.
- No automated backlink creation or spam submissions. Add the canonical website URL to genuine official social profiles and app/store listings when those profiles/listings are ready.
- No API origin, Worker, D1, Android, authentication, recovery-photo or location workflow changes.

## Deployment checklist
1. Run `npm ci` and `npm run build` from this directory.
2. Run `npm run test:proxy`.
3. Deploy the website to the existing Cloudflare Pages `jazz-recovery` project using its existing build settings (`npm run build`, output `dist`, root `/website/website` in the connected repository layout).
4. Verify `https://jazzrecovery.com/`, `/robots.txt`, `/sitemap.xml`, `/privacy-policy`, and `/delete-account` over HTTPS.
5. In Google Search Console, add the Domain property `jazzrecovery.com`, publish the supplied DNS TXT verification value, verify ownership, and submit the sitemap.
6. Keep the existing API origin unchanged until a complete production API and Android compatibility regression are approved.

## Validation in this review environment
- Pages API proxy tests: passed (3/3).
- XML sitemap parsing and static metadata checks: run before packaging.
- Vite production build: not run successfully because dependency installation did not complete in the review environment. Re-run on the deployment machine/CI before publishing.
