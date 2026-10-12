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
import { storeIatse927Message } from "./get-schedule/ingest-iatse927.js";

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
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, stored: true })
    );
  });
});
