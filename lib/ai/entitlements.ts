import type { UserType } from "@/app/(auth)/auth";

type Entitlements = {
  maxMessagesPerHour: number;
};

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account
   */
  guest: {
    maxMessagesPerHour: 5,
  },

  /*
   * For users with an account
   */
  regular: {
    maxMessagesPerHour: 10,
  },

  /*
   * For admin users — no rate limiting
   */
  admin: {
    maxMessagesPerHour: Number.POSITIVE_INFINITY,
  },
};
