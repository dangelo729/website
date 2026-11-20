// --- favicon -----------------------------------------------------------------
// the tab's icon: three dots down its diagonal, top left to bottom right,
// in the colours a page hands it (the logo's teal, tan and mauve), on the
// paper of the end the page is nearer, the light page's paper or the dark
// page's black, right out to the icon's edges. it is drawn into a
// framebuffer of its own (js/raster.js), a tab's CSS px square at the
// screen's density, a pixel lit in a dot's colour where its middle is
// within the dot, and handed to the document's icon link as a png. each
// end's is drawn the first time it is asked for and kept. the switch
// (js/switch.js) shows it as a page starts and each time it passes the
// middle.

const FAVICON = {
  CSS: 16,                 // css px square, a tab's icon
  AT: [0.25, 0.5, 0.75],   // of the square across and down, each dot's middle, in the order of its colours
  R: 0.12,                 // of the square, a dot's radius
};

const Favicon = {
  kept: [null, null], // each end's png as a data url, light and dark, once drawn

  // the icon for the end dark is nearer (0 light, 1 dark), its dots in
  // colours, palette indexes (Framebuffer.colour's), top left first;
  // nothing where there is no canvas
  show(dark, colours) {
    const end = dark < 0.5 ? 0 : 1;
    if (!Favicon.kept[end]) Favicon.kept[end] = Favicon.draw(end, colours);
    const url = Favicon.kept[end];
    if (!url) return;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.append(link);
    }
    if (link.getAttribute('href') !== url) link.setAttribute('href', url);
  },

  // the icon for end drawn: its png as a data url, or null
  draw(end, colours) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return null;
    const n = FAVICON.CSS * Math.max(1, Math.round(window.devicePixelRatio || 1)), fb = new Framebuffer(n, n), r = FAVICON.R * n;
    FAVICON.AT.forEach((at, k) => {
      const c = at * n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 <= r * r) fb.set(x, y, colours[k]);
    });
    canvas.width = canvas.height = n;
    fb.present(ctx, end);
    return canvas.toDataURL('image/png');
  },
};
