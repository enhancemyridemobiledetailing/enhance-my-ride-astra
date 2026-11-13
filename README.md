# Enhance My Ride Astra preview

A separate concept website for visual review. It uses original Enhance My Ride business assets and the publicly available Astra Labs reference hero videos, with new HTML, CSS and JavaScript authored for this project.

## Local preview

Serve the `site/` directory as a static site. For example:

```sh
python3 -m http.server 8767 --directory site
```

Then open `http://127.0.0.1:8767/`.

## Deployment

The `main` branch workflow publishes `site/` to this repository's GitHub Pages project URL. The preview has `noindex` metadata and no custom domain, canonical URL, CNAME, or DNS configuration. It is not connected to `enhancemyride.com`.

The QR card route is `site/scan.html`; its main action points to `book-now.html` in this separate preview.

See [ASSET_SOURCES.md](ASSET_SOURCES.md) for footage provenance and original source URLs.
