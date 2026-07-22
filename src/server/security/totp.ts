import * as OTPAuth from "otpauth";

export interface TotpMaterial {
  secret: string;
  uri: string;
}

export function generateTotp(label: string): TotpMaterial {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: "Dropiku",
    label,
    algorithm: "SHA1",
    digits: 10,
    period: 30,
    secret,
  });
  return { secret: secret.base32, uri: totp.toString() };
}

export function totpStep(timestamp = Date.now(), periodSeconds = 30): number {
  return Math.floor(timestamp / 1000 / periodSeconds);
}

export function generateTotpCode(secret: string, timestamp = Date.now()): string {
  return new OTPAuth.TOTP({ algorithm: "SHA1", digits: 10, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp });
}

export function verifyTotp(secret: string, token: string, timestamp = Date.now()): number | null {
  if (!/^\d{10}$/u.test(token)) return null;
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 10, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  const delta = totp.validate({ token, timestamp, window: 1 });
  return delta === null ? null : totpStep(timestamp) + delta;
}
