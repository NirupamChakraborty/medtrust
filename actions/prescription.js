"use server";

import { DEPLOYED_ADDRESSES } from "@/lib/blockchain/addresses";
import {
  addRecordOnChain,
  approveDoctorOnChain,
  getRecordFromChain,
  grantRecordAccess,
  hasAccess,
  isApprovedDoctor,
  revokeRecordAccess,
  verifyDocumentIntegrity,
} from "@/lib/blockchain/blockchainService";
import { createWallet, decryptPrivateKey, hashFileBuffer } from "@/lib/blockchain/walletService";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { v2 as cloudinary } from "cloudinary";
import { ethers } from "ethers";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Helper ────────────────────────────────────────────────────────
function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── Create Patient Wallet (call once during onboarding) ───────────
export async function createPatientWallet() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (!user) throw new Error("User not found");

  // Idempotency — don't create twice
  if (user.walletAddress) {
    return { success: true, address: user.walletAddress };
  }

  const { address, encryptedKey } = createWallet();

  await db.user.update({
    where: { clerkUserId: userId },
    data: {
      walletAddress:      address,
      encryptedWalletKey: encryptedKey,
    },
  });

  return { success: true, address };
}

// ── Create Doctor Wallet (call once during onboarding) ────────────
export async function createDoctorWallet() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (!user || user.role !== "DOCTOR") throw new Error("Unauthorized");

  if (user.walletAddress) {
    return { success: true, address: user.walletAddress };
  }

  const { address, encryptedKey } = createWallet();

  await db.user.update({
    where: { clerkUserId: userId },
    data: {
      walletAddress:      address,
      encryptedWalletKey: encryptedKey,
    },
  });

  return { success: true, address };
}

