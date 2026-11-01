import assert from "node:assert/strict";
import { test } from "node:test";
import { monthDayTime } from "../app/lib/format.ts";

test("timestamps include the year only when it differs from the current Beijing year", () => {
  const before = Date.parse("2026-12-31T15:59:59Z");
  const after = Date.parse("2026-12-31T16:00:01Z");
  assert.equal(monthDayTime("2026-12-31T15:30:00Z", before), "12月31日 23:30");
  assert.equal(monthDayTime("2026-12-31T16:30:00Z", before), "2027年1月1日 00:30");
  assert.equal(monthDayTime("2026-12-31T15:30:00Z", after), "2026年12月31日 23:30");
  assert.equal(monthDayTime("2026-12-31T16:30:00Z", after), "1月1日 00:30");
  assert.equal(monthDayTime("2019-02-19T04:00:00Z", after), "2019年2月19日 12:00");
});
