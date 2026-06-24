# MedTrust — Blockchain-Backed Telemedicine Platform

<div align="center">

![MedTrust Banner](public/banner2.png)

**A full-stack telemedicine platform with cryptographically verified prescriptions, private blockchain integrity, AI disease prediction, and native Android support.**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![Quorum](https://img.shields.io/badge/Blockchain-Quorum-00A86B)](https://docs.goquorum.consensys.io)
[![Prisma](https://img.shields.io/badge/ORM-Prisma-2D3748?logo=prisma)](https://prisma.io)
[![Clerk](https://img.shields.io/badge/Auth-Clerk-6C47FF?logo=clerk)](https://clerk.com)
[![Razorpay](https://img.shields.io/badge/Payments-Razorpay-02042B)](https://razorpay.com)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

</div>

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Blockchain Architecture](#blockchain-architecture)
- [How Tamper Detection Works](#how-tamper-detection-works)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Blockchain Setup](#blockchain-setup)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [AI Disease Prediction](#ai-disease-prediction)
- [Android Application](#android-application)

---

## Overview

MedTrust is a production-grade telemedicine ecosystem with three integrated components:

1. **Next.js 15 Web Application** — appointment booking, video consultation, prescription management, blockchain access control, Razorpay payments
2. **Private Quorum Blockchain** — three Solidity smart contracts that anchor prescription hashes immutably on-chain, preventing any tampering
3. **Native Android App** — Kotlin + MVVM + Firebase + Zego SDK, delivering all patient and doctor features on mobile

> Built as a final year B.Tech CSE project at Jorhat Engineering College, Assam Science and Technology University (ASTU), 2025–2026.

---

## The Problem

When a doctor generates a prescription PDF, there is currently no way for another doctor or patient to verify that the file hasn't been modified after it was created. A bad actor could:

- Change medicine names or dosages in the PDF
- Delete the file entirely from storage
- Modify the database record silently

**MedTrust solves this by anchoring the SHA-256 hash of every prescription PDF on a private Quorum blockchain. Any modification — even a single byte — produces a different hash, which is immediately detected and shown to the user.**

---

## Features

### Patient
- Browse and book appointments with verified doctors (30-minute slots)
- Video consultation via Vonage Video API
- Download cryptographically signed prescription PDFs
- Automatic tamper detection — integrity checked every time the appointment card opens
- Grant or revoke blockchain access to doctors for prescription verification
- Share prescriptions from any past appointment with any new doctor via dropdown
- Purchase credits via Razorpay (₹800 / ₹2,000)
- AI-powered disease prediction from symptom descriptions

### Doctor
- Set daily availability windows (auto-split into 30-min slots)
- Conduct video consultations
- Write and save clinical notes
- Verify prescription integrity on-chain (with hash values displayed)
- Request credit payouts
- View patient's uploaded/shared prescriptions

### Admin
- Verify or reject pending doctors (triggers on-chain approval simultaneously)
- Suspend or reinstate doctors
- Approve doctor payout requests
- Full platform monitoring

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Server Actions) |
| UI | React 19, shadcn/ui, Tailwind CSS |
| Authentication | Clerk |
| Database | Neon PostgreSQL + Prisma ORM |
| Blockchain | ConsenSys Quorum (Raft consensus) |
| Web3 | ethers.js v6 |
| File Storage | Cloudinary |
| Video Calls | Vonage Video API |
| Payments | Razorpay (INR) |
| PDF Generation | pdf-lib |
| Wallet Encryption | AES-256-GCM (Node.js crypto) |
| Android | Kotlin, MVVM, Firebase, Zego SDK |
| AI/ML | Python, TensorFlow, BiLSTM + Attention |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                    │
│         Next.js 15 Web App  │  Android (Kotlin)          │
└──────────────────┬──────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│                  APPLICATION LAYER                       │
│              30 Next.js Server Actions                   │
└──────┬───────────┬──────────────┬───────────────┬───────┘
       │           │              │               │
┌──────▼──┐  ┌─────▼────┐  ┌─────▼────┐  ┌──────▼──────┐
│  Neon   │  │Cloudinary│  │  Vonage  │  │  Razorpay   │
│Postgres │  │  (PDFs)  │  │ (Video)  │  │ (Payments)  │
└─────────┘  └──────────┘  └──────────┘  └─────────────┘
                   │
┌──────────────────▼──────────────────────────────────────┐
│                   TRUST LAYER                            │
│              Private Quorum Blockchain                   │
│   DoctorRegistry │ PatientRegistry │ HealthcareRecord   │
└─────────────────────────────────────────────────────────┘
```

---

## Blockchain Architecture

### Smart Contracts

| Contract | Address | Purpose |
|---|---|---|
| `DoctorRegistry` | `0x6824...BeF9` | Register and approve doctors on-chain |
| `PatientRegistry` | `0x38Fe...3709` | Register patients on-chain |
| `HealthcareRecord` | `0x899C...6373` | Store prescription hashes, control access |
| `AuditLog` | `0x00fF...0271` | Immutable audit trail of all operations |

### Wallet Architecture

Every user gets a silently created Ethereum wallet at onboarding. The private key is **never stored in plain text** — it is encrypted with AES-256-GCM before being written to the database.

```
User registers
      ↓
ethers.Wallet.createRandom()
      ↓
encryptPrivateKey(privateKey)  ←  32-byte master key from env
      ↓
{ iv, authTag, encrypted } stored in DB
      ↓
walletAddress stored in DB (plain text — safe)
```

The master key lives only in `WALLET_ENCRYPTION_KEY` environment variable, never in source code or database.

### End-to-End Prescription Flow

```
1. Doctor writes notes → Patient clicks Download
2. pdf-lib builds PDF in memory
3. pdfDoc.save() called ONCE → pdfBuffer
4. SHA-256(pdfBuffer) → contentHash ("0x" + hex)
5. pdfBuffer uploaded to Cloudinary → prescriptionUrl saved
6. addRecord(patientWallet, specialty, contentHash) → Quorum
7. RecordCreated event parsed → blockchainRecordId saved
8. Same pdfBuffer returned as base64 to browser → downloaded
9. Patient clicks Grant Blockchain Access
10. grantAccess(recordId, doctorWallet) → Quorum
11. Doctor clicks Verify → hasAccess() check → getRecord() → re-hash → compare
```

> ⚠️ **Critical implementation detail:** `pdfDoc.save()` is called exactly once. The same buffer is used for hashing, Cloudinary upload, and browser download. Calling `save()` twice produces different bytes (pdf-lib internal state), which caused every verification to falsely report TAMPERED — a real bug we fixed.

---

## How Tamper Detection Works

When a doctor clicks **Verify on Blockchain**:

1. `hasAccess(recordId, doctorWallet)` — checked on-chain. If false → Access Denied.
2. `getRecord(recordId)` — fetches the original `contentHash` from Quorum (immutable).
3. Prescription PDF re-fetched from Cloudinary with `Cache-Control: no-cache`.
4. SHA-256 recomputed from fetched bytes.
5. Compared against on-chain hash.

| Result | Meaning |
|---|---|
| `VERIFIED` | Hashes match. Document is authentic. |
| `VERIFIED_OFFLINE` | Quorum unreachable, DB cache used, match. |
| `TAMPERED` | File modified after anchoring. Both hashes shown. |
| `FILE_DELETED` | Cloudinary returned 404. File was deleted. |

### Three-Layer Defence

| Layer | What it protects | Can admin bypass? |
|---|---|---|
| Quorum blockchain | The canonical hash | No — blockchain is append-only |
| PostgreSQL Prescription table | Audit record | No — REVOKE DELETE applied |
| Cloudinary file | The actual PDF | Detectable — hash mismatch shown |

---

## Getting Started

### Prerequisites

- Node.js v20 LTS
- npm or yarn
- A running Quorum node (see [Blockchain Setup](#blockchain-setup))
- Neon PostgreSQL account
- Clerk account
- Cloudinary account
- Vonage Video API account
- Razorpay account (test mode is fine)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/medtrust.git
cd medtrust

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in all values (see Environment Variables section)

# Run database migrations
npx prisma migrate dev

# Lock the Prescription table (run in Neon SQL editor)
# REVOKE UPDATE, DELETE ON "Prescription" FROM your_db_user;

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Create a `.env` file in the root directory:

```env
# ── Database ──────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
DIRECT_URL=postgresql://user:password@host/dbname?sslmode=require

# ── Clerk Authentication ───────────────────────────────────
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/onboarding
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding

# ── Blockchain (Quorum) ────────────────────────────────────
QUORUM_RPC_URL=http://192.168.1.11:20000
QUORUM_CHAIN_ID=1337
QUORUM_ADMIN_PRIVATE_KEY=0x...

# ── Wallet Encryption ──────────────────────────────────────
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
WALLET_ENCRYPTION_KEY=64_character_hex_string

# ── Cloudinary ─────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ── Vonage Video ───────────────────────────────────────────
NEXT_PUBLIC_VONAGE_APPLICATION_ID=your_app_id
VONAGE_PRIVATE_KEY=lib/private.key

# ── Razorpay ───────────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=your_secret
```

---

## Database Setup

```bash
# Run all migrations
npx prisma migrate dev

# Open Prisma Studio (optional)
npx prisma studio
```

After migration, run this in your Neon SQL editor to make the Prescription table immutable:

```sql
-- Create a restricted app user
CREATE USER medtrust_app WITH PASSWORD 'strong_password';
GRANT ALL ON ALL TABLES IN SCHEMA public TO medtrust_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO medtrust_app;

-- Remove delete and update rights on Prescription only
REVOKE UPDATE, DELETE ON "Prescription" FROM medtrust_app;
```

Update `DATABASE_URL` to use `medtrust_app` credentials. Now the application cannot delete prescription records even if compromised.

---

## Blockchain Setup

### 1. Install Quorum

Follow the [ConsenSys Quorum documentation](https://docs.goquorum.consensys.io) to set up a 3-node Raft network.

### 2. Deploy Smart Contracts

```bash
cd blockchain
npm install
npx hardhat compile

# Deploy to Quorum (requires Node.js v20)
npx hardhat run scripts/deploy.js --network quorum
```

### 3. Update Contract Addresses

After deployment, update `lib/blockchain/addresses.js`:

```js
export const DEPLOYED_ADDRESSES = {
  AuditLog:         "0x...",
  DoctorRegistry:   "0x...",
  PatientRegistry:  "0x...",
  HealthcareRecord: "0x...",
};
```

### 4. Verify Deployment

```bash
npx hardhat run scripts/verify.js --network quorum
```

---

## Project Structure

```
medtrust/
├── actions/                  # Next.js Server Actions (no API routes)
│   ├── admin.js              # Doctor verification + on-chain approval
│   ├── appointments.js       # Booking, video tokens, slots
│   ├── credits.js            # Razorpay orders + payment verification
│   ├── doctor.js             # Availability, notes, completion
│   ├── onboarding.js         # Role selection + wallet creation
│   ├── patient.js            # Patient appointment queries
│   ├── prescription.js       # PDF generation, hash anchoring, verify
│   └── payout.js             # Doctor payout requests
│
├── app/                      # Next.js App Router
│   ├── (auth)/               # Sign-in, sign-up (Clerk)
│   └── (main)/
│       ├── admin/            # Admin panel
│       ├── appointments/     # Patient appointments
│       ├── doctor/           # Doctor dashboard
│       ├── doctors/          # Doctor listing + booking
│       ├── pricing/          # Credit plans
│       └── video-call/       # Vonage video room
│
├── components/
│   ├── appointment-card.jsx  # Main card with integrity banner
│   ├── header.jsx            # Navbar with credit display
│   └── pricing.jsx           # Razorpay ₹ payment cards
│
├── lib/
│   ├── blockchain/
│   │   ├── addresses.js      # Deployed contract addresses
│   │   ├── blockchainService.js  # ethers.js contract calls
│   │   └── walletService.js  # AES-256-GCM + SHA-256
│   └── prisma.js             # Prisma client singleton
│
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Migration history
│
└── public/                   # Static assets
```

---

## API Reference

All backend logic runs as Next.js Server Actions — zero HTTP API routes.

### Key Server Actions

| Action | File | Description |
|---|---|---|
| `generatePrescriptionPDF(id)` | prescription.js | Build PDF, hash, anchor on Quorum, upload to Cloudinary |
| `checkPrescriptionIntegrity(id)` | prescription.js | Auto tamper check: FILE_DELETED / TAMPERED / VERIFIED |
| `verifyPrescriptionIntegrity(id)` | prescription.js | Doctor-side verify with on-chain access check |
| `grantDoctorAccessToPrescription(id, doctorId)` | prescription.js | Patient grants on-chain access |
| `revokeDoctorAccessToPrescription(id, doctorId)` | prescription.js | Patient revokes on-chain access |
| `updateDoctorStatus(formData)` | admin.js | DB verify + `approveDoctorOnChain()` |
| `createRazorpayOrder(planId)` | credits.js | Create INR Razorpay order |
| `verifyAndCreditPayment({...})` | credits.js | HMAC verify + add credits to DB |
| `bookAppointment(formData)` | appointments.js | Book slot + deduct 2 credits + create Vonage session |
| `generateVideoToken(formData)` | appointments.js | Generate Vonage session token |

---

## AI Disease Prediction

The disease prediction module is an external Python microservice.

- **Architecture:** Bidirectional LSTM + custom Attention mechanism
- **Dataset:** Symptom2Disease
- **Accuracy:** 90.51% mean CV accuracy (5-fold), 91.83% full dataset
- **Baseline:** SVM with RBF kernel — 82–85%

### Legal Compliance (India)

The AI module is governed by:
- **Telemedicine Practice Guidelines, 2020** (MoHFW / NITI Aayog)
- **National Medical Commission Act, 2020**
- **Digital Personal Data Protection Act, 2023**

> ⚠️ All predictions are for **informational and educational purposes only**. They are **not** medical diagnoses. Always consult a qualified Registered Medical Practitioner.

---

## Android Application

The Android app provides full patient and doctor functionality on mobile.

| Component | Technology |
|---|---|
| Language | Kotlin |
| Architecture | MVVM + Clean Architecture |
| DI | Hilt |
| Auth | Firebase Authentication |
| Database | Firestore + Room (offline cache) |
| Video | Zego SDK |
| Payments | Razorpay Android SDK |
| Navigation | Jetpack Navigation |

The Android app reads blockchain data (prescription hash, record ID, verification status) from Firestore fields populated by the web backend — no direct blockchain calls from the device.

---

## Credits

Built by **Nirupam Chakraborty** as a Final Year B.Tech CSE project at Jorhat Engineering College, ASTU, 2025–2026.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
