# website

Peter D'Angelo's personal site, live at https://dangelo.engineering.

Every pixel of it is drawn into one framebuffer (`js/raster.js`) and copied
to a single canvas once a frame. There is no framework and no build step:
just HTML and classic scripts.

## Running it

From the repo's root:

    python3 -m http.server 8000

then open http://localhost:8000.

## Map

- `index.html`: the page.
- `js/`: the scripts, one job each.
- `tools/`: the Cloudflare workers, the tests, and the glue that builds the
  WebAssembly.
- the other top-level folders: the compiled demos (and cicada's film).

The WebAssembly is built from sibling libraries and committed, so the site
runs without building anything.

## Tests

Each test is a script in `tools/test`, run with node, for example:

    node tools/test/wall.test.js

`wall-server.test.js` needs the graffiti wall's server running locally
(`make dev` in `tools/wall-server`).
