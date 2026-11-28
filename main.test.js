import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./get-schedule/get-schedule.js", () => ({
  default: vi.fn()
}));

vi.mock("./get-schedule/runtime-env.js", () => ({
  isCloudRuntime: vi.fn(() => true)
}));

vi.mock("./get-schedule/google-calendar/auth.js", () => ({
  exchangeOAuthCode: vi.fn()
}));

vi.mock("./get-schedule/ingest-iatse927.js", () => ({
  storeIatse927Message: vi.fn(async () => ({ stored: true, id: "message-1" })),
  trySyncIatse927FromStore: vi.fn(async () => ({ parsed: 1, synced: 1 }))
}));

import { syncSchedule } from "./main.js";
import getSchedule from "./get-schedule/get-schedule.js";
import { storeIatse927Message, trySyncIatse927FromStore } from "./get-schedule/ingest-iatse927.js";

function createResponse() {
  return {
    set: vi.fn(),
    status: vi.fn(function status() {
      return this;
    }),
    send: vi.fn(),
    json: vi.fn()
  };
}

describe("syncSchedule IATSE ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an ingest payload without a phone number", async () => {
    const body = {
      mode: "ingest",
      source: "iatse927",
      text: "IATSE schedule update"
    };
    const response = createResponse();

    await syncSchedule({ method: "POST", path: "/", query: {}, body }, response);

    expect(storeIatse927Message).toHaveBeenCalledWith(body);
    expect(trySyncIatse927FromStore).toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        stored: true,
        message: "IATSE 927 message stored and calendar sync completed",
        synced: 1
      })
    );
  });

  it("finishes the calendar sync before it responds", async () => {
    const order = [];
    storeIatse927Message.mockImplementationOnce(async () => {
      order.push("store");
      return { stored: true, id: "message-1" };
    });
    trySyncIatse927FromStore.mockImplementationOnce(async () => {
      order.push("sync");
      return { parsed: 2, synced: 2, warnings: [] };
    });
    const response = createResponse();
    response.json.mockImplementation(() => {
      order.push("json");
    });

    await syncSchedule(
      {
        method: "POST",
        path: "/",
        query: {},
        body: { mode: "ingest", source: "iatse927", text: "Confirmed Dec 6 and 28" }
      },
      response
    );

    expect(order).toEqual(["store", "sync", "json"]);
  });

  it("stores a phone POST that is only the SMS text and does not run a portal sync", async () => {
    const sms = "Copy confirmed thank you. 10pm Dec 6 and Dec 28 8am for load out";
    const response = createResponse();

    await syncSchedule({ method: "POST", path: "/", query: {}, body: { text: sms } }, response);

    expect(getSchedule).not.toHaveBeenCalled();
    expect(storeIatse927Message).toHaveBeenCalledWith(expect.objectContaining({ text: sms }));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        stored: true,
        message: "IATSE 927 message stored and calendar sync completed"
      })
    );
  });
});

describe("syncSchedule HTTP routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately for an explicit health check", async () => {
    const response = createResponse();

    await syncSchedule(
      { method: "GET", path: "/", query: { mode: "health" }, headers: {} },
      response
    );

    expect(getSchedule).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, status: "ready" })
    );
  });

  it("runs synchronization when the endpoint is opened", async () => {
    const response = createResponse();

    await syncSchedule(
      { method: "GET", path: "/", query: {}, headers: { "user-agent": "Mozilla/5.0" } },
      response
    );

    expect(getSchedule).toHaveBeenCalledOnce();
    expect(response.status).toHaveBeenCalledWith(200);
  });
});
