"use client";

import { createRazorpayOrder, verifyAndCreditPayment } from "@/actions/credits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUser } from "@clerk/nextjs";
import { CheckCircle, Loader2, Zap } from "lucide-react";
import Script from "next/script";
import { useState } from "react";
import { toast } from "sonner";

const PLANS = [
  {
    id:            "standard",
    name:          "Standard",
    price:         "₹800",
    credits:       10,
    consultations: 5,
    badge:         null,
    features: [
      "10 credits per purchase",
      "5 doctor consultations",
      "Video call support",
      "Prescription PDF download",
      "Blockchain verified records",
    ],
  },
  {
    id:            "premium",
    name:          "Premium",
    price:         "₹2,000",
    credits:       28,
    consultations: 14,
    badge:         "Most Popular",
    features: [
      "28 credits per purchase",
      "14 doctor consultations",
      "Video call support",
      "Prescription PDF download",
      "Blockchain verified records",
      "Priority support",
    ],
  },
];

export default function Pricing() {
  const { user } = useUser();
  const [loadingPlan, setLoadingPlan] = useState(null);

  const handleBuy = async (plan) => {
    if (!user) {
      toast.error("Please sign in to purchase credits");
      return;
    }

    setLoadingPlan(plan.id);

    try {
      // ── Step 1: Create order via server action ────────────────
      const order = await createRazorpayOrder(plan.id);

      // ── Step 2: Open Razorpay checkout popup ──────────────────
      const options = {
        key:         order.keyId,
        amount:      order.amount,
        currency:    order.currency,
        name:        "MedTrust",
        description: order.planLabel,
        order_id:    order.orderId,
        prefill: {
          name:  user.fullName || "",
          email: user.primaryEmailAddress?.emailAddress || "",
        },
        theme: { color: "#059669" },

        handler: async (response) => {
          // ── Step 3: Verify payment via server action ──────────
          try {
            const result = await verifyAndCreditPayment({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              planId:              plan.id,
            });

            toast.success(
              `✅ Payment successful! ${result.credits} credits added to your account.`
            );
            // Reload so header shows updated credit count
            window.location.reload();
          } catch (err) {
            toast.error("Verification failed: " + err.message);
          } finally {
            setLoadingPlan(null);
          }
        },

        modal: {
          ondismiss: () => setLoadingPlan(null),
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (response) => {
        toast.error("Payment failed: " + response.error.description);
        setLoadingPlan(null);
      });
      rzp.open();

    } catch (err) {
      toast.error(err.message);
      setLoadingPlan(null);
    }
  };

  return (
    <>
      {/* Razorpay checkout script — loaded lazily */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            className={`relative border-emerald-900/30 bg-gradient-to-b from-emerald-950/30 to-transparent shadow-lg ${
              plan.badge ? "border-emerald-600/50 ring-1 ring-emerald-600/30" : ""
            }`}
          >
            {plan.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-emerald-600 text-white px-4 py-1 text-xs font-semibold">
                  <Zap className="h-3 w-3 mr-1" />
                  {plan.badge}
                </Badge>
              </div>
            )}

            <CardHeader className="text-center pb-4 pt-8">
              <CardTitle className="text-2xl font-bold text-white">
                {plan.name}
              </CardTitle>
              <div className="mt-4">
                <span className="text-5xl font-bold text-emerald-400">
                  {plan.price}
                </span>
                <span className="text-muted-foreground text-sm ml-1">
                  / purchase
                </span>
              </div>
              <p className="text-muted-foreground text-sm mt-2">
                {plan.credits} credits · {plan.consultations} consultations
              </p>
            </CardHeader>

            <CardContent className="space-y-6">
              <ul className="space-y-3">
                {plan.features.map((feature, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 text-sm text-muted-foreground"
                  >
                    <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-5"
                onClick={() => handleBuy(plan)}
                disabled={loadingPlan === plan.id}
              >
                {loadingPlan === plan.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  `Pay ${plan.price}`
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Secure payment · UPI · Cards · Net Banking
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}