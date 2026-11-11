const korean = 'ko-KR';

for (const property of ['language', 'languages'] as const) {
  try {
    Object.defineProperty(window.navigator, property, {
      configurable: true,
      get: () => (property === 'language' ? korean : [korean, 'ko']),
    });
  } catch {
    // Some jsdom builds expose a non-configurable navigator. Tests that need Korean
    // still pass when the browser language is already ko*.
  }
}
