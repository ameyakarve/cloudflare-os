const BUILT_IN_BINDINGS = new Set(["GADGET"]);

/** Returns statically-declared Durable Object env dependencies from ordinary Gadget server code. */
export function referencedGadgetBindings(serverCode: string): string[] {
  const names = new Set<string>();
  for (const pattern of [
    /\bthis\s*\.\s*env\s*\.\s*([A-Za-z_$][\w$]*)/g,
    /\bthis\s*\.\s*env\s*\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]/g,
  ]) {
    for (const match of serverCode.matchAll(pattern)) names.add(match[1]);
  }
  for (const match of serverCode.matchAll(
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*this\s*\.\s*env\b/g,
  )) {
    for (const member of match[1].split(",")) {
      const name = member.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|=|$)/)?.[1];
      if (name) names.add(name);
    }
  }
  return [...names].filter(name => !BUILT_IN_BINDINGS.has(name)).toSorted();
}

export function missingGadgetBindings(
  serverCode: string,
  availableBindings: Iterable<string>,
): string[] {
  const available = new Set(availableBindings);
  return referencedGadgetBindings(serverCode).filter(name => !available.has(name));
}

export function assertGadgetBindingsAvailable(
  title: string,
  serverCode: string,
  availableBindings: Iterable<string>,
): void {
  const missing = missingGadgetBindings(serverCode, availableBindings);
  if (missing.length) {
    throw new Error(
      `Gadget ${JSON.stringify(title)} cannot start: server.js references missing bindings: ` +
      `${missing.join(", ")}. Wire these resources into the Gadget before running it.`,
    );
  }
}