// ── Generate & Download Prescription PDF ─────────────────────────
export async function generatePrescriptionPDF(appointmentId) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (!user || user.role !== "PATIENT") throw new Error("Unauthorized");

  const appointment = await db.appointment.findUnique({
    where:   { id: appointmentId, patientId: user.id },
    include: { doctor: true, patient: true },
  });

  if (!appointment) throw new Error("Appointment not found");
  if (!appointment.notes) throw new Error("No prescription notes available yet");

  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const emerald = rgb(0.063, 0.725, 0.506);
  const dark    = rgb(0.1, 0.1, 0.1);
  const gray    = rgb(0.45, 0.45, 0.45);

  // Header
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: emerald });
  page.drawText("MedTrust", {
    x: 40, y: height - 45, size: 26, font: boldFont, color: rgb(1, 1, 1),
  });
  page.drawText("Prescription / Clinical Notes", {
    x: 40, y: height - 65, size: 11, font: regularFont, color: rgb(0.85, 1, 0.9),
  });

  // Doctor info
  let y = height - 110;
  page.drawText(`Prescribing Doctor: Dr. ${appointment.doctor.name}`, {
    x: 40, y, size: 11, font: boldFont, color: dark,
  });
  y -= 16;
  page.drawText(`Specialty: ${appointment.doctor.specialty || "General"}`, {
    x: 40, y, size: 10, font: regularFont, color: gray,
  });
  y -= 14;
  page.drawText(
    `Date: ${new Date(appointment.startTime).toLocaleDateString("en-IN", { dateStyle: "long" })}`,
    { x: 40, y, size: 10, font: regularFont, color: gray }
  );

  // Divider
  y -= 16;
  page.drawLine({
    start: { x: 40, y }, end: { x: width - 40, y },
    thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
  });

  // Patient info
  y -= 20;
  page.drawText("Patient", { x: 40, y, size: 10, font: boldFont, color: emerald });
  y -= 15;
  page.drawText(appointment.patient.name, { x: 40, y, size: 11, font: regularFont, color: dark });

  // Chief complaint
  if (appointment.patientDescription) {
    y -= 28;
    page.drawText("Chief Complaint", { x: 40, y, size: 10, font: boldFont, color: emerald });
    y -= 15;
    for (const line of wrapText(appointment.patientDescription, 75)) {
      page.drawText(line, { x: 40, y, size: 10, font: regularFont, color: dark });
      y -= 14;
    }
  }

  // Notes
  y -= 14;
  page.drawText("Clinical Notes / Prescription", {
    x: 40, y, size: 10, font: boldFont, color: emerald,
  });
  const noteLines = wrapText(appointment.notes, 75);
  y -= 6;
  page.drawRectangle({
    x:           40,
    y:           y - noteLines.length * 14 - 16,
    width:       width - 80,
    height:      noteLines.length * 14 + 20,
    color:       rgb(0.96, 1, 0.98),
    borderColor: rgb(0.8, 0.95, 0.87),
    borderWidth: 0.5,
  });
  y -= 14;
  for (const line of noteLines) {
    page.drawText(line, { x: 48, y, size: 10, font: regularFont, color: dark });
    y -= 14;
  }

  // ── Footer placeholder (drawn before hashing so it's part of the hashed bytes) ──
  // We write a placeholder footer first, then hash the final PDF, then add the real hash text.
  // To keep it simple and correct: draw footer WITHOUT the hash text, save → hash → then
  // write hash text into the footer on a fresh save. BUT pdf-lib doesn't support editing
  // after save. The correct pattern is: draw everything INCLUDING a placeholder, save once,
  // hash those bytes, store that hash. The patient downloads those exact bytes → hashes match.
  //
  // So: draw the footer now (with "Pending..." placeholder), save → hash → that IS the PDF.
  // The hash IS of the final PDF the patient downloads.

  y = 60;
  page.drawLine({
    start: { x: 40, y: y + 20 }, end: { x: width - 40, y: y + 20 },
    thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
  });
  page.drawText("Generated by MedTrust. Any tampering will invalidate the blockchain hash.", {
    x: 40, y: y + 8, size: 7, font: regularFont, color: gray,
  });
  page.drawText("Verify authenticity at medtrust.app/verify", {
    x: 40, y: y - 4, size: 6, font: regularFont, color: gray,
  });

  // ── Hash the FINAL PDF bytes (footer already drawn) ───────────────
  const pdfBytes  = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  // contentHash is what gets stored on-chain as the source of truth.
  // We no longer store it in the DB — the blockchain record IS the source of truth.
  const contentHash = hashFileBuffer(pdfBuffer); // "0x" + sha256 hex

  // ── Upload to Cloudinary immediately ─────────────────────────────
  // We upload at generation time so:
  //   1. The patient downloads directly from this permanent URL (no base64 in memory)
  //   2. The same URL is shared with doctors — they fetch and verify from the same source
  //   3. No re-upload step needed; uploadPrescriptionToDoctor just copies this URL to the appointment
  const uploadResult = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder:        "medtrust/prescriptions",
        public_id:     `prescription_${appointmentId}`,
        format:        "pdf",
        overwrite:     true, // idempotent — re-generating replaces the same file
      },
      (error, result) => {
        if (error) reject(new Error("Cloudinary upload failed: " + error.message));
        else resolve(result);
      }
    ).end(pdfBuffer);
  });
  const prescriptionUrl = uploadResult.secure_url;

  // ── Anchor hash on Quorum blockchain ─────────────────────────────
  let onChainRecordId = null;
  let txHash          = null;

  try {
    const doctor = await db.user.findUnique({
      where:  { id: appointment.doctorId },
      select: { encryptedWalletKey: true, walletAddress: true },
    });
    const patient = await db.user.findUnique({
      where:  { id: appointment.patientId },
      select: { walletAddress: true },
    });

    if (!doctor?.encryptedWalletKey) {
      console.warn("[generatePrescriptionPDF] Doctor has no wallet key — skipping blockchain anchor");
    } else if (!patient?.walletAddress) {
      console.warn("[generatePrescriptionPDF] Patient has no wallet address — skipping blockchain anchor");
    } else {
      const decryptedKey = decryptPrivateKey(doctor.encryptedWalletKey);

      // Doctor must be approved on-chain. This should already be done at admin approval
      // time (see admin action), but we guard here as a safety net.
      const alreadyApproved = await isApprovedDoctor(doctor.walletAddress);
      if (!alreadyApproved) {
        console.warn(`[generatePrescriptionPDF] Doctor ${doctor.walletAddress} not yet approved on-chain — approving now as fallback`);
        await approveDoctorOnChain(doctor.walletAddress);
      }

// contentHash (Keccak-256 of the PDF bytes) is stored on-chain as `ipfsHash`.
// During verification: re-fetch the Cloudinary URL → recompute Keccak-256 → compare to record.ipfsHash.
      const result = await addRecordOnChain(
        decryptedKey,
        patient.walletAddress,
        `Prescription - ${appointment.doctor.specialty || "General"}`,
        contentHash   // ← hash stored on-chain; this IS the source of truth
      );
      txHash = result.txHash;

      // Parse RecordCreated event to get the record ID (race-condition safe)
      const RECORD_CREATED_TOPIC = ethers.id("RecordCreated(uint256,address,address,string)");
      const provider = new ethers.JsonRpcProvider(process.env.QUORUM_RPC_URL, {
        chainId: Number(process.env.QUORUM_CHAIN_ID) || 1337,
        name:    "quorum",
      });
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        const eventLog = receipt.logs.find(
          (log) => log.topics[0] === RECORD_CREATED_TOPIC
        );
        if (eventLog) {
          onChainRecordId = Number(BigInt(eventLog.topics[1]));
        }
      }
      if (onChainRecordId === null) {
        console.warn("[generatePrescriptionPDF] Could not parse RecordCreated event, falling back to recordCount()");
        const contract = new ethers.Contract(
          DEPLOYED_ADDRESSES.HealthcareRecord,
          ["function recordCount() external view returns (uint)"],
          provider
        );
        onChainRecordId = Number(await contract.recordCount());
      }

      console.log(`[generatePrescriptionPDF] Anchored: txHash=${txHash} recordId=${onChainRecordId} hash=${contentHash}`);
    }
  } catch (blockchainError) {
    console.error("[generatePrescriptionPDF] Blockchain error:", blockchainError.message);
    console.error("[generatePrescriptionPDF] Full error:", blockchainError);
  }

  // ── Save to DB ────────────────────────────────────────────────────
  // prescriptionUrl: permanent Cloudinary URL, used for download + doctor sharing
  // prescriptionHash: kept as DB cache of the on-chain hash (useful if chain is unreachable)
  // blockchainRecordId + blockchainTxHash: the on-chain anchor
  await db.appointment.update({
    where: { id: appointmentId },
    data: {
      prescriptionUrl:    prescriptionUrl,
      prescriptionHash:   contentHash,
      blockchainTxHash:   txHash ?? null,
      blockchainRecordId: onChainRecordId !== null ? String(onChainRecordId) : null,
    },
  });

  // ── Write to immutable Prescription ledger ────────────────────
  // upsert so re-generating the same prescription is idempotent.
  // The application DB user should have REVOKE DELETE/UPDATE on this table
  // so even the admin cannot erase this record.
  await db.prescription.upsert({
    where:  { appointmentId },
    create: {
      appointmentId,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      cloudinaryUrl:prescriptionUrl,
      // sha256Hash:        contentHash,
      keccakHash: contentHash,
      blockchainTxHash: txHash ?? null,
      blockchainRecordId: onChainRecordId !== null ? String(onChainRecordId) : null,
    },
    update: {
      // Only update the blockchain fields if they were missing on first generation
      // (e.g. Quorum was down, then came back up on re-generate).
      // Never update cloudinaryUrl or sha256Hash — those are the original values.
      blockchainTxHash:   txHash ?? undefined,
      blockchainRecordId: onChainRecordId !== null ? String(onChainRecordId) : undefined,
    },
  });

  return {
    success:  true,
    url:      prescriptionUrl,    // patient downloads directly from this URL
    hash:     contentHash,
    txHash,
    recordId: onChainRecordId,
    fileName: `prescription_${appointmentId}.pdf`,
  };
}

