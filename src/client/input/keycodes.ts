// src/client/input/keycodes.ts

// prettier-ignore
const KEY_ENTRIES = [
  // Letters
  ["KeyA", 0], ["KeyB", 1], ["KeyC", 2], ["KeyD", 3], ["KeyE", 4], ["KeyF", 5], ["KeyG", 6],
  ["KeyH", 7], ["KeyI", 8], ["KeyJ", 9], ["KeyK", 10], ["KeyL", 11], ["KeyM", 12], ["KeyN", 13],
  ["KeyO", 14], ["KeyP", 15], ["KeyQ", 16], ["KeyR", 17], ["KeyS", 18], ["KeyT", 19], ["KeyU", 20],
  ["KeyV", 21], ["KeyW", 22], ["KeyX", 23], ["KeyY", 24], ["KeyZ", 25],

  // Digits
  ["Digit0", 26], ["Digit1", 27], ["Digit2", 28], ["Digit3", 29], ["Digit4", 30],
  ["Digit5", 31], ["Digit6", 32], ["Digit7", 33], ["Digit8", 34], ["Digit9", 35],

  // Function keys
  ["F1", 36], ["F2", 37], ["F3", 38], ["F4", 39], ["F5", 40], ["F6", 41], ["F7", 42], ["F8", 43],
  ["F9", 44], ["F10", 45], ["F11", 46], ["F12", 47],

  // Control keys
  ["Escape", 48], ["Tab", 49], ["CapsLock", 50], ["ShiftLeft", 51], ["ShiftRight", 52],
  ["ControlLeft", 53], ["ControlRight", 54], ["AltLeft", 55], ["AltRight", 56],
  ["MetaLeft", 57], ["MetaRight", 58],
  ["Space", 59], ["Enter", 60], ["Backspace", 61], ["Delete", 62], ["Insert", 63],
  ["Home", 64], ["End", 65], ["PageUp", 66], ["PageDown", 67],

  // Arrow keys
  ["ArrowUp", 68], ["ArrowDown", 69], ["ArrowLeft", 70], ["ArrowRight", 71],

  // Symbols
  ["Minus", 72], ["Equal", 73], ["BracketLeft", 74], ["BracketRight", 75], ["Backslash", 76],
  ["Semicolon", 77], ["Quote", 78], ["Backquote", 79], ["Comma", 80], ["Period", 81], ["Slash", 82],

  // Numpad
  ["NumLock", 83], ["Numpad0", 84], ["Numpad1", 85], ["Numpad2", 86], ["Numpad3", 87], ["Numpad4", 88],
  ["Numpad5", 89], ["Numpad6", 90], ["Numpad7", 91], ["Numpad8", 92], ["Numpad9", 93],
  ["NumpadAdd", 94], ["NumpadSubtract", 95], ["NumpadMultiply", 96], ["NumpadDivide", 97],
  ["NumpadDecimal", 98], ["NumpadEnter", 99],

  // Other
  ["PrintScreen", 100], ["ScrollLock", 101], ["Pause", 102], ["ContextMenu", 103],
] as const;

export const KEY_MAP = new Map(KEY_ENTRIES);

export const REVERSE_KEY_MAP = new Map(
  KEY_ENTRIES.map(([code, id]) => [id, code]),
);

export type KeyCode = (typeof KEY_ENTRIES)[number][0];
// "KeyA" | "KeyB" | "KeyC" | ... | "ContextMenu"
