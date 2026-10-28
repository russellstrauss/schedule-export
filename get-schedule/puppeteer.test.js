import { describe, expect, it } from "vitest";
import { gotoPortalPage, portalRequestAction } from "./puppeteer.js";

function runInPage(fn, expected, pageState) {
  const document = { readyState: pageState.readyState, body: { childNodes: [{}] } };
  const location = { pathname: pageState.pathname, href: pageState.href };
  const runner = new Function(
    "document",
    "location",
    "expected",
    `return (${fn.toString()})(expected);`
  );
  return runner(document, location, expected);
}

describe("portal navigation", () => {
  it("keeps stylesheets so document parsing can finish", () => {
    expect(portalRequestAction("stylesheet")).toBe("continue");
    expect(portalRequestAction("script")).toBe("continue");
    expect(portalRequestAction("image")).toBe("abort");
    expect(portalRequestAction("font")).toBe("abort");
    expect(portalRequestAction("media")).toBe("abort");
  });

  it("waits for DOMContentLoaded", async () => {
    const calls = [];
    const page = {
      async goto(_url, opts) {
        calls.push(opts);
      }
    };

    await gotoPortalPage(page, "https://portal.crew1.com/");

    expect(calls).toEqual([{ waitUntil: "domcontentloaded", timeout: 90000 }]);
  });

  it("continues when the target document is already parsed after a navigation timeout", async () => {
    const page = {
      async goto() {
        throw new Error("Navigation timeout of 90000 ms exceeded");
      },
      async evaluate(fn, expected) {
        return runInPage(fn, expected, {
          readyState: "interactive",
          pathname: "/dashboard",
          href: "https://portal.crew1.com/dashboard"
        });
      }
    };

    await expect(gotoPortalPage(page, "https://portal.crew1.com/dashboard")).resolves.toBeUndefined();
  });

  it("still fails when the timeout is for a different page", async () => {
    const page = {
      async goto() {
        throw new Error("Navigation timeout of 90000 ms exceeded");
      },
      async evaluate(fn, expected) {
        return runInPage(fn, expected, {
          readyState: "complete",
          pathname: "/",
          href: "https://portal.crew1.com/"
        });
      }
    };

    await expect(gotoPortalPage(page, "https://portal.crew1.com/view_upcoming")).rejects.toThrow(
      /Navigation timeout/
    );
  });
});
