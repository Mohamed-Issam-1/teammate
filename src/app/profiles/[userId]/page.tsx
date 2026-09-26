import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicProfileView } from "@/features/profile/components/public-profile-view";
import { getCurrentProfileViewer } from "@/server/profiles/current-viewer";
import { readVisibleProfile } from "@/server/profiles/visible-profile";
import { prisma } from "@/server/db";

/**
 * Another member's profile, addressed by opaque user id.
 *
 * The id in the URL is a locator, not a credential. Possessing or guessing one
 * grants nothing: every request is re-authorized server-side against the target's
 * current account state and the viewer's own server-resolved context. The page
 * also never echoes the id, and the safe projection contains no identifier, so
 * even a rendered page reveals nothing that could be replayed elsewhere.
 *
 * There are no editing controls here. Own-profile management, including the
 * private fields this page deliberately omits, stays on `/app/profile`.
 */

/**
 * Static, data-free metadata.
 *
 * Deliberately generic. A dynamic title would need its own authorized lookup, and
 * `generateMetadata` and the page are resolved independently: a profile set to
 * PRIVATE between the two could still leak its display name into the document
 * head of a response whose body is a 404. A fixed title removes that class of
 * leak entirely and avoids a second, weakly-authorized query. Discoverability is
 * a later-phase concern and belongs with the public search/indexing work.
 */
export const metadata: Metadata = {
  title: "Profile",
  description: "A TeamMate member profile.",
};

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const viewer = await getCurrentProfileViewer();

  // `null` covers every unavailable case identically: unknown id, ineligible
  // target, or a visibility the viewer does not have. Routing all of them to the
  // single generic not-found boundary is what prevents the distinction between
  // them from ever becoming observable.
  const profile = await readVisibleProfile(userId, viewer, prisma);

  if (profile === null) {
    notFound();
  }

  return (
    <div className="bg-muted/25 flex min-h-full flex-1 flex-col">
      <header className="border-border bg-background border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-4 sm:px-6">
          <span className="text-foreground text-sm font-semibold tracking-tight">
            TeamMate
          </span>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <div className="w-full max-w-2xl">
          <PublicProfileView profile={profile} />
        </div>
      </main>
    </div>
  );
}
