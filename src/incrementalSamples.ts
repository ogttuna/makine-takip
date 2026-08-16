import type { SampleFrame } from "./api";

export function lastSourceSequence(samples: SampleFrame[]): number | null {
  if (samples.length === 0) {
    return null;
  }

  return samples.reduce(
    (latest, sample) => Math.max(latest, sample.source_row_number),
    samples[0].source_row_number,
  );
}

export function mergeIncrementalSamples(
  current: SampleFrame[],
  incoming: SampleFrame[],
  limit: number,
): SampleFrame[] {
  if (incoming.length === 0) {
    return current;
  }

  const bySequence = new Map<number, SampleFrame>();
  for (const sample of current) {
    bySequence.set(sample.source_row_number, sample);
  }
  for (const sample of incoming) {
    bySequence.set(sample.source_row_number, sample);
  }

  return [...bySequence.values()]
    .sort((left, right) => left.source_row_number - right.source_row_number)
    .slice(-limit);
}
