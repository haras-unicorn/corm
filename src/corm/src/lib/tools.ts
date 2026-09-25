const blockText = (block: unknown): string | undefined => {
  if (
    block != null &&
    typeof block === "object" &&
    "text" in block &&
    typeof (block as { text?: unknown }).text === "string"
  ) {
    return (block as { text: string }).text;
  }

  return undefined;
};

const structuredText = (result: ToolResult): string | undefined => {
  if (result.structuredContent === undefined) {
    return undefined;
  }

  const structured = result.structuredContent as { content?: unknown };
  return typeof structured?.content === "string"
    ? structured.content
    : undefined;
};

export const contentText = (result: ToolResult): string | undefined => {
  const structured = structuredText(result);
  if (structured !== undefined) {
    return structured;
  }

  const content = result.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      const text = blockText(block);
      if (text !== undefined) {
        return text;
      }
    }
  }

  return undefined;
};

export const toolResultText = (result: ToolResult | undefined): string => {
  if (result === undefined) {
    return "";
  }

  const structured = structuredText(result);
  if (structured !== undefined) {
    return structured;
  }

  const content = result.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map(blockText)
      .filter((text): text is string => text !== undefined);
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  return JSON.stringify(result.content ?? result.structuredContent ?? "");
};
