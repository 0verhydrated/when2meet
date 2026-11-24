import { hash, compare } from 'bcryptjs';

export const validDeletionPassword = value => typeof value === 'string' && [...value].length >= 8 && [...value].length <= 128;
// A fixed-length digest avoids bcrypt's 72-byte truncation, including for Korean passwords.
async function digest(password) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function hashDeletionPassword(password) { return hash(await digest(password), 10); }
export async function verifyDeletionPassword(password, stored) { return compare(await digest(password), stored); }
