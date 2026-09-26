import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicProfileView } from "@/features/profile/components/public-profile-view";
import type { VisibleProfile } from "@/server/profiles/visible-profile";

/**
 * Public profile rendering.
 *
 * The important assertions are the negative ones: this view must never surface a
 * private field, because the component is the last place a leak would show even
 * if the read model were widened by mistake.
 */

const fullProfile: VisibleProfile = {
  displayName: "Ada Lovelace",
  headline: "Countess and engineer",
  bio: "Writes notes about analytical engines.",
  avatarUrl: null,
  skills: [
    {
      slug: "typescript",
      name: "TypeScript",
      category: "Programming Languages",
      proficiencyLevel: "EXPERT",
    },
    {
      slug: "react",
      name: "React",
      category: "Frontend",
      proficiencyLevel: "ADVANCED",
    },
  ],
  interests: [
    { slug: "open-source", name: "Open Source" },
    { slug: "data-science", name: "Data Science" },
  ],
};

function renderView(profile: Partial<VisibleProfile> = {}) {
  return render(<PublicProfileView profile={{ ...fullProfile, ...profile }} />);
}

/**
 * The row containing `text`.
 *
 * A plain `<li>` has no accessible name derived from its contents, so the row is
 * located through its visible text and then walked up to the list item.
 */
function rowContaining(text: string): HTMLElement {
  const element = screen.getByText(text).closest("li");

  if (element === null) {
    throw new Error(`No list row contains "${text}".`);
  }

  return element;
}

describe("public profile view", () => {
  it("renders the display name as the single level-one heading", () => {
    renderView();

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Ada Lovelace",
    });
    expect(heading).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders the headline and bio when present", () => {
    renderView();

    expect(screen.getByText("Countess and engineer")).toBeInTheDocument();
    expect(
      screen.getByText("Writes notes about analytical engines."),
    ).toBeInTheDocument();
  });

  it("omits the headline and bio entirely when they are null", () => {
    const { container } = renderView({ headline: null, bio: null });

    expect(screen.queryByText("Countess and engineer")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Writes notes about analytical engines."),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("undefined");
  });

  it("shows Skills and Interests as level-two section headings", () => {
    renderView();

    expect(
      screen.getByRole("heading", { level: 2, name: "Skills" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Interests" }),
    ).toBeVisible();
  });

  it("renders each skill with its proficiency and category", () => {
    renderView();

    const skill = rowContaining("TypeScript");
    expect(skill).toHaveTextContent("Programming Languages");
    expect(skill).toHaveTextContent("Expert");
  });

  it("renders a skill that has no category without inventing one", () => {
    renderView({
      skills: [
        {
          slug: "unity",
          name: "Unity",
          category: null,
          proficiencyLevel: "BEGINNER",
        },
      ],
    });

    const skill = rowContaining("Unity");
    expect(skill).toHaveTextContent("Beginner");
    expect(skill.textContent).not.toContain("·");
  });

  it("renders an unknown proficiency value verbatim rather than hiding it", () => {
    renderView({
      skills: [
        {
          slug: "x",
          name: "X",
          category: null,
          proficiencyLevel: "SOMETHING_NEW",
        },
      ],
    });

    expect(rowContaining("X")).toHaveTextContent("SOMETHING_NEW");
  });

  it("renders each interest by name", () => {
    renderView();

    expect(rowContaining("Open Source")).toBeVisible();
    expect(rowContaining("Data Science")).toBeVisible();
  });

  it("shows an empty state for no skills", () => {
    renderView({ skills: [] });

    expect(screen.getByText("No skills listed yet.")).toBeVisible();
  });

  it("shows an empty state for no interests", () => {
    renderView({ interests: [] });

    expect(screen.getByText("No interests listed yet.")).toBeVisible();
  });

  it("shows an initials placeholder derived from the display name", () => {
    const { container } = renderView();

    const placeholder = container.querySelector('[aria-hidden="true"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveTextContent("AL");
  });

  it("derives at most two initials and tolerates awkward names", () => {
    const cases: [string, string][] = [
      ["Ada", "A"],
      ["Ada Byron King Lovelace", "AB"],
      ["  spaced   out  ", "SO"],
      ["", ""],
    ];

    for (const [displayName, expected] of cases) {
      const { container, unmount } = render(
        <PublicProfileView
          profile={{ ...fullProfile, displayName, headline: null, bio: null }}
        />,
      );
      const placeholder = container.querySelector('[aria-hidden="true"]');

      expect(placeholder, displayName).toHaveTextContent(expected);
      unmount();
    }
  });

  it("does not render an image element, because no avatar host is allowlisted", () => {
    const { container } = renderView({
      avatarUrl: "https://cdn.example/a.png",
    });

    expect(container.querySelector("img")).toBeNull();
  });

  it("offers no editing or sign-in controls", () => {
    renderView();

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders nothing that could identify the account", () => {
    const { container } = renderView({
      // Values a leak would carry if the projection were widened.
      ...fullProfile,
    });

    const text = container.textContent ?? "";

    for (const forbidden of [
      "yearsExperience",
      "years",
      "yr",
      "timezone",
      "Europe/London",
      "availabilityHoursPerWeek",
      "nameKey",
      "accountStatus",
      "emailVerified",
      "globalRole",
      "onboardingCompletedAt",
      "PRIVATE",
      "MEMBERS_ONLY",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("does not render the visibility value or any internal id", () => {
    const { container } = renderView();

    const text = container.textContent ?? "";

    // The owner id must not be echoed anywhere in the rendered output.
    expect(text).not.toContain("user-id");
    expect(container.innerHTML).not.toContain("slug=");
    expect(text).not.toContain("@");
  });

  it("preserves bio line breaks without injecting markup", () => {
    const { container } = renderView({
      bio: "First line\n<script>alert(1)</script>",
    });

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/First line/)).toBeInTheDocument();
  });
});
