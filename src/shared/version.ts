// Comparing release versions, kept separate from Electron so it can be tested.

/** True when `candidate` is a newer version than `current` ("1.2.10" > "1.2.9"). */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
