import { expect, test } from "@playwright/test";

/**
 * The approval gate. The local run engine (runsStore) advances each run a frame
 * at a time on a ~2.2s heartbeat. A run launched from "ship …"/"/run …" opens at
 * frame 2 with no gate, ticks up to the deploy gate (frame 4 = GATE_FRAME), and
 * pauses there with gate "pending". watchApprovals bridges that to the chat: it
 * posts an approval card into the transcript and raises a "1 approval waiting"
 * toast. Approving on the card resolves the gate, the run resumes past the gate,
 * and the watcher marks the waiting toast done.
 *
 * No mocks: this drives the real engine + watcher. The only non-determinism is
 * the interval, so every "reaches pending" / "resumes" assertion uses a generous
 * timeout and asserts on rendered state (card class/title, toast status text),
 * never on a wall-clock or a timer count. The approval card carries stable
 * data-testids (approval-card / approval-approve); assertions on the resolved
 * state and the run card use the rendered text + classes from the components.
 */

// The interval-driven advance to the gate (frame 2 -> 4) takes a couple of
// heartbeats; the resume past it takes more. Keep these well above 2 * 2.2s.
const GATE_TIMEOUT = 25_000;

// The single "1 approval waiting" toast, scoped to the live region so nothing
// else in the corner stack collides with it.
const waitingToast = (page: import("@playwright/test").Page) =>
  page.locator(".toast-stack").locator(".toast", { hasText: "1 approval waiting" });

test.describe("approval gate", () => {
  test("a launched run pauses at the deploy gate and resumes once approved", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });

    // "ship …" launches a run: it posts a live run card into the transcript and
    // the engine starts advancing it toward the deploy gate.
    await input.fill("ship auth refactor");
    await input.press("Enter");

    const transcript = page.getByRole("log");
    const runCard = transcript.locator('[data-testid="run-card"]');
    await expect(runCard).toBeVisible();

    // The run advances on the heartbeat until it hits the gate. When it does, the
    // watcher posts the approval card (pending) and the waiting toast — both are
    // the rendered signal that the gate reached "pending".
    const approvalCard = transcript.locator('[data-testid="approval-card"]');
    await expect(approvalCard).toBeVisible({ timeout: GATE_TIMEOUT });
    await expect(approvalCard).toHaveClass(/is-pending/);
    await expect(approvalCard.locator(".card-title")).toHaveText("Approval needed");

    const toast = waitingToast(page);
    await expect(toast).toBeVisible({ timeout: GATE_TIMEOUT });
    await expect(toast.locator(".toast-title")).toHaveText("1 approval waiting");
    // A pending workflow toast reads "Running" until the gate resolves.
    await expect(toast.locator(".toast-status")).toHaveText("Running");

    // Approve via the card. The button lives on the pending card itself.
    await approvalCard.locator('[data-testid="approval-approve"]').click();

    // The gate resolves: the card flips to its approved state in place.
    await expect(approvalCard).toHaveClass(/is-approved/);
    await expect(approvalCard.locator(".card-title")).toHaveText("Approved · deploy");

    // The watcher marks the waiting toast done, so it stops reading "Running".
    await expect(toast.locator(".toast-status")).toHaveText("Done");

    // With the gate approved the engine advances past it; the run reaches its
    // terminal "ok" state rather than staying "waiting". Assert on the run card's
    // status pill (rendered state), not on the number of ticks.
    await expect(runCard.locator(".status-pill")).toHaveText(/ok/, {
      timeout: GATE_TIMEOUT,
    });
  });

  test("/approvals surfaces the pending gate while it waits", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/run session rotation");
    await input.press("Enter");

    const transcript = page.getByRole("log");

    // Wait for the run to reach the gate (the watcher's auto-posted pending card).
    const gateCard = transcript.locator('[data-testid="approval-card"].is-pending');
    await expect(gateCard).toBeVisible({ timeout: GATE_TIMEOUT });

    // While a gate is pending, "/approvals" re-surfaces it as another approval
    // card rather than the "No approvals waiting." line. Posting a second card
    // means two approval cards are now in the transcript.
    await input.fill("/approvals");
    await input.press("Enter");

    await expect(
      transcript.locator('[data-testid="approval-card"]'),
    ).toHaveCount(2);
    await expect(
      transcript.getByText("No approvals waiting."),
    ).toHaveCount(0);
  });
});
