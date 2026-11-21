import { getPlans } from "./config.js";
import { getActiveSubscription } from "./subscriptions.js";

// plan.json describes both plans (free, premium) and sources
// (trial, admin, ...). A subscription takes its plan values first and
// the source values override them, e.g. a premium subscription with
// source "trial" gets the "trial" name and limits.
export function resolvePlan(subscription) {
  const plans = getPlans();

  const base = plans[subscription.plan] || {};
  const bySource = plans[subscription.source] || {};

  return {
    key: plans[subscription.source]
      ? subscription.source
      : subscription.plan,
    plan: subscription.plan,
    source: subscription.source,
    name: bySource.name || base.name || subscription.plan,
    description:
      bySource.description || base.description || "",
    devices: bySource.devices ?? base.devices ?? 0,
    days: bySource.days ?? base.days ?? null
  };
}

export function isUnlimited(plan) {
  return plan.devices === -1;
}

// Current subscription of the user together with its resolved plan.
export async function getUserPlanInfo(userId) {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    return null;
  }

  return {
    subscription,
    plan: resolvePlan(subscription)
  };
}
