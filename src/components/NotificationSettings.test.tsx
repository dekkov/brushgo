import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationSettings } from "./NotificationSettings";

const mocks = vi.hoisted(() => ({ action: vi.fn(), enable: vi.fn() }));
vi.mock("@/lib/push.functions", () => ({ pushAction: mocks.action }));
vi.mock("@/lib/push-device", () => ({
  pushConfigured: true,
  supportsPush: () => true,
  deviceSubscription: async () => undefined,
  enableDeviceNotifications: mocks.enable,
  disableDeviceNotifications: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer" }, loading: false }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("changes account preferences without prompting and asks only from the device button", async () => {
  const permission = vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("Notification", { permission: "default", requestPermission: permission });
  mocks.action
    .mockResolvedValueOnce({ attached: false, enabled: [] })
    .mockResolvedValueOnce({ attached: false, enabled: ["reminder"] })
    .mockResolvedValue({ attached: true, enabled: ["reminder"] });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <NotificationSettings />
    </QueryClientProvider>,
  );
  const reminder = await screen.findByRole("checkbox", { name: /Brushing reminders/ });
  expect(reminder).not.toBeChecked();
  expect(permission).not.toHaveBeenCalled();
  fireEvent.click(reminder);
  await waitFor(() => expect(reminder).toBeChecked());
  expect(mocks.action).toHaveBeenCalledWith({
    data: { action: "set_preference", data: { kind: "reminder", enabled: true } },
  });
  expect(permission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enable on this device" }));
  expect(permission).toHaveBeenCalledOnce();
  await waitFor(() => expect(mocks.enable).toHaveBeenCalledWith("viewer", "granted"));
  expect(await screen.findByRole("button", { name: "Disable on this device" })).toBeEnabled();
});
