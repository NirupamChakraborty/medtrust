"use server";

import { APPOINTMENT_CREDIT_COST, PLANS } from "@/lib/plans";
import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import { revalidatePath } from "next/cache";



// ── Step 1: Create Razorpay order (called from client via server action) ──
export async function createRazorpayOrder(planId) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const plan = PLANS[planId];
  if (!plan) throw new Error("Invalid plan selected");

  // Lazily import Razorpay — only runs on server
  const Razorpay = (await import("razorpay")).default;
  const razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const order = await razorpay.orders.create({
    amount:   plan.amount,
    currency: "INR",
    receipt:  `r_${userId}_${Date.now()}`.slice(0, 40),
    notes:    { clerkUserId: userId, planId, credits: String(plan.credits) },
  });

  // Return only what the client needs — never expose key_secret
  return {
    orderId:     order.id,
    amount:      order.amount,
    currency:    order.currency,
    planLabel:   plan.label,
    credits:     plan.credits,
    keyId:       process.env.RAZORPAY_KEY_ID,
  };
}

// ── Step 2: Verify payment + credit account ───────────────────────
// Called from client after Razorpay checkout succeeds.
// Verifies the HMAC signature so nobody can fake a payment.
export async function verifyAndCreditPayment({
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
  planId,
}) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const plan = PLANS[planId];
  if (!plan) throw new Error("Invalid plan");

  // ── Verify HMAC signature ─────────────────────────────────────
  const body     = razorpay_order_id + "|" + razorpay_payment_id;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expected !== razorpay_signature) {
    throw new Error("Payment verification failed — invalid signature");
  }

  // ── Credit the patient ────────────────────────────────────────
  const user = await db.user.findUnique({
    where:  { clerkUserId: userId },
    select: { id: true },
  });
  if (!user) throw new Error("User not found");

  await db.$transaction(async (tx) => {
    await tx.creditTransaction.create({
      data: {
        userId:    user.id,
        amount:    plan.credits,
        type:      "CREDIT_PURCHASE",
        packageId: planId,
      },
    });
    await tx.user.update({
      where: { id: user.id },
      data:  { credits: { increment: plan.credits } },
    });
  });

  revalidatePath("/pricing");
  revalidatePath("/doctors");

  return { success: true, credits: plan.credits };
}

// ── checkAndAllocateCredits — kept for header.jsx compatibility ───
// Credits now come from Razorpay purchases, not Clerk subscriptions.
// This is a no-op but kept so header.jsx doesn't break.
export async function checkAndAllocateCredits(user) {
  return user;
}

// ── Deduct credits for booking an appointment ─────────────────────
export async function deductCreditsForAppointment(userId, doctorId) {
  try {
    const user   = await db.user.findUnique({ where: { id: userId } });
    const doctor = await db.user.findUnique({ where: { id: doctorId } });

    if (user.credits < APPOINTMENT_CREDIT_COST) {
      throw new Error("Insufficient credits to book an appointment");
    }
    if (!doctor) throw new Error("Doctor not found");

    const result = await db.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: { userId: user.id, amount: -APPOINTMENT_CREDIT_COST, type: "APPOINTMENT_DEDUCTION" },
      });
      await tx.creditTransaction.create({
        data: { userId: doctor.id, amount: APPOINTMENT_CREDIT_COST, type: "APPOINTMENT_DEDUCTION" },
      });
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data:  { credits: { decrement: APPOINTMENT_CREDIT_COST } },
      });
      await tx.user.update({
        where: { id: doctor.id },
        data:  { credits: { increment: APPOINTMENT_CREDIT_COST } },
      });
      return updatedUser;
    });

    return { success: true, user: result };
  } catch (error) {
    console.error("Failed to deduct credits:", error);
    return { success: false, error: error.message };
  }
}