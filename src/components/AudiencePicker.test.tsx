import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudiencePicker } from "./AudiencePicker";

afterEach(cleanup);
describe("capture audience control", () => {
  it("does not select anybody when a remembered selection is empty", () => {
    render(
      <AudiencePicker
        audience="selected_friends"
        friendshipIds={[]}
        friends={[]}
        onChange={vi.fn()}
        disabled={false}
        canShare
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Select at least one current friend");
    expect(screen.getByRole("combobox")).toHaveValue("selected_friends");
  });
  it("selects explicit friendship IDs rather than automatically adding friends", () => {
    const change = vi.fn();
    render(
      <AudiencePicker
        audience="selected_friends"
        friendshipIds={[]}
        friends={[
          { friendship_id: "friendship", user_id: "person", display_name: "Ada", streak: 4 },
        ]}
        onChange={change}
        disabled={false}
        canShare
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Ada" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(change).toHaveBeenCalledWith("selected_friends", ["friendship"]);
  });
  it("requires a display name before sharing and disables controls offline", () => {
    render(
      <AudiencePicker
        audience="only_me"
        friendshipIds={[]}
        friends={[]}
        onChange={vi.fn()}
        disabled
        canShare={false}
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("option", { name: /All friends/ })).toBeDisabled();
    expect(screen.getByText(/Choose a display name/)).toBeInTheDocument();
  });
});
