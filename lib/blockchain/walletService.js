import crypto from "crypto";
import { ethers } from "ethers";

const ALGORITHM       = "aes-256-gcm";
const IV_LENGTH       = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const hexKey = process.env.WALLET_ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error(
      "WALLET_ENCRYPTION_KEY must be a 64-character hex string. " +
      "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hexKey, "hex");
}

function encryptPrivateKey(plaintext) {
  const key       = getEncryptionKey();
  const iv        = crypto.randomBytes(IV_LENGTH);
  const cipher    = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv:        iv.toString("hex"),
    authTag:   authTag.toString("hex"),
    encrypted: encrypted.toString("hex"),
  });
}

export function decryptPrivateKey(encryptedPayload) {
  const key                    = getEncryptionKey();
  const { iv, authTag, encrypted } = JSON.parse(encryptedPayload);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex"),
    { authTagLength: AUTH_TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function createWallet() {
  const wallet       = ethers.Wallet.createRandom();
  const address      = wallet.address;
  const encryptedKey = encryptPrivateKey(wallet.privateKey);
  return { address, encryptedKey };
}

export function hashFileBuffer(fileBuffer) {
  const buf = Buffer.isBuffer(fileBuffer)
    ? fileBuffer
    : Buffer.from(fileBuffer);
  // return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
  return ethers.keccak256(buf);
}