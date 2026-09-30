import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP recommended minimum for Argon2id)
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class CryptoService {
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verifyPassword(hash: string, candidate: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, candidate);
    } catch {
      return false;
    }
  }

  async hashSecret(secret: string): Promise<string> {
    return argon2.hash(secret, ARGON2_OPTIONS);
  }

  async verifySecret(hash: string, candidate: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, candidate);
    } catch {
      return false;
    }
  }

  generateSixDigitOtp(): string {
    const num = randomInt(0, 1_000_000);
    return num.toString().padStart(6, '0');
  }

  generateOpaqueToken(byteLength = 48): string {
    return randomBytes(byteLength).toString('base64url');
  }

  hashOpaqueToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  constantTimeEqualHex(hexA: string, hexB: string): boolean {
    if (hexA.length !== hexB.length) return false;
    const bufA = Buffer.from(hexA, 'hex');
    const bufB = Buffer.from(hexB, 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
