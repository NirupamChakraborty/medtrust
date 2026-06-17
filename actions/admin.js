"use server";

import {
  approveDoctorOnChain,
  isApprovedDoctor,
} from "@/lib/blockchain/blockchainService";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

/**
 * Verifies if current user has admin role
 */
export async function verifyAdmin() {
  const { userId } = await auth();
  if (!userId) return false;

  try {
    const user = await db.user.findUnique({ where: { clerkUserId: userId } });
    return user?.role === "ADMIN";
  } catch (error) {
    console.error("Failed to verify admin:", error);
    return false;
  }
}

/**
 * Gets all doctors with pending verification
 */
export async function getPendingDoctors() {
  const isAdmin = await verifyAdmin();
  if (!isAdmin) throw new Error("Unauthorized");

  try {
    const pendingDoctors = await db.user.findMany({
      where: { role: "DOCTOR", verificationStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return { doctors: pendingDoctors };
  } catch (error) {
    throw new Error("Failed to fetch pending doctors");
  }
}

/**
 * Gets all verified doctors
 */
export async function getVerifiedDoctors() {
  const isAdmin = await verifyAdmin();
  if (!isAdmin) throw new Error("Unauthorized");

  try {
    const verifiedDoctors = await db.user.findMany({
      where: { role: "DOCTOR", verificationStatus: "VERIFIED" },
      orderBy: { name: "asc" },
    });
    return { doctors: verifiedDoctors };
  } catch (error) {
    console.error("Failed to get verified doctors:", error);
    return { error: "Failed to fetch verified doctors" };
  }
}

/**
 * Updates a doctor's verification status.
 * When status is VERIFIED, also approves the doctor on the Quorum blockchain
 * so their wallet can sign healthcare records.
 *
 * On-chain approval requires:
 *   1. The doctor has already called registerDoctor() during onboarding ✓
 *      (registerDoctorOnChain is called in setUserRole when role === "DOCTOR")
 *   2. The caller is the contract owner (our QUORUM_ADMIN_PRIVATE_KEY) ✓
 *
 * Without on-chain approval, addRecord() reverts with NotDoctor() every time.
 * This function is idempotent — it checks isApprovedDoctor() before calling
 * approveDoctorOnChain() to avoid redundant blockchain transactions.
 */
export async function updateDoctorStatus(formData) {
  const isAdmin = await verifyAdmin();
  if (!isAdmin) throw new Error("Unauthorized");

  const doctorId = formData.get("doctorId");
  const status   = formData.get("status");

  if (!doctorId || !["VERIFIED", "REJECTED"].includes(status)) {
    throw new Error("Invalid input");
  }

  try {
    // Update DB first
    await db.user.update({
      where: { id: doctorId },
      data:  { verificationStatus: status },
    });

    // If approving, also approve on Quorum blockchain.
    // This is required for the doctor's wallet to call addRecord() on the
    // HealthcareRecord contract without hitting the NotDoctor() revert.
    if (status === "VERIFIED") {
      const doctor = await db.user.findUnique({
        where:  { id: doctorId },
        select: { walletAddress: true, name: true },
      });

      if (doctor?.walletAddress) {
        try {
          // Check first to avoid redundant on-chain transactions (idempotency).
          // This handles cases where the doctor was previously approved but their
          // DB status was reset (e.g. via updateDoctorActiveStatus).
          const alreadyApproved = await isApprovedDoctor(doctor.walletAddress);
          if (!alreadyApproved) {
            const result = await approveDoctorOnChain(doctor.walletAddress);
            console.log(
              `[updateDoctorStatus] Doctor ${doctor.name} approved on-chain: txHash=${result.txHash}`
            );
          } else {
            console.log(
              `[updateDoctorStatus] Doctor ${doctor.name} was already approved on-chain — skipping`
            );
          }
        } catch (blockchainError) {
          // Don't fail the DB update if blockchain is unreachable — admin can retry.
          // The doctor is still verified in the DB; blockchain approval can be
          // re-triggered by calling this action again or via a manual script.
          // generatePrescriptionPDF has a fallback guard that will approve on first PDF generation.
          // Check server logs and fix the chain connection — this should not keep failing.
          console.error(
            `[updateDoctorStatus] On-chain approval failed for ${doctor.name}:`,
            blockchainError.message
          );
        }
      } else {
        // This happens if the doctor signed up before wallets were introduced.
        // They will need to re-complete onboarding to get a wallet assigned.
        console.warn(
          `[updateDoctorStatus] Doctor ${doctorId} has no walletAddress — skipping on-chain approval.`
        );
      }
    }

    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("Failed to update doctor status:", error);
    throw new Error(`Failed to update doctor status: ${error.message}`);
  }
}

/**
 * Suspends or reinstates a doctor.
 * Note: this only changes the DB status — it does not revoke on-chain approval,
 * because the blockchain is append-only. The app-level check (verificationStatus)
 * is the authoritative gate for new appointments.
 *
 * If a suspended doctor is later reinstated via updateDoctorStatus("VERIFIED"),
 * the isApprovedDoctor() check in that function will skip redundant on-chain approval.
 */
export async function updateDoctorActiveStatus(formData) {
  const isAdmin = await verifyAdmin();
  if (!isAdmin) throw new Error("Unauthorized");

  const doctorId = formData.get("doctorId");
  const suspend  = formData.get("suspend") === "true";

  if (!doctorId) throw new Error("Doctor ID is required");

  try {
    await db.user.update({
      where: { id: doctorId },
      data:  { verificationStatus: suspend ? "PENDING" : "VERIFIED" },
    });

    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("Failed to update doctor active status:", error);
    throw new Error(`Failed to update doctor status: ${error.message}`);
  }
}

/**
 * Gets all pending payouts that need admin approval
 */
export async function getPendingPayouts() {
  const isAdmin = await verifyAdmin();
  if (!isAdmin) throw new Error("Unauthorized");

  try {
    const pendingPayouts = await db.payout.findMany({
      where: { status: "PROCESSING" },
      include: {
        doctor: {
          select: { id: true, name: true, email: true, specialty: true, credits: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return { payouts: pendingPayouts };
  } catch (error) {
    console.error("Failed to fetch pending payouts:", error);
    throw new Error("Failed to fetch pending payouts");
  }
}

/**
 * Approves a payout request and deducts credits from doctor's account
 */
export async function approvePayout(formData) {
  const isAdmin = await verifyAdmin();
  if (!isAdmin) throw new Error("Unauthorized");

  const payoutId = formData.get("payoutId");
  if (!payoutId) throw new Error("Payout ID is required");

  try {
    const { userId } = await auth();
    const admin = await db.user.findUnique({ where: { clerkUserId: userId } });

    const payout = await db.payout.findUnique({
      where:   { id: payoutId, status: "PROCESSING" },
      include: { doctor: true },
    });

    if (!payout) throw new Error("Payout request not found or already processed");

    if (payout.doctor.credits < payout.credits) {
      throw new Error("Doctor doesn't have enough credits for this payout");
    }

    await db.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payoutId },
        data:  { status: "PROCESSED", processedAt: new Date(), processedBy: admin?.id || "unknown" },
      });
      await tx.user.update({
        where: { id: payout.doctorId },
        data:  { credits: { decrement: payout.credits } },
      });
      await tx.creditTransaction.create({
        data: { userId: payout.doctorId, amount: -payout.credits, type: "ADMIN_ADJUSTMENT" },
      });
    });

    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("Failed to approve payout:", error);
    throw new Error(`Failed to approve payout: ${error.message}`);
  }
}