export async function uploadPrescriptionToDoctor(formData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where:  { clerkUserId: userId },
    select: { id: true, role: true, encryptedWalletKey: true },
  });
  if (!user || user.role !== "PATIENT") throw new Error("Unauthorized");

  const appointmentId       = formData.get("appointmentId");
  const sourceAppointmentId = formData.get("sourceAppointmentId") || appointmentId;

  if (!appointmentId) throw new Error("Appointment ID is required");

  // Fetch the source appointment — the one whose prescription is being shared
  const sourceAppointment = await db.appointment.findUnique({
    where:  { id: sourceAppointmentId, patientId: user.id },
    select: {
      prescriptionUrl:    true,
      blockchainRecordId: true,
      prescriptionHash:   true,   // fallback if chain unreachable
    },
  });
  if (!sourceAppointment?.prescriptionUrl) {
    throw new Error("No prescription found. Ask your doctor to generate the prescription first.");
  }

  const targetAppointment = await db.appointment.findUnique({
    where:  { id: appointmentId, patientId: user.id },
    select: { id: true },
  });
  if (!targetAppointment) throw new Error("Appointment not found");

  // ── Step 1: Integrity check before sharing ────────────────────────
  // Fetch canonical hash from chain and compare against the live Cloudinary file.
  // If they don't match the file has been tampered — we refuse to share it.
  let onChainHash    = null;
  let recomputedHash = null;

  if (sourceAppointment.blockchainRecordId) {
    if (user?.encryptedWalletKey) {
      try {
        const decryptedKey = decryptPrivateKey(user.encryptedWalletKey);
        // Patient always has access (access[recordId][patient] = true set by addRecord)
        const record = await getRecordFromChain(
          decryptedKey,
          Number(sourceAppointment.blockchainRecordId)
        );
        onChainHash = record.ipfsHash;

        const { match, recomputedHash: rh } = await verifyDocumentIntegrity(
          sourceAppointment.prescriptionUrl,
          onChainHash
        );
        recomputedHash = rh;

        if (!match) {
          throw new Error(
            "Integrity check failed: the prescription file does not match the blockchain record. " +
            "It may have been tampered with and cannot be shared."
          );
        }
      } catch (err) {
        // Re-throw tamper errors; only swallow chain connectivity errors
        if (err.message.startsWith("Integrity check failed")) throw err;
        console.warn("[uploadPrescriptionToDoctor] Chain unreachable, falling back to DB hash:", err.message);

        // Fallback: verify against DB-cached hash
        if (sourceAppointment.prescriptionHash) {
          const { match, recomputedHash: rh } = await verifyDocumentIntegrity(
            sourceAppointment.prescriptionUrl,
            sourceAppointment.prescriptionHash
          );
          recomputedHash = rh;
          if (!match) {
            throw new Error(
              "Integrity check failed (offline): prescription does not match the stored hash."
            );
          }
        }
      }
    }
  } else if (sourceAppointment.prescriptionHash) {
    // No chain record yet — verify against DB-cached hash
    const { match, recomputedHash: rh } = await verifyDocumentIntegrity(
      sourceAppointment.prescriptionUrl,
      sourceAppointment.prescriptionHash
    );
    recomputedHash = rh;
    if (!match) {
      throw new Error("Integrity check failed: prescription does not match the stored hash.");
    }
  }

  // ── Step 2: Link to target appointment ───────────────────────────
  // Copy the Cloudinary URL AND the source blockchain record ID to the target
  // appointment so verifyPrescriptionIntegrity can look up the right on-chain record.
  // Also copy prescriptionHash so the DB fallback works if chain is unreachable
  // during doctor-side verification.
  await db.appointment.update({
    where: { id: appointmentId },
    data: {
      uploadedPrescriptionUrl:  sourceAppointment.prescriptionUrl,
      uploadedPrescriptionHash: recomputedHash ?? null,
      // These allow verifyPrescriptionIntegrity to find the correct on-chain record
      // even when this is a cross-doctor share (target appointment had no blockchain data)
      blockchainRecordId: sourceAppointment.blockchainRecordId ?? null,
      prescriptionHash:   sourceAppointment.prescriptionHash   ?? null,
    },
  });

  return {
    success:    true,
    url:        sourceAppointment.prescriptionUrl,
    onChainHash,
    recomputedHash,
  };
}

