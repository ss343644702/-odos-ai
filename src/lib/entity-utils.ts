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

  // Fallback: match by character name
  if (images.length === 0 && characterName) {
    const char = entities.characters.find((c) => c.name === characterName);
    if (char?.imageUrl) images.push({ image: char.imageUrl });
  }

  // Add first scene if no scene ref found
  if (!refs.some((r) => entities.scenes.some((s) => s.id === r))) {
    const scene = entities.scenes[0];
    if (scene?.imageUrl) images.push({ image: scene.imageUrl });
  }

  return images.slice(0, 3);
}
