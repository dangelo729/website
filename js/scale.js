// --- the scale -----------------------------------------------------------------
// the scale the page plays in: one of MODES on one of KEYS in one of
// OCTAVES, the three that monk mouth's settings set (mode, key, octave;
// index.html). whatever plays a note on the page plays a degree of it,
// degree 0 its root, and asks here for the degree's note as it plays it
// (midi): the piano (js/piano.js), under the name's keys, daedalus's
// mallets and the bubble, and monk mouth's singer (js/monk.js). so a
// setting changed is in the next note any of them plays, and nothing else
// keeps a note of its own.

const Scale = {
  // the seven diatonic modes, each its seven degrees in semitones over the root
  MODES: [
    { name: 'ionian', steps: [0, 2, 4, 5, 7, 9, 11] },
    { name: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
    { name: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
    { name: 'lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
    { name: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
    { name: 'aeolian', steps: [0, 2, 3, 5, 7, 8, 10] },
    { name: 'locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  ],
  KEYS: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], // the root, semitones over c
  OCTAVES: [1, 2, 3, 4, 5],      // the root's octave: degree 0 is midi 12 * (octave + 1) + key

  mode: 3,   // the mode, an index into MODES: lydian, until the page sets it
  key: 0,    // the root, an index into KEYS: c
  octave: 3, // the root's octave, an index into OCTAVES: 4

  // degree deg's midi note in the scale as it is set now: the root at 0,
  // and every seven degrees an octave on
  midi(deg) {
    return 12 * (this.OCTAVES[this.octave] + 1) + this.key + 12 * Math.floor(deg / 7) + this.MODES[this.mode].steps[deg % 7];
  },
};
