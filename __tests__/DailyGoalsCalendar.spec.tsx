import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DailyGoalsCalendar from "@/components/dashboard/DailyGoalsCalendar";
import { getDailyGoalValues } from "@/actions/dailyGoals.actions";
import { toastError } from "@/lib/toast";

vi.mock("@/actions/dailyGoals.actions", () => ({
  getDailyGoalValues: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toastError: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("DailyGoalsCalendar", () => {
  const user = userEvent.setup();
  const today = "2026-10-05";

  const renderCalendar = () =>
    render(
      <DailyGoalsCalendar
        today={today}
        initialValues={{ "2026-10-01": { jobs: 3, hours: 2.5 } }}
      />,
    );

  const root = () => screen.getByRole("status").closest(".daily-goals-calendar")!;

  it("shows the current month from the initial values without fetching", () => {
    renderCalendar();
    expect(screen.getByRole("status")).toHaveTextContent("Oct 2026");
    expect(
      screen.getByText(/October 1: Jobs applied 3 of 5, Activity 2\.5 of 4 h/),
    ).toBeInTheDocument();
    expect(getDailyGoalValues).not.toHaveBeenCalled();
  });

  it("shows a legend naming both rings and their targets", () => {
    renderCalendar();
    expect(screen.getByText("Jobs applied")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("4 h")).toBeInTheDocument();
  });

  it("cannot navigate into future months", () => {
    renderCalendar();
    expect(screen.getByRole("button", { name: "Next month" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("fetches a month on first visit and caches it", async () => {
    (getDailyGoalValues as any).mockResolvedValue({
      success: true,
      data: { "2026-09-10": { jobs: 5, hours: 4 } },
    });
    renderCalendar();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(getDailyGoalValues).toHaveBeenCalledWith("2026-09");
    expect(
      await screen.findByText(/September 10: Jobs applied 5 of 5, Activity 4 of 4 h\. All goals met\./),
    ).toBeInTheDocument();
    expect(root()).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(getDailyGoalValues).toHaveBeenCalledTimes(1);
  });

  it("keeps the busy state for the month on screen", async () => {
    const sep = deferred<any>();
    const aug = deferred<any>();
    (getDailyGoalValues as any)
      .mockReturnValueOnce(sep.promise)
      .mockReturnValueOnce(aug.promise);
    renderCalendar();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(root()).toHaveAttribute("aria-busy", "true");

    // September settles while August is on screen: the dim must stay
    await act(async () => sep.resolve({ success: true, data: {} }));
    expect(root()).toHaveAttribute("aria-busy", "true");

    await act(async () => aug.resolve({ success: true, data: {} }));
    expect(root()).not.toHaveAttribute("aria-busy");
  });

  it("toasts a failed month and retries on the next visit", async () => {
    (getDailyGoalValues as any)
      .mockResolvedValueOnce({ success: false, message: "Boom" })
      .mockResolvedValueOnce({ success: true, data: {} });
    renderCalendar();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom"));
    expect(root()).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(getDailyGoalValues).toHaveBeenCalledTimes(2);
  });
});
