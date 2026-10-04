// A glob rather than an import: the file is generated and gitignored, and a checkout without it still runs.
const found = import.meta.glob<Record<string, string>>('@pg/generated/docs.json', {
  eager: true,
  import: 'default',
});
const docs: Record<string, string> = Object.values(found)[0] ?? {};

/** A blits doc comment by its typedoc name, such as `VoiceSpec.loop`; undefined when docs were not generated. */
export const docOf = (path: string): string | undefined => docs[path];
