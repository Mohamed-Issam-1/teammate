import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { VisibleProfile } from "@/server/profiles/visible-profile";

/**
 * Read-only presentation of another member's profile.
 *
 * A server component: this page has no interactivity, so it ships no client
 * JavaScript and no editing controls. Everything rendered here comes from the
 * safe projection in `visible-profile`, which contains no identifier, no contact
 * detail, and none of the owner's private preferences.
 */

/**
 * Display labels for the proficiency enum.
 *
 * A `Map` rather than an object literal so a lookup can never walk the prototype
 * chain. `proficiencyLevel` is constrained to the enum by the database, but
 * `Map.get` returning `undefined` for an unrecognized value is a structural
 * guarantee rather than an incidental one.
 */
const PROFICIENCY_LABELS = new Map<string, string>([
  ["BEGINNER", "Beginner"],
  ["INTERMEDIATE", "Intermediate"],
  ["ADVANCED", "Advanced"],
  ["EXPERT", "Expert"],
]);

/**
 * Up to two initials for the avatar placeholder.
 *
 * Derived from the display name, which is not unique and not normalized, so this
 * is presentation only and never used for identity or matching. Split with
 * `Array.from` rather than indexing so a name beginning with an astral character
 * cannot split a surrogate pair and render a replacement glyph.
 */
function initialsOf(displayName: string): string {
  const words = Array.from(displayName)
    .join("")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2);

  return words.map((word) => Array.from(word)[0]?.toUpperCase() ?? "").join("");
}

export function PublicProfileView({ profile }: { profile: VisibleProfile }) {
  const initials = initialsOf(profile.displayName);

  return (
    <div className="grid w-full gap-6">
      <Card className="w-full shadow-sm">
        <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex items-center gap-4">
            {/*
              An initials placeholder rather than an image. `avatarUrl` is
              projected but has no write path until the trusted storage
              checkpoint, and no image host is allowlisted, so rendering a remote
              source here would mean either a broken image or broadening image
              configuration for no current benefit.
            */}
            <div
              aria-hidden="true"
              className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
            >
              {initials.length > 0 ? initials : null}
            </div>
            <div className="grid gap-1">
              <h1 className="text-foreground text-2xl font-semibold tracking-tight text-balance">
                {profile.displayName}
              </h1>
              {profile.headline === null ? null : (
                <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
                  {profile.headline}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
        {profile.bio === null ? null : (
          <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {profile.bio}
            </p>
          </CardContent>
        )}
      </Card>

      <Card className="w-full shadow-sm">
        <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
          <CardTitle
            role="heading"
            aria-level={2}
            className="text-lg font-semibold tracking-tight"
          >
            Skills
          </CardTitle>
          <CardDescription>
            Skills this member has listed on their profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
          {profile.skills.length === 0 ? (
            <p className="text-muted-foreground text-sm leading-relaxed">
              No skills listed yet.
            </p>
          ) : (
            <ul className="grid gap-2">
              {profile.skills.map((skill) => (
                <li
                  key={skill.slug}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
                >
                  <span className="text-sm font-medium">{skill.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {skill.category === null ? null : `${skill.category} · `}
                    {PROFICIENCY_LABELS.get(skill.proficiencyLevel) ??
                      skill.proficiencyLevel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="w-full shadow-sm">
        <CardHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
          <CardTitle
            role="heading"
            aria-level={2}
            className="text-lg font-semibold tracking-tight"
          >
            Interests
          </CardTitle>
          <CardDescription>What this member is interested in.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5 sm:px-6 sm:pb-6">
          {profile.interests.length === 0 ? (
            <p className="text-muted-foreground text-sm leading-relaxed">
              No interests listed yet.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {profile.interests.map((interest) => (
                <li
                  key={interest.slug}
                  className="rounded-full border px-3 py-1 text-sm"
                >
                  {interest.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
