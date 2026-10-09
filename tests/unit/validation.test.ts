import { describe, expect, it } from "vitest";
import { eventBody, parseOrThrow } from "../../src/api/schemas.js";

describe("event validation", () => {
  it("accepts a namespaced event with arbitrary JSON data", () => {
    expect(parseOrThrow(eventBody, { type: "order.completed", data: { order_id: "ord_1" } })).toEqual({
      type: "order.completed",
      data: { order_id: "ord_1" },
    });
  });

  it("rejects malformed event types and unknown fields", () => {
    expect(() => parseOrThrow(eventBody, { type: "order completed", data: {} })).toThrow();
    expect(() => parseOrThrow(eventBody, { type: "order.completed", data: {}, extra: true })).toThrow();
  });
});
