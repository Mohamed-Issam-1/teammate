import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { InterestsSection } from "@/features/profile/components/interests-section";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { SkillsSection } from "@/features/profile/components/skills-section";
import {
  AuthenticationRequiredError,
  EmailVerificationRequiredError,
} from "@/server/auth/policy";
import {
  getCurrentInterestAssignments,
  getCurrentSkillAssignments,
} from "@/server/profiles/current-assignments";
import { getCurrentOwnProfile } from "@/server/profiles/current-profile";
import { ProfileNotOnboardedError } from "@/server/profiles/own-profile";
import { AssignmentNotOnboardedError } from "@/server/profiles/assignments";
import {
  getCurrentTaxonomyInterests,
  getCurrentTaxonomySkills,
} from "@/server/taxonomy/current-taxonomy";

export const metadata: Metadata = {
  title: "Your profile",
  description: "Edit the profile other TeamMate members see.",
};

/**
 * Own-profile page.
 *
 * Authorization is resolved server-side from the database session on every
 * request. The page accepts no user identifier, so it can only ever show the
 * current user's own profile.
 */
export default async function ProfilePage() {
  let profile: Awaited<ReturnType<typeof getCurrentOwnProfile>>;
  let skillAssignments: Awaited<ReturnType<typeof getCurrentSkillAssignments>>;
  let interestAssignments: Awaited<
    ReturnType<typeof getCurrentInterestAssignments>
  >;
  let skillTaxonomy: Awaited<ReturnType<typeof getCurrentTaxonomySkills>>;
  let interestTaxonomy: Awaited<ReturnType<typeof getCurrentTaxonomyInterests>>;

  try {
    [
      profile,
      skillAssignments,
      interestAssignments,
      skillTaxonomy,
      interestTaxonomy,
    ] = await Promise.all([
      getCurrentOwnProfile(),
      getCurrentSkillAssignments(),
      getCurrentInterestAssignments(),
      getCurrentTaxonomySkills(),
      getCurrentTaxonomyInterests(),
    ]);
  } catch (error) {
    if (error instanceof EmailVerificationRequiredError) {
      redirect("/verify-email");
    }

    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }

    // A missing or incomplete profile is routed to onboarding, which is the
    // only path that creates one. Nothing is manufactured from User.name.
    // The assignment boundary raises its own error for the same condition, and
    // all five reads run concurrently, so both must be handled here or a
    // not-onboarded user could see a server error instead of the redirect.
    if (
      error instanceof ProfileNotOnboardedError ||
      error instanceof AssignmentNotOnboardedError
    ) {
      redirect("/onboarding");
    }

    throw error;
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
        <div className="grid w-full max-w-lg gap-6">
          <Card className="w-full shadow-sm">
            <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
              <p className="text-muted-foreground text-sm font-medium">
                Account
              </p>
              <h1 className="text-foreground mt-2 text-2xl font-semibold tracking-tight text-balance">
                Your profile
              </h1>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
                This is the information other people see when they view your
                profile.
              </p>
            </CardHeader>
            <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
              <ProfileForm profile={profile} />
              <SignOutButton />
            </CardContent>
          </Card>

          <SkillsSection
            assignments={skillAssignments}
            taxonomy={skillTaxonomy}
          />

          <InterestsSection
            assignments={interestAssignments}
            taxonomy={interestTaxonomy}
          />
        </div>
      </main>
    </div>
  );
}