// ── Grant blockchain access to a doctor ──────────────────────────
export async function grantDoctorAccessToPrescription(appointmentId, targetDoctorId) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const patient = await db.user.findUnique({
    where:  { clerkUserId: userId },
    select: { encryptedWalletKey: true, id: true },
  });
  if (!patient?.encryptedWalletKey) {
    throw new Error("Patient wallet not found. Please complete onboarding.");
  }

  const targetDoctor = await db.user.findUnique({
    where:  { id: targetDoctorId },
    select: { walletAddress: true },
  });
  if (!targetDoctor?.walletAddress) throw new Error("Doctor wallet not found");

  const appointment = await db.appointment.findUnique({
    where:  { id: appointmentId, patientId: patient.id },
    select: { blockchainRecordId: true },
  });
  if (!appointment?.blockchainRecordId) {
    throw new Error("No blockchain record found. Download the prescription first.");
  }

  const decryptedKey = decryptPrivateKey(patient.encryptedWalletKey);

  const { txHash } = await grantRecordAccess(
    decryptedKey,
    Number(appointment.blockchainRecordId),
    targetDoctor.walletAddress
  );

  return { success: true, txHash };
}

// ── Revoke blockchain access from a doctor ────────────────────────
export async function revokeDoctorAccessToPrescription(appointmentId, targetDoctorId) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const patient = await db.user.findUnique({
    where:  { clerkUserId: userId },
    select: { encryptedWalletKey: true, id: true },
  });
  if (!patient?.encryptedWalletKey) throw new Error("Patient wallet not found");

  const targetDoctor = await db.user.findUnique({
    where:  { id: targetDoctorId },
    select: { walletAddress: true },
  });
  if (!targetDoctor?.walletAddress) throw new Error("Doctor wallet not found");

  const appointment = await db.appointment.findUnique({
    where:  { id: appointmentId, patientId: patient.id },
    select: { blockchainRecordId: true },
  });
  if (!appointment?.blockchainRecordId) throw new Error("No blockchain record found");

  const decryptedKey = decryptPrivateKey(patient.encryptedWalletKey);

  const { txHash } = await revokeRecordAccess(
    decryptedKey,
    Number(appointment.blockchainRecordId),
    targetDoctor.walletAddress
  );

  return { success: true, txHash };
}

