import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteSelfieButton } from "./DeleteSelfieButton";
import { SelfieDialog } from "./SelfieDialog";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/selfie.functions", () => ({ deleteSelfie: mocks.remove }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
const id = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reset = vi.spyOn(client, "resetQueries");
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <DeleteSelfieButton id={id} revision={revision} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { onDeleted, reset, invalidate };
}

describe("delete selfie confirmation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("explains the check-in/streak impact and allows cancellation without deleting", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Your streak may decrease");
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("deletes the exact revision once and refreshes the personal and social views", async () => {
    let finish: (() => void) | undefined;
    mocks.remove.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true });
        }),
    );
    const { onDeleted, reset, invalidate } = show();
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie and check-in" }));
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ data: { id, revision } });
    await act(async () => {
      finish?.();
    });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(reset).toHaveBeenCalledWith({ queryKey: ["feed"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["social"] });
    expect(mocks.success).toHaveBeenCalledWith("Selfie and check-in deleted.");
  });

  it("keeps the confirmation open with an explicit failure and supports retrying", async () => {
    mocks.remove
      .mockRejectedValueOnce(new Error("Could not delete the stored image."))
      .mockResolvedValueOnce({ ok: true });
    const { onDeleted, reset } = show();
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie and check-in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete the stored image");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie and check-in" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });

  it("disables deletion when the connection is lost without queuing an action", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie" }));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("button", { name: "Delete selfie and check-in" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Reconnect to delete");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("supports confirmation inside the calendar/today photo dialog", async () => {
    mocks.remove.mockResolvedValue({ ok: true });
    const onDeleted = vi.fn();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <SelfieDialog
          item={{
            id,
            revision,
            local_date: "2026-11-25",
            slot: "am",
            photo_path: `s3:${id}/${revision}.jpg`,
            verified: true,
            confidence: 0.9,
            created_at: "2026-11-25T10:00:00Z",
            url: "https://example.test/selfie.jpg",
          }}
          onClose={vi.fn()}
          onDeleted={onDeleted}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selfie and check-in" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledWith({ data: { id, revision } });
  });
});
