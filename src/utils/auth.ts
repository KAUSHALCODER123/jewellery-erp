import bcrypt from "bcryptjs";

const PASSWORD_HASH_ROUNDS = 12;

export function hashPassword(plaintext: string) {
  return bcrypt.hash(plaintext, PASSWORD_HASH_ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string) {
  return bcrypt.compare(plaintext, hash);
}
