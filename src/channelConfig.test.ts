import assert from "node:assert/strict";
import test from "node:test";

import { getChannelConfig } from "./channelConfig.ts";

test("keeps mass, power, and accumulated energy in separate physical groups", () => {
  const mass = getChannelConfig("TARTIM");
  const power = getChannelConfig("E.GUC");
  const energy = getChannelConfig("E.TUKETIM");

  assert.equal(mass.group, "mass");
  assert.equal(power.group, "power");
  assert.equal(energy.group, "energy");
  assert.equal(new Set([mass.group, power.group, energy.group]).size, 3);
});

test("publishes explicit units and independent axes for operational channels", () => {
  assert.deepEqual(
    ["TARTIM", "E.GUC", "E.TUKETIM"].map((code) => {
      const config = getChannelConfig(code);
      return [config.axis, config.unit];
    }),
    [
      ["mass", "kg"],
      ["power", "kW"],
      ["energy", "kWh"],
    ],
  );
});

test("uses a logarithmic vacuum axis distinct from pressure", () => {
  const vacuum = getChannelConfig("VACUM");
  const lowPressure = getChannelConfig("L_PRES");

  assert.equal(vacuum.unit, "mbar");
  assert.equal(vacuum.axis, "vacuum");
  assert.equal(vacuum.scale, "log");
  assert.equal(lowPressure.unit, "bar");
  assert.equal(lowPressure.axis, "pressure");
});

test("keeps known temperature roles in celsius and maps S channels to the cooling circuit", () => {
  const shelf = getChannelConfig("RAF1");
  const coilSensor = getChannelConfig("S1");
  const cooling = getChannelConfig("KONDANSER");

  assert.equal(shelf.unit, "°C");
  assert.equal(coilSensor.unit, "°C");
  assert.equal(cooling.unit, "°C");
  assert.deepEqual(
    [shelf.group, coilSensor.group, cooling.group],
    ["shelf_temperature", "cooling_temperature", "cooling_temperature"],
  );
});
