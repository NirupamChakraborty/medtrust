"use server";

import {
  registerDoctorOnChain,
  registerPatientOnChain,
} from "@/lib/blockchain/blockchainService";
import { createWallet, decryptPrivateKey } from "@/lib/blockchain/walletService";
import { db } from "@/lib/prisma";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function setUserRole(formData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });
  if (!user) throw new Error("User not found in database");

  const role = formData.get("role");
  if (!role || !["PATIENT", "DOCTOR"].includes(role)) {
    throw new Error("Invalid role selection");
  }

  try {
    if (role === "PATIENT") {
      // Create wallet if not already created
      let walletAddress = user.walletAddress;
      let encryptedWalletKey = user.encryptedWalletKey;

      if (!walletAddress) {
        const wallet = createWallet();
        walletAddress      = wallet.address;
        encryptedWalletKey = wallet.encryptedKey;
      }

      // Update DB with role + wallet
      await db.user.update({
        where: { clerkUserId: userId },
        data: {
          role:               "PATIENT",
          walletAddress,
          encryptedWalletKey,
        },
      });

      // Sync role to Clerk metadata so middleware can read it from
      // the session token without making a DB call (Edge-safe)
      const clerk = await clerkClient();
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { role: "PATIENT" },
      });

      // Register on Quorum blockchain
      try {
        const decryptedKey = decryptPrivateKey(encryptedWalletKey);
        await registerPatientOnChain(
          decryptedKey,
          user.name || "Patient",
          0  // age — you can add an age field to your form if needed
        );
      } catch (blockchainError) {
        // Don't fail onboarding if blockchain is unreachable
        console.error("[setUserRole] Patient blockchain registration failed:", blockchainError.message);
      }

      revalidatePath("/");
      return { success: true, redirect: "/doctors" };
    }

    if (role === "DOCTOR") {
      const specialty     = formData.get("specialty");
      const experience    = parseInt(formData.get("experience"), 10);
      const credentialUrl = formData.get("credentialUrl");
      const description   = formData.get("description");

      if (!specialty || !experience || !credentialUrl || !description) {
        throw new Error("All fields are required");
      }

      // Create wallet if not already created
      let walletAddress = user.walletAddress;
      let encryptedWalletKey = user.encryptedWalletKey;

      if (!walletAddress) {
        const wallet = createWallet();
        walletAddress      = wallet.address;
        encryptedWalletKey = wallet.encryptedKey;
      }

      // Update DB with role + wallet + doctor fields
      await db.user.update({
        where: { clerkUserId: userId },
        data: {
          role: "DOCTOR",
          specialty,
          experience,
          credentialUrl,
          description,
          verificationStatus: "PENDING",
          walletAddress,
          encryptedWalletKey,
        },
      });

      // Sync role to Clerk metadata so middleware can read it from
      // the session token without making a DB call (Edge-safe)
      const clerk = await clerkClient();
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { role: "DOCTOR" },
      });

      // Register on Quorum blockchain
      try {
        const decryptedKey = decryptPrivateKey(encryptedWalletKey);
        await registerDoctorOnChain(
          decryptedKey,
          user.name || "Doctor",
          specialty
        );
      } catch (blockchainError) {
        // Don't fail onboarding if blockchain is unreachable
        console.error("[setUserRole] Doctor blockchain registration failed:", blockchainError.message);
      }

      revalidatePath("/");
      return { success: true, redirect: "/doctor/verification" };
    }
  } catch (error) {
    console.error("Failed to set user role:", error);
    throw new Error(`Failed to update user profile: ${error.message}`);
  }
}

export async function getCurrentUser() {
  const { userId } = await auth();
  if (!userId) return null;

  try {
    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    return user;
  } catch (error) {
    console.error("Failed to get user information:", error);
    return null;
  }
}