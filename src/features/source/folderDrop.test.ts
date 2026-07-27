import assert from "node:assert/strict";
import test from "node:test";

import {
  physicalPointIsInsideBounds,
  singleDroppedPath,
} from "./folderDrop.ts";

test("accepts exactly one non-empty dropped path", () => {
  assert.equal(singleDroppedPath(["C:\\MachineLogs\\FD750"]), "C:\\MachineLogs\\FD750");
  assert.equal(singleDroppedPath([]), null);
  assert.equal(singleDroppedPath(["one", "two"]), null);
  assert.equal(singleDroppedPath(["   "]), null);
});

test("maps Tauri physical coordinates to CSS drop-zone bounds", () => {
  const bounds = {
    left: 100,
    right: 300,
    top: 50,
    bottom: 150,
  };

  assert.equal(physicalPointIsInsideBounds({ x: 400, y: 200 }, 2, bounds), true);
  assert.equal(physicalPointIsInsideBounds({ x: 602, y: 200 }, 2, bounds), false);
  assert.equal(physicalPointIsInsideBounds({ x: 100, y: 50 }, 0, bounds), true);
});
