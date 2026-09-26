import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InterestsSection } from "@/features/profile/components/interests-section";
import { SkillsSection } from "@/features/profile/components/skills-section";
import type {
  AssignedInterest,
  AssignedSkill,
} from "@/server/profiles/assignments";
import type { TaxonomyInterest, TaxonomySkill } from "@/server/taxonomy/reads";

const actionMock = vi.hoisted(() => ({
  saveSkillAssignmentAction: vi.fn(),
  removeSkillAssignmentAction: vi.fn(),
  addInterestAssignmentAction: vi.fn(),
  removeInterestAssignmentAction: vi.fn(),
}));

vi.mock("@/features/profile/assignment-actions", () => actionMock);

const SKILL_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_SKILL_ID = "4c3b6e2a-1f0e-4c2b-9f5a-7d1e2c3b4a59";
const INTEREST_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

/**
 * In the order the taxonomy read boundary returns it: category, then name.
 */
const taxonomy: TaxonomySkill[] = [
  {
    id: OTHER_SKILL_ID,
    slug: "postgres",
    name: "PostgreSQL",
    category: "Data",
  },
  {
    id: SKILL_ID,
    slug: "typescript",
    name: "TypeScript",
    category: "Languages",
  },
];

const interestTaxonomy: TaxonomyInterest[] = [
  { id: INTEREST_ID, slug: "open-source", name: "Open source" },
];

const assignment: AssignedSkill = {
  skillId: SKILL_ID,
  slug: "typescript",
  name: "TypeScript",
  category: "Languages",
  proficiencyLevel: "ADVANCED",
  yearsExperience: 7,
};

const assignments: AssignedSkill[] = [assignment];

const interestAssignments: AssignedInterest[] = [
  { interestId: INTEREST_ID, slug: "open-source", name: "Open source" },
];

function renderSkills(
  overrides: {
    assignments?: readonly AssignedSkill[];
    taxonomy?: readonly TaxonomySkill[];
  } = {},
) {
  return render(
    <SkillsSection
      assignments={overrides.assignments ?? []}
      taxonomy={overrides.taxonomy ?? taxonomy}
    />,
  );
}

function renderInterests(
  overrides: {
    assignments?: readonly AssignedInterest[];
    taxonomy?: readonly TaxonomyInterest[];
  } = {},
) {
  return render(
    <InterestsSection
      assignments={overrides.assignments ?? []}
      taxonomy={overrides.taxonomy ?? interestTaxonomy}
    />,
  );
}

/**
 * The rendered assignment entries.
 *
 * Scoped to the list because an assigned taxonomy name also appears in the
 * selector's `<option>`; a bare text query would match both.
 */
function assignedItem(index = 0) {
  const items = screen.getAllByRole("listitem");
  return within(items[index] as HTMLElement);
}

