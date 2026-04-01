/**
 * Client-side command dispatcher.
 * Maps each StoryCommand to the corresponding Zustand store method.
 * Called by useAgentGraph when it receives 'command' events via SSE.
 */
'use client';

import { useStoryStore } from '@/stores/storyStore';
import { useChatStore } from '@/stores/chatStore';
import type { StoryCommand } from './commands';

export function applyCommand(cmd: StoryCommand): void {
  const story = useStoryStore.getState();
  const chat = useChatStore.getState();

  switch (cmd.type) {
    // ── Style ──
    case 'SET_STYLE':
      chat.setSelectedStyle(cmd.payload);
      story.setStyle(cmd.payload);
      break;

    // ── Outline ──
    case 'SET_OUTLINE':
      chat.setOutline(cmd.payload);
      break;
    case 'SET_WORLD_VIEW':
      story.setWorldView(cmd.payload);
      break;
    case 'SET_STORY_DESCRIPTION':
      chat.setStoryDescription(cmd.payload);
      break;

    // ── Entities ──
    case 'SET_ENTITIES':
      chat.setEntities(cmd.payload);
      break;
    case 'UPDATE_ENTITY_IMAGE':
      chat.updateEntityImage(cmd.payload.entityType, cmd.payload.id, cmd.payload.imageUrl);
      break;
    case 'UPDATE_ENTITY_FIELD':
      chat.updateEntityField(cmd.payload.entityType, cmd.payload.id, cmd.payload.field, cmd.payload.value);
      break;

    // ── Nodes — batch ──
    case 'SET_NODES_AND_EDGES':
      story.setNodesAndEdges(cmd.payload.nodes, cmd.payload.edges);
      break;
    case 'ADD_NODES_AND_EDGES':
      story.addNodesAndEdges(cmd.payload.nodes, cmd.payload.edges);
      break;

    // ── Nodes — single ──
    case 'ADD_NODE':
      story.addNode(cmd.payload);
      break;
    case 'UPDATE_NODE':
      story.updateNode(cmd.payload.nodeId, cmd.payload.data);
      break;
    case 'REMOVE_NODE':
      story.removeNode(cmd.payload.nodeId);
      break;
    case 'UPDATE_NODE_POSITION':
      story.updateNodePosition(cmd.payload.nodeId, cmd.payload.position);
      break;

    // ── Edges ──
    case 'ADD_EDGE':
      story.addEdge(cmd.payload);
      break;
    case 'REMOVE_EDGE':
      story.removeEdge(cmd.payload.edgeId);
      break;

    // ── Choices ──
    case 'ADD_CHOICE':
      story.addChoice(cmd.payload.nodeId, cmd.payload.choice);
      break;
    case 'UPDATE_CHOICE':
      story.updateChoice(cmd.payload.nodeId, cmd.payload.choiceId, cmd.payload.updates);
      break;
    case 'REMOVE_CHOICE':
      story.removeChoice(cmd.payload.nodeId, cmd.payload.choiceId);
      break;

    // ── Frames ──
    case 'ADD_FRAME':
      story.addFrame(cmd.payload.nodeId, cmd.payload.frame);
      break;
    case 'UPDATE_FRAME':
      story.updateFrame(cmd.payload.nodeId, cmd.payload.frameId, cmd.payload.updates);
      break;
    case 'REMOVE_FRAME':
      story.removeFrame(cmd.payload.nodeId, cmd.payload.frameId);
      break;

    // ── Orchestrator ──
    case 'SET_SKILL_STATUS':
      chat.updateSkillStatus(cmd.payload.skill, cmd.payload.status as any);
      break;
    case 'SET_CURRENT_SKILL':
      chat.setCurrentSkill(cmd.payload);
      break;

    // ── Interactive Branch ──
    case 'SET_INTERACTIVE_BRANCH':
      chat.setInteractiveBranch(cmd.payload);
      break;
    case 'ADD_PENDING_EXPANSION':
      chat.addPendingExpansion(cmd.payload);
      break;
    case 'REMOVE_PENDING_EXPANSION':
      chat.removePendingExpansion(cmd.payload.parentNodeId, cmd.payload.choiceId);
      break;
    case 'CLEAR_INTERACTIVE_BRANCH':
      chat.clearInteractiveBranch();
      break;

    // ── Story-level ──
    case 'INIT_STORY':
      story.initStory(cmd.payload.title, cmd.payload.description);
      break;
    case 'SET_STORY':
      story.setStory(cmd.payload);
      break;
    case 'UPDATE_SETTINGS':
      story.updateSettings(cmd.payload);
      break;

    // ── Reset ──
    case 'RESET_STORY':
      story.setStory(null as any);
      chat.clearMessages();
      break;

    default: {
      const _exhaustive: never = cmd;
      console.warn('[applyCommand] unknown command type:', (cmd as any).type);
    }
  }
}
