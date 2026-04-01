import type { StoryNode, StoryEdge } from '@/types/story';

/**
 * BFS tree layout for story nodes.
 * Assigns positions in a left-to-right hierarchy.
 */
export function layoutNodes(nodes: StoryNode[], edges: StoryEdge[]): StoryNode[] {
  if (nodes.length === 0) return nodes;

  // Build adjacency: source -> targets
  const childrenMap = new Map<string, string[]>();
  for (const e of edges) {
    const list = childrenMap.get(e.source) || [];
    if (!list.includes(e.target)) list.push(e.target);
    childrenMap.set(e.source, list);
  }

  // Find root (start node or node with no incoming edge)
  const targetSet = new Set(edges.map((e) => e.target));
  const rootId = nodes.find((n) => n.type === 'start')?.id || nodes.find((n) => !targetSet.has(n.id))?.id || nodes[0].id;

  // BFS to assign depth (column) and index within column (row)
  const posMap = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
  visited.add(rootId);

  // Collect nodes per depth level
  const depthNodes = new Map<number, string[]>();

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const list = depthNodes.get(depth) || [];
    list.push(id);
    depthNodes.set(depth, list);

    const children = childrenMap.get(id) || [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push({ id: childId, depth: depth + 1 });
      }
    }
  }

  // Left-to-right layout: x = depth * horizontalSpacing, y = index * verticalSpacing
  const HORIZONTAL_SPACING = 320;
  const VERTICAL_SPACING = 220;

  // Find max nodes in any column for centering
  let maxNodesInColumn = 0;
  for (const [, nodeList] of depthNodes) {
    maxNodesInColumn = Math.max(maxNodesInColumn, nodeList.length);
  }

  for (const [depth, nodeList] of depthNodes) {
    // Center nodes vertically within column
    const totalHeight = (nodeList.length - 1) * VERTICAL_SPACING;
    const startY = -totalHeight / 2;

    for (let i = 0; i < nodeList.length; i++) {
      posMap.set(nodeList[i], {
        x: depth * HORIZONTAL_SPACING,
        y: startY + i * VERTICAL_SPACING,
      });
    }
  }

  // Also handle unvisited nodes (disconnected)
  let orphanY = (maxNodesInColumn + 1) * VERTICAL_SPACING;
  for (const n of nodes) {
    if (!posMap.has(n.id)) {
      posMap.set(n.id, { x: 0, y: orphanY });
      orphanY += VERTICAL_SPACING;
    }
  }

  return nodes.map((n) => ({
    ...n,
    position: posMap.get(n.id) || n.position || { x: 0, y: 0 },
  }));
}
