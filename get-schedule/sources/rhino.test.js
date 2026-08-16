import { describe, it, expect } from "vitest";
import { findRhinoScheduleTable } from "./rhino.js";

function createCell(textContent, tagName = "td") {
  return {
    tagName,
    textContent,
    querySelectorAll() {
      return [];
    }
  };
}

function createRow(cells) {
  return {
    querySelectorAll(selector) {
      if (selector === "td, th") {
        return cells;
      }
      if (selector === "td") {
        return cells.filter((cell) => cell.tagName === "td");
      }
      if (selector === "th") {
        return cells.filter((cell) => cell.tagName === "th");
      }
      return [];
    }
  };
}

function createTable({ id = "", rows = [] }) {
  return {
    tagName: "TABLE",
    id,
    className: "",
    querySelectorAll(selector) {
      if (selector === "tbody tr, thead tr, tr") {
        return rows;
      }
      if (selector === "tr") {
        return rows;
      }
      return [];
    }
  };
}

function createDocument(tables) {
  return {
    querySelector(selector) {
      return tables.find((table) => {
        if (selector === "table#dgResults") {
          return table.id === "dgResults";
        }
        if (selector === "table[id*=\"dgResults\"]") {
          return table.id.includes("dgResults");
        }
        if (selector === "table") {
          return table.tagName === "TABLE";
        }
        return false;
      }) || null;
    }
  };
}

describe("rhino schedule table detection", () => {
  it("finds a schedule table when the id is not exactly dgResults", () => {
    const table = createTable({
      id: "ctl00_ContentPlaceHolder1_dgResults",
      rows: [
        createRow([
          createCell("Date", "th"),
          createCell("Time", "th"),
          createCell("Show", "th"),
          createCell("Venue", "th"),
          createCell("Location", "th"),
          createCell("Client", "th")
        ]),
        createRow([
          createCell("6/1/2026"),
          createCell("8:00"),
          createCell("Show Name"),
          createCell("Venue Name"),
          createCell("Location"),
          createCell("Client")
        ])
      ]
    });

    const doc = createDocument([table]);
    const found = findRhinoScheduleTable(doc);

    expect(found).toBe(table);
  });
});
