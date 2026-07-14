import type { SampleFrame } from "../../api";
import {
  SHELF_AVERAGE_CHANNEL,
  SHELF_CHANNELS,
  sortChannels,
} from "../../channelConfig";

export function getRawChannelCodes(samples: SampleFrame[]): string[] {
  const channels = new Set<string>();

  for (const sample of samples) {
    for (const measurement of sample.measurements) {
      channels.add(measurement.channel_code);
    }
  }

  return sortChannels([...channels]);
}

export function hasShelfAverageInputs(channels: string[]): boolean {
  const shelfChannelCount = SHELF_CHANNELS.filter((channel) =>
    channels.includes(channel),
  ).length;

  return shelfChannelCount >= 2;
}

export function withDerivedChannels(channels: string[]): string[] {
  if (!hasShelfAverageInputs(channels) || channels.includes(SHELF_AVERAGE_CHANNEL)) {
    return sortChannels(channels);
  }

  return sortChannels([...channels, SHELF_AVERAGE_CHANNEL]);
}
