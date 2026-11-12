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
    "Third Dimension": [],
    "Second Dimension": [],
    "Upright": [],
    "This website!": []
  },
  "Contact": [
    "Feel free to reach out!",
    "peterdangelo729@gmail.com",
    "+1 704-941-4838"
  ]
};