beforeEach(() => {
  vi.resetAllMocks();
  actionMock.saveSkillAssignmentAction.mockResolvedValue({
    ok: true,
    data: { skillName: "TypeScript", updated: false },
  });
  actionMock.removeSkillAssignmentAction.mockResolvedValue({
    ok: true,
    data: { skillId: SKILL_ID },
  });
  actionMock.addInterestAssignmentAction.mockResolvedValue({
    ok: true,
    data: { interestName: "Open source" },
  });
  actionMock.removeInterestAssignmentAction.mockResolvedValue({
    ok: true,
    data: { interestId: INTEREST_ID },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("skills section", () => {
  it("exposes the section title as a level-two heading", () => {
    renderSkills();

    const heading = screen.getByRole("heading", { name: "Skills" });
    expect(heading).toBeVisible();
    expect(heading).toHaveAttribute("aria-level", "2");
  });

  it("renders taxonomy options grouped by category", () => {
    renderSkills();

    const select = screen.getByLabelText("Add or update a skill");
    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      (group) => group.getAttribute("label"),
    );

    expect(groups).toEqual(["Data", "Languages"]);
    expect(
      within(select).getByRole("option", { name: "TypeScript" }),
    ).toHaveValue(SKILL_ID);
  });

  it("keeps an already-assigned skill selectable so it can be updated", () => {
    renderSkills({ assignments });

    const select = screen.getByLabelText("Add or update a skill");
    expect(
      within(select).getByRole("option", { name: "TypeScript" }),
    ).toBeInTheDocument();
  });

  it("renders existing assignments with proficiency and years", () => {
    renderSkills({ assignments });

    expect(assignedItem().getByText("TypeScript")).toBeVisible();
    expect(assignedItem().getByText("Advanced · 7 yr")).toBeVisible();
  });

  it("omits the years suffix when years of experience is null", () => {
    renderSkills({
      assignments: [{ ...assignment, yearsExperience: null }],
    });

    expect(assignedItem().getByText("Advanced")).toBeVisible();
  });

  it("renders an empty state when no skills are assigned", () => {
    renderSkills();

    expect(
      screen.getByText("You have not added any skills yet."),
    ).toBeVisible();
  });

  it("shows a safe unavailable state and no form when taxonomy is empty", () => {
    renderSkills({ taxonomy: [] });

    expect(
      screen.getByText(
        "Skills are not available right now. Please try again later.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("Add or update a skill"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save skill" }),
    ).not.toBeInTheDocument();
  });

  it("offers exactly the four approved proficiency options", () => {
    renderSkills();

    const options = Array.from(
      screen.getByLabelText("Proficiency").querySelectorAll("option"),
    ).map((option) => option.getAttribute("value"));

    expect(options).toEqual(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"]);
  });

  it("exposes accessible labels, hints, and a bounded years input", () => {
    renderSkills();

    const years = screen.getByLabelText("Years of experience");
    expect(years).toHaveAttribute("type", "number");
    expect(years).toHaveAttribute("min", "0");
    expect(years).toHaveAttribute("max", "100");
    expect(years).toHaveAttribute("inputmode", "numeric");
    expect(years).toHaveAttribute("aria-describedby");

    expect(screen.getByLabelText("Add or update a skill")).toHaveAttribute(
      "aria-describedby",
    );
  });

  it("submits the selected skill, proficiency, and years", async () => {
    const user = userEvent.setup();
    renderSkills();

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.selectOptions(screen.getByLabelText("Proficiency"), "EXPERT");
    await user.type(screen.getByLabelText("Years of experience"), "7");
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    await waitFor(() =>
      expect(actionMock.saveSkillAssignmentAction).toHaveBeenCalledTimes(1),
    );
    expect(actionMock.saveSkillAssignmentAction).toHaveBeenCalledWith({
      skillId: SKILL_ID,
      proficiencyLevel: "EXPERT",
      yearsExperience: 7,
    });

    expect(await screen.findByText("Added TypeScript.")).toBeVisible();
  });

  it("submits null years when the input is left empty", async () => {
    const user = userEvent.setup();
    renderSkills();

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    await waitFor(() =>
      expect(actionMock.saveSkillAssignmentAction).toHaveBeenCalledTimes(1),
    );
    // The resolver normalizes empty browser input to null before the action runs.
    expect(actionMock.saveSkillAssignmentAction).toHaveBeenCalledWith({
      skillId: SKILL_ID,
      proficiencyLevel: "BEGINNER",
      yearsExperience: null,
    });
  });

  it("reports an update when the saved skill was already assigned", async () => {
    const user = userEvent.setup();
    actionMock.saveSkillAssignmentAction.mockResolvedValue({
      ok: true,
      data: { skillName: "TypeScript", updated: true },
    });
    renderSkills({ assignments });

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.selectOptions(screen.getByLabelText("Proficiency"), "EXPERT");
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    expect(await screen.findByText("Updated TypeScript.")).toBeVisible();
  });

  it("blocks submission without a selected skill", async () => {
    const user = userEvent.setup();
    renderSkills();

    await user.click(screen.getByRole("button", { name: "Save skill" }));

    expect(await screen.findByText("Select a skill.")).toBeVisible();
    expect(actionMock.saveSkillAssignmentAction).not.toHaveBeenCalled();
  });

  it("blocks out-of-range years before calling the action", async () => {
    const user = userEvent.setup();
    renderSkills();

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.type(screen.getByLabelText("Years of experience"), "101");
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    expect(
      await screen.findByText("Enter a whole number between 0 and 100."),
    ).toBeVisible();
    expect(actionMock.saveSkillAssignmentAction).not.toHaveBeenCalled();
  });

  it("surfaces a taxonomy-unavailable failure from the action", async () => {
    const user = userEvent.setup();
    actionMock.saveSkillAssignmentAction.mockResolvedValue({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Selected skill is unavailable.",
    });
    renderSkills();

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    expect(
      await screen.findByText("Selected skill is unavailable."),
    ).toBeVisible();
  });

  it("surfaces a server field error returned by the action", async () => {
    const user = userEvent.setup();
    actionMock.saveSkillAssignmentAction.mockResolvedValue({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Check the highlighted fields.",
      fieldErrors: { yearsExperience: ["That value is not allowed."] },
    });
    renderSkills();

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    expect(await screen.findByText("That value is not allowed.")).toBeVisible();
  });

  it("never leaks a raw database error from a thrown failure", async () => {
    const user = userEvent.setup();
    actionMock.saveSkillAssignmentAction.mockRejectedValue(
      new Error("prisma: relation UserSkill does not exist"),
    );
    renderSkills();

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    expect(
      await screen.findByText(
        "We couldn't update your skills right now. Please try again in a moment.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/relation UserSkill does not exist/),
    ).not.toBeInTheDocument();
  });

  it("disables the save button while a submission is pending", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    actionMock.saveSkillAssignmentAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              data: { skillName: "TypeScript", updated: false },
            });
        }),
    );
    renderSkills();

    await user.selectOptions(
      screen.getByLabelText("Add or update a skill"),
      SKILL_ID,
    );
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    const pending = await screen.findByRole("button", { name: "Saving…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    release?.();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save skill" })).toBeEnabled(),
    );
  });

  it("removes an assigned skill via an accessible named action", async () => {
    const user = userEvent.setup();
    renderSkills({ assignments });

    await user.click(screen.getByRole("button", { name: "Remove TypeScript" }));

    await waitFor(() =>
      expect(actionMock.removeSkillAssignmentAction).toHaveBeenCalledWith({
        skillId: SKILL_ID,
      }),
    );
    expect(await screen.findByText("Skill removed.")).toBeVisible();
  });

  it("marks the remove button busy and disabled while pending", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    actionMock.removeSkillAssignmentAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, data: { skillId: SKILL_ID } });
        }),
    );
    renderSkills({ assignments });

    await user.click(screen.getByRole("button", { name: "Remove TypeScript" }));

    const pending = await screen.findByRole("button", { name: "Removing…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    release?.();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove TypeScript" }),
      ).toBeEnabled(),
    );
  });

  it("shows a safe message when removal fails", async () => {
    const user = userEvent.setup();
    actionMock.removeSkillAssignmentAction.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "We couldn't update your skills right now. Please try again in a moment.",
    });
    renderSkills({ assignments });

    await user.click(screen.getByRole("button", { name: "Remove TypeScript" }));

    expect(
      await screen.findByText(
        "We couldn't update your skills right now. Please try again in a moment.",
      ),
    ).toBeVisible();
  });

  it("never renders a taxonomy mutation control or protected field input", () => {
    const { container } = renderSkills({ assignments });

    expect(
      screen.queryByRole("button", { name: /create|add skill(?!$)/i }),
    ).not.toBeInTheDocument();
    for (const name of [
      "userId",
      "name",
      "slug",
      "nameKey",
      "category",
      "accountStatus",
      "globalRole",
    ]) {
      expect(
        container.querySelector(`[name="${name}"]`),
        `${name} must not be present`,
      ).toBeNull();
    }
  });
});

