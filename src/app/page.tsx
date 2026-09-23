import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const capabilities = [
  {
    title: "Structured profiles",
    description:
      "Skills, availability, and working style — the context a team needs before the first message.",
  },
  {
    title: "Projects and applications",
    description:
      "Project creators publish briefs; members apply or get invited. Decisions stay explicit and reviewable.",
  },
  {
    title: "Shared workspace",
    description:
      "Tasks, discussions, files, and notifications give a formed team one place to keep moving.",
  },
  {
    title: "Explainable AI matching",
    description:
      "Suggestions come with a reason and a confidence — people always make the final call.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="text-foreground text-sm font-semibold tracking-tight">
            TeamMate
          </span>
          <span className="text-muted-foreground text-xs">Phase 0 preview</span>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
          <p className="text-muted-foreground text-sm font-medium">
            Project team formation, made structured
          </p>
          <h1 className="text-foreground mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            Form project teams that actually work.
          </h1>
          <p className="text-muted-foreground mt-5 max-w-2xl text-base leading-relaxed sm:text-lg">
            TeamMate connects structured profiles with project briefs,
            applications, and invitations — then gives the team a shared
            workspace. Every match is explained, and every decision stays yours.
          </p>
          <div className="mt-8">
            <Button
              variant="outline"
              size="lg"
              disabled
              aria-describedby="phase-note"
            >
              Sign in — not available yet
            </Button>
            <p id="phase-note" className="text-muted-foreground mt-3 text-xs">
              This preview shows the Phase 0 foundation. Accounts and
              authentication arrive in a later phase.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="capabilities-heading"
          className="mx-auto w-full max-w-5xl px-4 pb-12 sm:px-6 sm:pb-20"
        >
          <h2
            id="capabilities-heading"
            className="text-foreground text-xl font-semibold tracking-tight sm:text-2xl"
          >
            What TeamMate is built for
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {capabilities.map((capability) => (
              <Card key={capability.title}>
                <CardHeader>
                  <CardTitle>{capability.title}</CardTitle>
                  <CardDescription>{capability.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-5xl px-4 py-6 text-xs sm:px-6">
          <p>
            © {new Date().getFullYear()} TeamMate — portfolio project. Phase 0:
            foundation.
          </p>
        </div>
      </footer>
    </div>
  );
}
