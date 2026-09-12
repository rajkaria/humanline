"use client";

/**
 * Choose which deployment `/app` talks to.
 *
 * Two real deployments, same protocol, same relayed roots: one verifies proofs
 * against World's Sepolia staging tree (anyone can produce one with the simulator),
 * the other against the Ethereum mainnet Orb tree (only a real verified human can).
 * Making that a visible switch rather than a build-time flag is the honest thing to
 * do — and it means the person with an Orb and the judge without one are both
 * first-class users of the same site.
 */

import { CheckIcon, GlobeIcon, TestTubeIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useProfile } from "@/lib/profile-context";
import { PROFILE_IDS, PROFILES, termLabel, type ProfileId } from "@/lib/profiles";

const ICONS: Record<ProfileId, typeof GlobeIcon> = {
  demo: TestTubeIcon,
  production: GlobeIcon,
};

export function ProfileSwitch() {
  const { profileId, setProfileId, resolved } = useProfile();

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Which tree are you proving against?</h2>
          <p className="text-xs text-muted-foreground">
            Both are live on Creditcoin CC3. Your choice changes the registry, the credit
            line and the World ID environment together — they have to agree.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {PROFILE_IDS.map((id) => {
            const profile = PROFILES[id];
            const Icon = ICONS[id];
            const active = resolved && profileId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setProfileId(id)}
                disabled={!profile.available}
                aria-pressed={active}
                className={[
                  "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition",
                  active
                    ? "border-brand/60 bg-brand/5"
                    : "border-hairline hover:border-brand/40 hover:bg-muted/40",
                  profile.available ? "" : "cursor-not-allowed opacity-50",
                ].join(" ")}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 text-brand" aria-hidden />
                  {profile.label}
                  {active ? <CheckIcon className="size-3.5 text-brand" aria-hidden /> : null}
                </span>
                <span className="text-xs text-muted-foreground">{profile.who}</span>
                <span className="flex flex-wrap gap-1.5 pt-0.5">
                  <Badge variant="outline" className="text-[10px]">
                    roots from {profile.sourceChain}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {termLabel(profile)} term
                  </Badge>
                  {profile.available ? null : (
                    <Badge variant="outline" className="text-[10px]">
                      not deployed
                    </Badge>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