// ── Verify prescription integrity (doctor side) ───────────────────
// Flow:
//   1. Check the doctor has on-chain access to the record
//   2. Fetch canonical hash from chain via getRecord()
//   3. Re-fetch PDF from Cloudinary (uploadedPrescriptionUrl), recompute SHA-256
//   4. Compare — return verified/tampered + the PDF URL so UI can offer download
export async function verifyPrescriptionIntegrity(appointmentId) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const doctor = await db.user.findUnique({
    where:  { clerkUserId: userId },
    select: { walletAddress: true, encryptedWalletKey: true, id: true },
  });
  if (!doctor?.walletAddress)      throw new Error("Doctor wallet not found");
  if (!doctor?.encryptedWalletKey) throw new Error("Doctor wallet key not found");

  const appointment = await db.appointment.findUnique({
    where:  { id: appointmentId },
    select: {
      uploadedPrescriptionUrl: true,
      prescriptionHash:        true,   // DB fallback only
      blockchainRecordId:      true,   // set by upload step for cross-doctor shares too
      doctorId:                true,
    },
  });

  if (!appointment?.uploadedPrescriptionUrl) {
    throw new Error("No prescription has been shared for this appointment yet.");
  }
  if (!appointment.blockchainRecordId) {
    throw new Error(
      "No blockchain record linked to this appointment. " +
      "The patient must share the prescription again — the blockchain anchor is missing."
    );
  }

  // ── Step 1: Check on-chain access ────────────────────────────────
  // Always check — even for the original appointment's doctor, in case access was revoked.
  const onChainAccess = await hasAccess(
    Number(appointment.blockchainRecordId),
    doctor.walletAddress
  );
  if (!onChainAccess) {
    throw new Error(
      "Access denied: the patient has not granted you blockchain access to this record. " +
      "Ask them to click 'Grant Blockchain Access' on their appointment card."
    );
  }

  // ── Step 2: Fetch canonical hash from chain ───────────────────────
  const decryptedKey = decryptPrivateKey(doctor.encryptedWalletKey);
  let onChainHash;

  try {
    const record = await getRecordFromChain(
      decryptedKey,
      Number(appointment.blockchainRecordId)
    );
    onChainHash = record.ipfsHash; // SHA-256 hash stored at prescription generation time
  } catch (chainError) {
    console.warn("[verifyPrescriptionIntegrity] Chain unreachable, using DB cache:", chainError.message);
    if (!appointment.prescriptionHash) {
      throw new Error("Blockchain unreachable and no cached hash available. Try again later.");
    }
    onChainHash = appointment.prescriptionHash;
  }

  // ── Step 3: Re-fetch PDF from Cloudinary, recompute hash ──────────
  // uploadedPrescriptionUrl points to the same Cloudinary file as prescriptionUrl
  // (the share step copies the URL, not the file). So we're always verifying the
  // original file — there is only one copy.
  const { match, recomputedHash } = await verifyDocumentIntegrity(
    appointment.uploadedPrescriptionUrl,
    onChainHash
  );

  return {
    success:            true,
    verified:           match,
    tampered:           !match,
    recomputedHash,
    onChainHash,
    blockchainRecordId: appointment.blockchainRecordId,
    // Return the PDF URL so the UI can show a download link only after successful verification
    pdfUrl:             match ? appointment.uploadedPrescriptionUrl : null,
  };
}

