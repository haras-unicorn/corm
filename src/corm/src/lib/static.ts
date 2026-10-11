export const oneLine = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

export const oneLineRegex = (value: string): string =>
  value.replace(/\n/g, "").replace(/\\n/g, "\n").trim();
