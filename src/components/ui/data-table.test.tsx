// @vitest-environment jsdom
import type { ColumnDef } from "@tanstack/react-table";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataTable } from "./data-table";

type Row = { name: string; visits: number };

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "visits", header: "Visits" },
];

const data: Row[] = [
  { name: "Charlie", visits: 3 },
  { name: "alpha", visits: 20 },
  { name: "Bravo", visits: 100 },
];

afterEach(cleanup);

function names(): string[] {
  const body = screen.getAllByRole("rowgroup")[1]!;
  return within(body)
    .getAllByRole("row")
    .map((row) => row.querySelectorAll("td")[0]?.textContent ?? "");
}

describe("DataTable", () => {
  it("shows all rows with a table name", () => {
    render(<DataTable label="People" columns={columns} data={data} />);
    expect(screen.getByRole("table", { name: "People" })).toBeTruthy();
    expect(names()).toEqual(["Charlie", "alpha", "Bravo"]);
  });

  it("sorts when a header is clicked and reports it for screen readers", () => {
    render(<DataTable label="People" columns={columns} data={data} />);
    const header = () => screen.getByRole("columnheader", { name: /Visits/ });
    expect(header().getAttribute("aria-sort")).toBe("none");
    // Number columns sort high to low on the first click.
    fireEvent.click(screen.getByRole("button", { name: /Visits/ }));
    expect(names()).toEqual(["Bravo", "alpha", "Charlie"]);
    expect(header().getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: /Visits/ }));
    expect(names()).toEqual(["Charlie", "alpha", "Bravo"]);
    expect(header().getAttribute("aria-sort")).toBe("ascending");
  });

  it("filters rows from the search box and says when nothing matches", () => {
    render(<DataTable label="People" columns={columns} data={data} />);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "bra" } });
    expect(names()).toEqual(["Bravo"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches your search.")).toBeTruthy();
  });

  it("pages through rows", () => {
    render(<DataTable label="People" columns={columns} data={data} pageSize={2} />);
    expect(names()).toHaveLength(2);
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(names()).toEqual(["Bravo"]);
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the empty state when there is no data", () => {
    render(<DataTable label="People" columns={columns} data={[]} empty={<p>No people yet.</p>} />);
    expect(screen.getByText("No people yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
