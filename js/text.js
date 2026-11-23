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
  "Professional": {
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
  "Personal": {
    "Cicada": [
      "A portable art-synth, all of it designed, coded and engineered by me. It runs on a battery, with a keyboard, a small screen, and an LED cloud display, all driven by a Teensy 4.1 mounted on a custom designed PCB.",
      "At its core, cicada is a collection of synthesizer vignettes, each with simple controls and vibrant sounds. Take a look at the video above to see it in action."
    ],
    "Monk Mouth": [
      "A singing voice for the Teensy audio library. It makes sound by simulating air moving through a simulated vocal tract.",
      "It can hold a note, sing words, talk and whistle. Bubble Bob speaks with it, and so does the face here. Drag the slider above to hear it sing."
    ],
    "Third Dimension": [
      "A small 3D renderer for microcontrollers and the tiny screens they drive. I built this because I wanted an easy, adaptable, and readily reusable solution for 3D graphics on the embedded projects I work on.",
      "It's highly configurable, and super fun to mess around with, and I'm continuing to iterate and improve it for whatever 3D rendering needs I have. Give the boat above a little drag to see it in action."
    ],
    "Second Dimension": [
      "The 2D sibling of Third Dimension: a small library for posing pixel art on small embedded screens. Similar to third dimension, I wanted a easy, reusable library with a little more flexibility and extendability than simply using graphical primitives.",
      "Daedalus here is posed and drawn with it. Don't get too close or he may whack you."
    ],
    "Upright": [
      "A piano for the Teensy audio library. It uses modal synthesis to model a felt hammer striking a string, heard through a soundboard. The library allows for easily swapping the string for a metal tine or reed and the soundboard for a pickup, making the same model a Rhodes or a Wurlitzer."
    ],
    "Scrubby": [
      "A scrubber for the Teensy audio library. It plays a sound like a record under your hand: drag it somewhere and the sound races there, slowing down as it arrives.",
      "The giant above comes from Cicada, where it first lived. Click him to record something, click him again when you're done, then drag the hand to scrub through it. Nothing you record leaves your browser."
    ],
    "Chebble": [
      "Chebble is a satisfying and relaxing chess interface. All sounds are generated in real time using physically based modal synthesis.",
      "This is the same set. Grab a piece, mess around with the sound engine using the knobs in the \"synthesis\" menu, or open historical games and step through one of the classics."
    ],
    "This website!": [
      "You're here! There's no framework and no build step, just a canvas: every pixel on the page, from these words to the box around them, is drawn into a single bitmap.",
      "The demos above are the real libraries, compiled to WebAssembly: the same code that runs on a microcontroller."
    ]
  },
  "Contact": [
    "Feel free to reach out!",
    "peterdangelo729@gmail.com",
    "+1 704-941-4838"
  ]
};
