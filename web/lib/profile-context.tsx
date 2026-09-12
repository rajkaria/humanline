"use client";

/**
 * Which deployment `/app` is pointed at, held in one place.
 *
 * The choice is sticky (localStorage) and deep-linkable (`?profile=production`), so
 * "here is my line on the real Orb tree" is a URL someone can send. Everything that
 * touches an address inside `/app` reads it from here rather than from
 * `lib/contracts`, which is bound to the default profile for the static pages.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  DEFAULT_PROFILE_ID,
  PROFILES,
  profileById,
  type Profile,
  type ProfileId,
} from "@/lib/profiles";

const STORAGE_KEY = "humanline:profile";

type ProfileContextValue = {
  profile: Profile;
  profileId: ProfileId;
  setProfileId: (id: ProfileId) => void;
  /** `false` until the stored/queried choice has been applied, so SSR and the first
   *  client render agree and React does not warn about a hydration mismatch. */
  resolved: boolean;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryProfile = searchParams.get("profile");

  // Read once, during the first client render. This subtree only ever renders on the
  // client (it reads the query string), so there is no server HTML to mismatch, and
  // deriving the choice instead of setting it from an effect avoids a second render.
  const [stored, setStored] = useState<ProfileId | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return profileById(window.localStorage.getItem(STORAGE_KEY))?.id ?? null;
    } catch {
      // Private mode or blocked storage: fall back to the default, never crash.
      return null;
    }
  });

  // The query parameter wins over the stored choice: a shared link should show the
  // sender's profile even on a browser that has used the other one.
  const fromQuery = profileById(queryProfile);
  const profileId: ProfileId =
    fromQuery?.available
      ? fromQuery.id
      : stored && PROFILES[stored].available
        ? stored
        : DEFAULT_PROFILE_ID;

  const setProfileId = useCallback(
    (id: ProfileId) => {
      if (!PROFILES[id].available) return;
      setStored(id);
      try {
        window.localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // Not being able to remember the choice is not a reason to refuse it.
      }
      // Keep the URL honest so a refresh or a copied link stays on this profile.
      const params = new URLSearchParams(window.location.search);
      if (id === DEFAULT_PROFILE_ID) params.delete("profile");
      else params.set("profile", id);
      const query = params.toString();
      router.replace(query ? `${window.location.pathname}?${query}` : window.location.pathname, {
        scroll: false,
      });
    },
    [router, setStored],
  );

  const resolved = true;

  const value = useMemo<ProfileContextValue>(
    () => ({ profile: PROFILES[profileId], profileId, setProfileId, resolved }),
    [profileId, setProfileId, resolved],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/**
 * The active profile.
 *
 * Outside a {@link ProfileProvider} this returns the default profile rather than
 * throwing: a component rendered on a static page still needs addresses, and the
 * default is exactly what those pages document.
 */
export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  return (
    context ?? {
      profile: PROFILES[DEFAULT_PROFILE_ID],
      profileId: DEFAULT_PROFILE_ID,
      setProfileId: () => {},
      resolved: true,
    }
  );
}
