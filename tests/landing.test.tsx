import { render, screen, queryAllByRole } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

function renderLanding() {
  const view = render(<Home />);
  return {
    ...view,
    interactive: [
      ...queryAllByRole(view.container, "button"),
      ...queryAllByRole(view.container, "link"),
    ],
  };
}

describe("landing page", () => {
  it("renders the TeamMate identity with a single page-level heading", () => {
    render(<Home />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/team/i);
    expect(
      screen.getByText(/project team formation, made structured/i),
    ).toBeInTheDocument();
    expect(screen.getByText("TeamMate")).toBeInTheDocument();
  });

  it("describes the core platform capabilities", () => {
    render(<Home />);

    for (const title of [
      "Structured profiles",
      "Projects and applications",
      "Shared workspace",
      "Explainable AI matching",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("offers no functional authentication action in Phase 0", () => {
    const { interactive } = renderLanding();

    // Any sign-in style control must be clearly non-functional (disabled).
    const authControls = interactive.filter((element) =>
      /sign in|log in|get started|create account/i.test(
        element.textContent ?? "",
      ),
    );
    expect(authControls.length).toBeGreaterThan(0);
    for (const control of authControls) {
      expect(control).toBeDisabled();
    }

    // No link may lead to an auth-looking route while auth does not exist.
    const authLinks = interactive
      .filter((element) => element.getAttribute("href") !== null)
      .filter((element) =>
        /sign|log|auth|onboard/i.test(element.getAttribute("href") ?? ""),
      );
    expect(authLinks).toHaveLength(0);
  });
});
