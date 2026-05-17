/**
 * AES-GCM encryption for session snapshots.
 * Key derived from a random value stored in a session-scoped cookie.
 * Falls back to base64 encoding (no encryption) in non-browser environments.
 */

const COOKIE_NAME = "__imp_ekey";
const ALGO = "AES-GCM";
const KEY_LEN = 256;
const IV_LEN = 12;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

function getKeyMaterial(): string | null {
  if (!isBrowser()) return null;
  // Read from cookie
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setKeyMaterial(key: string): void {
  if (!isBrowser()) return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(key)}; path=/; SameSite=Strict; Secure`;
}

function ensureKey(): string {
  let key = getKeyMaterial();
  if (!key) {
    key = crypto.randomUUID();
    setKeyMaterial(key);
  }
  return key;
}

async function deriveCryptoKey(material: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(material.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: ALGO },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(data: string): Promise<string> {
  if (!isBrowser()) {
    // SSR fallback: base64 encode with prefix
    return "b64:" + btoa(data);
  }
  const material = ensureKey();
  const key = await deriveCryptoKey(material);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoder.encode(data)
  );
  // Format: iv:ciphertext (both base64)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return `enc:${ivB64}:${ctB64}`;
}

export async function decrypt(data: string): Promise<string> {
  if (data.startsWith("b64:")) {
    return atob(data.slice(4));
  }
  if (!data.startsWith("enc:")) {
    throw new Error("Invalid encrypted data format");
  }
  if (!isBrowser()) {
    throw new Error("Cannot decrypt in non-browser environment");
  }
  const [, ivB64, ctB64] = data.split(":");
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const material = getKeyMaterial();
  if (!material) throw new Error("Encryption key not found");
  const key = await deriveCryptoKey(material);
  const decrypted = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}
