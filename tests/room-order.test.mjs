import test from "node:test";
import assert from "node:assert/strict";
import { orderRooms, moveId } from "../src/lib/format.js";

const room = (id, status = "completed") => ({ id, status });
const ids = (list) => list.map((m) => m.id);

test("until you reorder, rooms that wait for you go first", () => {
  const rooms = [room("a"), room("b", "waiting"), room("c")];
  assert.deepEqual(ids(orderRooms(rooms)), ["b", "a", "c"]);
});

test("your order is kept, new rooms go on top, and waiting does not move them", () => {
  const rooms = [room("new"), room("a"), room("b", "waiting"), room("c")];
  assert.deepEqual(ids(orderRooms(rooms, ["c", "a", "b"])), ["new", "c", "a", "b"]);
});

test("moving a room before or after another", () => {
  assert.deepEqual(moveId(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveId(["a", "b", "c", "d"], "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(moveId(["a", "b"], "a", "a"), ["a", "b"]);
  assert.deepEqual(moveId(["a", "b"], "x", "a"), ["a", "b"]);
});