// ── Check prescription integrity (patient side, auto-called on load) ──
// Middleman function. Called whenever the patient opens their appointment card.
// Re-fetches the PDF from Cloudinary, recomputes SHA-256, compares against:
//   1. On-chain hash via getRecordFromChain (primary)
//   2. DB-cached prescriptionHash (fallback if chain unreachable)
//
// Attack scenarios caught:
//   FILE_DELETED  — admin deleted the PDF from Cloudinary (404)
//   TAMPERED      — admin replaced/modified the PDF in Cloudinary (hash mismatch)
//   VERIFIED      — hash matches on-chain record
//   VERIFIED_OFFLINE — chain unreachable but matches DB cache
//   NO_PRESCRIPTION  — prescription not generated yet
//   CHECK_FAILED  — network error, can't determine status
export async function checkPrescriptionIntegrity(appointmentId) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where:  { clerkUserId: userId },
    select: { id: true, encryptedWalletKey: true },
  });
  if (!user) throw new Error("Unauthorized");

  const appointment = await db.appointment.findUnique({
    where:  { id: appointmentId },
    select: {
      prescriptionUrl:    true,
      prescriptionHash:   true,
      blockchainRecordId: true,
    },
  });

  if (!appointment?.prescriptionUrl) {
    return { status: "NO_PRESCRIPTION" };
  }

  // ── Step 1: Try to fetch file from Cloudinary ─────────────────
  let fileExists     = true;
  let recomputedHash = null;

  try {
    const response = await fetch(appointment.prescriptionUrl, {
      headers: { "Cache-Control": "no-cache, no-store" },
    });

    if (response.status === 404 || response.status === 410) {
      fileExists = false;
    } else if (!response.ok) {
      return {
        status:  "CHECK_FAILED",
        message: `Cloudinary returned HTTP ${response.status}. Try again later.`,
      };
    } else {
      const arrayBuffer = await response.arrayBuffer();
      const hashBuffer  = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray   = Array.from(new Uint8Array(hashBuffer));
      recomputedHash    = "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (fetchError) {
    return {
      status:  "CHECK_FAILED",
      message: "Could not reach file storage: " + fetchError.message,
    };
  }

  // File deleted — clear attack
  if (!fileExists) {
    return {
      status:          "FILE_DELETED",
      message:         "The prescription file has been deleted from storage.",
      prescriptionUrl: appointment.prescriptionUrl,
    };
  }

  // ── Step 2: Get canonical hash ────────────────────────────────
  let canonicalHash = null;
  let hashSource    = "unknown";

  if (appointment.blockchainRecordId && user.encryptedWalletKey) {
    try {
      const decryptedKey = decryptPrivateKey(user.encryptedWalletKey);
      const record       = await getRecordFromChain(
        decryptedKey,
        Number(appointment.blockchainRecordId)
      );
      canonicalHash = record.ipfsHash;
      hashSource    = "blockchain";
    } catch {
      // Chain unreachable — fall through to DB
    }
  }

  if (!canonicalHash && appointment.prescriptionHash) {
    canonicalHash = appointment.prescriptionHash;
    hashSource    = "database";
  }

  if (!canonicalHash) {
    return { status: "NO_HASH", message: "No hash to verify against." };
  }

  // ── Step 3: Compare ───────────────────────────────────────────
  const match = recomputedHash === canonicalHash;

  return {
    status:          match
      ? (hashSource === "blockchain" ? "VERIFIED" : "VERIFIED_OFFLINE")
      : "TAMPERED",
    verified:        match,
    tampered:        !match,
    recomputedHash,
    canonicalHash,
    hashSource,
    prescriptionUrl: appointment.prescriptionUrl,
  };
}