describe("interests section", () => {
  it("exposes the section title as a level-two heading", () => {
    renderInterests();

    const heading = screen.getByRole("heading", { name: "Interests" });
    expect(heading).toBeVisible();
    expect(heading).toHaveAttribute("aria-level", "2");
  });

  it("renders taxonomy options", () => {
    renderInterests();

    const select = screen.getByLabelText("Add an interest");
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    expect(
      within(select).getByRole("option", { name: "Open source" }),
    ).toHaveValue(INTEREST_ID);
  });

  it("renders existing assignments", () => {
    renderInterests({ assignments: interestAssignments });

    expect(assignedItem().getByText("Open source")).toBeVisible();
  });

  it("renders an empty state when no interests are assigned", () => {
    renderInterests();

    expect(
      screen.getByText("You have not added any interests yet."),
    ).toBeVisible();
  });

  it("shows a safe unavailable state when taxonomy is empty", () => {
    renderInterests({ taxonomy: [] });

    expect(
      screen.getByText(
        "Interests are not available right now. Please try again later.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add interest" }),
    ).not.toBeInTheDocument();
  });

  it("adds a selected interest", async () => {
    const user = userEvent.setup();
    renderInterests();

    await user.selectOptions(
      screen.getByLabelText("Add an interest"),
      INTEREST_ID,
    );
    await user.click(screen.getByRole("button", { name: "Add interest" }));

    await waitFor(() =>
      expect(actionMock.addInterestAssignmentAction).toHaveBeenCalledWith({
        interestId: INTEREST_ID,
      }),
    );
    expect(await screen.findByText("Open source added.")).toBeVisible();
  });

  it("allows re-adding an already-assigned interest without a client-side block", async () => {
    const user = userEvent.setup();
    renderInterests({ assignments: interestAssignments });

    await user.selectOptions(
      screen.getByLabelText("Add an interest"),
      INTEREST_ID,
    );
    await user.click(screen.getByRole("button", { name: "Add interest" }));

    await waitFor(() =>
      expect(actionMock.addInterestAssignmentAction).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Open source added.")).toBeVisible();
  });

  it("blocks submission without a selected interest", async () => {
    const user = userEvent.setup();
    renderInterests();

    await user.click(screen.getByRole("button", { name: "Add interest" }));

    expect(await screen.findByText("Select an interest.")).toBeVisible();
    expect(actionMock.addInterestAssignmentAction).not.toHaveBeenCalled();
  });

  it("surfaces a taxonomy-unavailable failure from the action", async () => {
    const user = userEvent.setup();
    actionMock.addInterestAssignmentAction.mockResolvedValue({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Selected interest is unavailable.",
    });
    renderInterests();

    await user.selectOptions(
      screen.getByLabelText("Add an interest"),
      INTEREST_ID,
    );
    await user.click(screen.getByRole("button", { name: "Add interest" }));

    expect(
      await screen.findByText("Selected interest is unavailable."),
    ).toBeVisible();
  });

  it("never leaks a raw database error from a thrown failure", async () => {
    const user = userEvent.setup();
    actionMock.addInterestAssignmentAction.mockRejectedValue(
      new Error("prisma: unique constraint failed on UserInterest"),
    );
    renderInterests();

    await user.selectOptions(
      screen.getByLabelText("Add an interest"),
      INTEREST_ID,
    );
    await user.click(screen.getByRole("button", { name: "Add interest" }));

    expect(
      await screen.findByText(
        "We couldn't update your interests right now. Please try again in a moment.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/unique constraint failed/),
    ).not.toBeInTheDocument();
  });

  it("disables the add button while a submission is pending", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    actionMock.addInterestAssignmentAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ok: true, data: { interestName: "Open source" } });
        }),
    );
    renderInterests();

    await user.selectOptions(
      screen.getByLabelText("Add an interest"),
      INTEREST_ID,
    );
    await user.click(screen.getByRole("button", { name: "Add interest" }));

    const pending = await screen.findByRole("button", { name: "Adding…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");

    release?.();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add interest" }),
      ).toBeEnabled(),
    );
  });

  it("removes an assigned interest via an accessible named action", async () => {
    const user = userEvent.setup();
    renderInterests({ assignments: interestAssignments });

    await user.click(
      screen.getByRole("button", { name: "Remove Open source" }),
    );

    await waitFor(() =>
      expect(actionMock.removeInterestAssignmentAction).toHaveBeenCalledWith({
        interestId: INTEREST_ID,
      }),
    );
    expect(await screen.findByText("Interest removed.")).toBeVisible();
  });

  it("shows a safe message when removal fails", async () => {
    const user = userEvent.setup();
    actionMock.removeInterestAssignmentAction.mockResolvedValue({
      ok: false,
      code: "INTERNAL_ERROR",
      message:
        "We couldn't update your interests right now. Please try again in a moment.",
    });
    renderInterests({ assignments: interestAssignments });

    await user.click(
      screen.getByRole("button", { name: "Remove Open source" }),
    );

    expect(
      await screen.findByText(
        "We couldn't update your interests right now. Please try again in a moment.",
      ),
    ).toBeVisible();
  });

  it("never renders a taxonomy mutation control or protected field input", () => {
    const { container } = renderInterests({ assignments: interestAssignments });

    expect(
      screen.queryByRole("button", { name: /create/i }),
    ).not.toBeInTheDocument();
    for (const name of [
      "userId",
      "name",
      "slug",
      "nameKey",
      "accountStatus",
      "globalRole",
    ]) {
      expect(
        container.querySelector(`[name="${name}"]`),
        `${name} must not be present`,
      ).toBeNull();
    }
  });
});
