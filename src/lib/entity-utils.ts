/**
 * Collect entity reference images for visual consistency.
 * Used by both manual (ParameterPanel) and automated (react tools, branch-pipeline) image generation.
 */
export function getEntityImageList(
  entities: { characters: any[]; scenes: any[]; props: any[] } | null,
  entityRefs: string[] | undefined,
  characterName: string | null,
): { image: string }[] {
  if (!entities) return [];

  const images: { image: string }[] = [];
  const refs = entityRefs || [];

  // Check explicit entity refs
  for (const ref of refs) {
    const char = entities.characters.find((c) => c.id === ref);
    if (char?.imageUrl) { images.push({ image: char.imageUrl }); continue; }
    const scene = entities.scenes.find((s) => s.id === ref);
    if (scene?.imageUrl) { images.push({ image: scene.imageUrl }); continue; }
    const prop = entities.props.find((p) => p.id === ref);
    if (prop?.imageUrl) { images.push({ image: prop.imageUrl }); continue; }
  }

  // Always include the protagonist's reference. In 2nd-person narration the player is rarely
  // named, so it won't be in entityRefs — but its avatar should stay visually consistent across
  // frames. (Characters have no `role` field; the player is named with a "你"/"（你）" marker.)
  const charByName = characterName ? entities.characters.find((c) => c.name === characterName) : null;
  const protagonist = entities.characters.find((c) => /你/.test(c.name || '')) || entities.characters[0];
  const subject = charByName || protagonist;
  if (subject?.imageUrl && !images.some((im) => im.image === subject.imageUrl)) {
    images.push({ image: subject.imageUrl });
  }

  // Add first scene if no scene ref found
  if (!refs.some((r) => entities.scenes.some((s) => s.id === r))) {
    const scene = entities.scenes[0];
    if (scene?.imageUrl) images.push({ image: scene.imageUrl });
  }

  return images.slice(0, 3);
}

/**
 * Infer which entities appear in a chunk of narration by name match. Used to attach reference
 * images (and visual descriptions) to prefetch-generated frames, which skip the storyboard LLM
 * and therefore have no entityRefs of their own.
 */
export function inferEntityRefs(
  entities: { characters?: any[]; scenes?: any[]; props?: any[] } | null | undefined,
  text: string | null | undefined,
): string[] {
  if (!entities || !text) return [];
  const refs: string[] = [];
  const all = [...(entities.characters || []), ...(entities.scenes || []), ...(entities.props || [])];
  for (const e of all) {
    const name = String(e?.name || '').trim();
    if (name && text.includes(name) && e.id) refs.push(e.id);
  }
  return refs;
}

/**
 * Reconcile each voice segment's voiceType against its speaker character's
 * defined voiceType. The entity is the source of truth for a character's voice.
 *
 * The voice LLM sometimes mislabels a character segment's voiceType (e.g. tags
 * the speaker correctly as "维拉教授" but sets voiceType to "narrator"), which
 * then reads with the wrong/fixed narrator voice. This forces any non-narrator
 * segment whose speaker matches a character entity to use that character's
 * voiceType, so a single bad label can't override the creator's intent.
 */
export function reconcileVoiceTypes<
  T extends { speaker?: string; voiceType?: string },
>(
  segments: T[],
  entities: { characters?: { name?: string; voiceType?: string }[] } | null | undefined,
): T[] {
  const chars = entities?.characters || [];
  if (chars.length === 0 || segments.length === 0) return segments;

  const norm = (s: string | undefined) => (s || '').trim().toLowerCase();

  return segments.map((seg) => {
    // Leave narrator / empty-speaker segments untouched.
    if (!seg.speaker || norm(seg.speaker) === 'narrator') return seg;

    const speaker = norm(seg.speaker);
    // Exact match first, then fuzzy (one name contained in the other).
    let match = chars.find((c) => norm(c.name) === speaker);
    if (!match) {
      match = chars.find((c) => {
        const n = norm(c.name);
        return n.length > 0 && (speaker.includes(n) || n.includes(speaker));
      });
    }

    if (match?.voiceType && match.voiceType !== seg.voiceType) {
      return { ...seg, voiceType: match.voiceType };
    }
    return seg;
  });
}

