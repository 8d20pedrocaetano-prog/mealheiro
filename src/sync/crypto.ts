/**
 * Token encryption at rest (ARCHITECTURE §2): AES-GCM with a key derived from the PIN by
 * PBKDF2-SHA256 (600k iterations, random salt). The GCM tag doubles as the PIN check.
 */
export interface SealedSecret {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
  iterations: number;
}

export const PBKDF2_ITERATIONS = 600_000;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(
  secret: string,
  pin: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<SealedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, iterations);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(secret),
    ),
  );
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct), iterations };
}

/** Returns the secret, or null if the PIN is wrong. */
export async function unseal(s: SealedSecret, pin: string): Promise<string | null> {
  try {
    const key = await deriveKey(pin, unb64(s.salt), s.iterations);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(s.iv) as BufferSource },
      key,
      unb64(s.ct) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);
