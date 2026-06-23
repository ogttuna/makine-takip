import type { LiveSnapshot, TelemetrySample } from "./api";

const phases = ["freezing", "primary drying", "secondary drying"];

export function createDemoSnapshot(): LiveSnapshot {
  const now = Date.now();
  const samples: TelemetrySample[] = Array.from({ length: 140 }, (_, index) => {
    const age = 139 - index;
    const minutes = index * 2;
    const phase = phases[Math.min(2, Math.floor(index / 52))];
    const shelf = -42 + minutes * 0.42 + Math.sin(index / 8) * 1.8;
    const product = -38 + minutes * 0.35 + Math.sin(index / 11) * 1.2;
    const condenser = -64 + Math.sin(index / 14) * 1.6;
    const pressure = Math.max(0.045, 780 * Math.exp(-index / 19) + 0.06);

    return {
      timestamp: new Date(now - age * 30_000).toISOString(),
      shelf_temp_c: Number(shelf.toFixed(2)),
      product_temp_c: Number(product.toFixed(2)),
      condenser_temp_c: Number(condenser.toFixed(2)),
      chamber_pressure_mbar: Number(pressure.toFixed(4)),
      phase,
    };
  });

  return {
    status: "demo",
    active_run: {
      id: 1,
      recipe_name: "Demo Lyophilization",
      batch_code: "DEV-001",
      started_at: samples[0].timestamp,
      finished_at: null,
      status: "running",
    },
    samples,
  };
}
