// the page's words, written by tools/text/editor.html (python3
// tools/text/serve.py): edit there, not here. a section's text is under
// its title, a paragraph each; a section of items has each item's under
// the item's title, and an item with none shows lorem ipsum (index.html).
const TEXT = {
  "About": [
    "Hi! I'm Peter, an inventor, software engineer, and musician based in NYC. I graduated from New York University in December 2024 with a double major in Computer Science and Music Technology.",
    "I have since worked on a variety of projects, including consumer electronics with BrandNewNoise and Critter & Guitari, ambitious musical instruments like Cicada, embedded machine learning models, open source tools for others to make use of, design-forward software engineering projects developed both independently and in a team setting, and many more.",
    "Today I'm a software engineer at Sennheiser, building SoundBase, a live-audio app for touring crews and audio engineers. I'm fascinated by the intersection between music and technology, and continue to explore their combination."
  ],
  "Professional work": {
    "Sennheiser": [
      "Software Engineer, 2025–present",
      "I work with Show Code, a Sennheiser-backed startup, building SoundBase, a live-audio app for touring crews and audio engineers. I led its integration of Spectera, Sennheiser's wideband wireless system, built its device telemetry recording system, overhauled its TV channel API, and am currently managing deployments and working with the team to build out a more robust continuous integration workflow."
    ],
    "BrandNewNoise": [
      "Lead Designer, 2023–2025",
      "I designed toy instruments with the company's owner and wrote the firmware and DSP they run on. I led the software for Reverse the Curse, a lo-fi recorder that has sold over a thousand units."
    ],
    "Critter & Guitari": [
      "Product Designer and Software Engineer, 2024–2025",
      "I designed a new flagship instrument with the company's owner: its circuit boards and its firmware, from a custom driver for the SGTL5000 audio codec up to the interface. I also led a small team of assemblers manufacturing existing products."
    ]
  },
  "Personal work": {
    "Cicada": [],
    "Monk Mouth": [
      "A singing voice for the Teensy 4.1. It makes sound by simulating air moving through a tube shaped like a vocal tract, so nothing is recorded: you move a tongue, lips and lungs, and the voice is whatever comes out.",
      "It can hold a note, sing words, talk and whistle. Bubble Bob speaks with it, and so does the face here: drag the slider to hear it sing."
    ],
    "Third Dimension": [
      "A small 3D renderer for microcontrollers and the tiny screens they drive. Hand it a model and it frames it, lights it and draws it: shaded, in flat bands like a cartoon, as a wireframe, or as an outline with the hidden lines removed, like a pen drawing.",
      "Most of those screens can only turn a pixel on or off, so the shading is made of dither patterns, with ten to choose from. The mouth on Monk Mouth's face is drawn with it, and so is the ship in the bottle here: drag it, or scroll over it, to turn it."
    ],
    "Second Dimension": [
      "The 2D sibling of Third Dimension: a small library for posing pixel art on microcontrollers and the tiny screens they drive. Draw a character in pieces, pin the pieces together like a paper puppet, and it turns and draws them at any angle. It can also aim an arm at a point.",
      "Daedalus here is posed and drawn with it: his head and his four arms, a mallet in each hand. Bring your cursor within reach of an arm, or press near him, and he'll take a swing at it."
    ],
    "Upright": [
      "A piano for the Teensy 4.1. It makes sound by simulating a hammer striking a string, and the soundboard or pickup the string is heard through, so nothing is recorded: you set the strings, the hammers and the body, and the piano is whatever comes out. A grand, a toy piano, a Rhodes and a Wurlitzer are all the same model with different numbers.",
      "Every piano note on this page is played on it: the letters of my name up top, Daedalus's mallets and the keys here. Tap them, or play them on your keyboard: A to ; are the notes, Z and X change the octave and space is the pedal. Open the settings to change the piano itself."
    ],
    "This website!": [
      "You're looking at it. There's no framework and no build step, just one canvas: every pixel on the page, from these words to the box around them, is drawn into a single bitmap by the site's own code.",
      "The demos above are the real libraries, compiled to WebAssembly: the same code that runs on a microcontroller."
    ]
  },
  "Doodles": {
    "Graffiti Wall": [
      "A wall anyone can draw on. Pick a colour and a brush and draw: everyone else looking at it sees your lines as you make them, and they stay for whoever comes next.",
      "Where the wall is bigger than its window, drag with two fingers, or scroll over it, to move around."
    ]
  },
  "Contact": [
    "Feel free to reach out!",
    "peterdangelo729@gmail.com",
    "+1 704-941-4838"
  ]
};
