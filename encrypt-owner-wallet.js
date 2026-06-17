// encrypt-owner-wallet.js
// Encrypts the owner/admin private key using the exact same format as walletService.js
//
// Usage:
//   node encrypt-owner-wallet.js
//
// Required .env values:
//   WALLET_ENCRYPTION_KEY    — 64-char hex string (same key your app uses)
//   QUORUM_ADMIN_PRIVATE_KEY — owner private key (0x...)
//   QUORUM_ADMIN_ADDRESS     — owner wallet address (0x...)

const crypto = require("crypto");
require("dotenv").config();

// ── Constants (must match walletService.js exactly) ───────────────────────────
const ALGORITHM       = "aes-256-gcm";
const IV_LENGTH       = 12;
const AUTH_TAG_LENGTH = 16;

// ── Validate env vars ─────────────────────────────────────────────────────────
const hexKey     = process.env.WALLET_ENCRYPTION_KEY;
const privateKey = process.env.QUORUM_ADMIN_PRIVATE_KEY;
const address    = process.env.QUORUM_ADMIN_ADDRESS;

if (!hexKey || hexKey.length !== 64) {
  console.error("❌  WALLET_ENCRYPTION_KEY must be a 64-character hex string.");
  process.exit(1);
}
if (!privateKey) {
  console.error("❌  QUORUM_ADMIN_PRIVATE_KEY is missing from .env");
  process.exit(1);
}
if (!address) {
  console.error("❌  QUORUM_ADMIN_ADDRESS is missing from .env");
  process.exit(1);
}

// ── Encrypt (identical logic to encryptPrivateKey in walletService.js) ────────
const key    = Buffer.from(hexKey, "hex");
const iv     = crypto.randomBytes(IV_LENGTH);
const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
  authTagLength: AUTH_TAG_LENGTH,
});

const encrypted = Buffer.concat([
  cipher.update(privateKey, "utf8"),
  cipher.final(),
]);
const authTag = cipher.getAuthTag();

// This is the exact JSON string your app stores in the encryptedKey column
const encryptedKey = JSON.stringify({
  iv:        iv.toString("hex"),
  authTag:   authTag.toString("hex"),
  encrypted: encrypted.toString("hex"),
});

// ── Output ────────────────────────────────────────────────────────────────────
console.log("\n✅  Copy these values into your DB for the admin user row:\n");
console.log("walletAddress :", address);
console.log("encryptedKey  :", encryptedKey);
console.log("\n── SQL (update by Clerk user ID) ────────────────────────────────");
console.log(`
UPDATE "User"
SET
  "walletAddress" = '${address}',
  "encryptedKey"  = '${encryptedKey.replace(/'/g, "''")}'
WHERE "clerkUserId" = '${process.env.CLERK_USER_ID}';
`);
