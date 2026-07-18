// Minimal stand-in for the pieces of react-native that src/lib pure-logic
// modules reference at import time (currently just Platform.OS, used by
// recitation.ts's getSpeechRecognizer). Lets those modules run standalone
// under plain Node for verification scripts, without pulling in the real
// react-native package -- whose entry file uses Flow syntax a plain
// TypeScript/JS bundler can't parse on its own.
module.exports = {
  Platform: { OS: 'node' },
};
