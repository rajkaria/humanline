import { notFound } from "next/navigation";

import { SelfRelayPreview } from "./preview";

/**
 * Every state of the self-relay panel side by side, with no wallet and no pending
 * root needed. Development only: production builds answer 404.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SelfRelayPreview />;
}
