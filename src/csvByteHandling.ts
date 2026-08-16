export function completeLinePrefixLength(bytes: Uint8Array): number {
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    if (bytes[index] === 10) {
      return index + 1;
    }
  }
  return 0;
}

export function decodeCsvRows(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}
