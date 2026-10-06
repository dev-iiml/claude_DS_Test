# Wordmark

Wordmark is the CreatorCo logo: the name in Newsreader at 1.35rem followed by a 6px `brand` dot, linking home.

Source: `src/components/creatorco/wordmark.tsx`.

## Use
- Top-left of every shell header; the AuthShell aside.
- `href` defaults to "/" (the dashboard passes "/dashboard"); `aria-label="CreatorCo home"`.

## Don't
It is type, not an image: don't export it as a raster, change the dot colour, or add a symbol.

_Preview: static HTML rendition styled by `components/bundle.css`._
