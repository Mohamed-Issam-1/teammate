import type { MouseEvent } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders a native button whose accessible name matches its label", () => {
    render(<Button>Invite teammate</Button>);

    const button = screen.getByRole("button", { name: "Invite teammate" });
    expect(button).toBeEnabled();
  });

  it("is reachable with the keyboard and activates on Enter", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Button onClick={onClick}>Apply to project</Button>);

    await user.tab();
    const button = screen.getByRole("button", { name: "Apply to project" });
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire click while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button disabled onClick={onClick}>
        Reject
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges onto its child element when asChild is set", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn((event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    });

    render(
      <Button asChild onClick={onClick}>
        <a href="/docs">Read the docs</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Read the docs" });
    await user.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
