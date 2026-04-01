import { NextRequest } from 'next/server';
import { HumanMessage } from '@langchain/core/messages';
import { getGraph } from '@/lib/agent/graph/graph';

// SSE event types sent to client
interface SSEEvent {
  type: 'token' | 'tool_start' | 'tool_end'
    | 'command' | 'done' | 'error';
  [key: string]: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      threadId,
      message,
      storyContext,
      interactiveBranch,
      mode = 'create',
    } = body;

    if (!threadId) {
      return new Response(JSON.stringify({ error: 'threadId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const graph = getGraph();

    // Derive the actual server origin from the incoming request
    // so internal skill API calls use the correct port.
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const serverOrigin = `${protocol}://${host}`;

    const config = {
      recursionLimit: 150,
      configurable: {
        thread_id: threadId,
        storyContext,
        interactiveBranch,
        serverOrigin,
      },
    };

    // Always build fresh input — stateless per-request
    const input = {
      messages: [new HumanMessage(message || '')],
      storyContext: storyContext || undefined,
      interactiveBranch: interactiveBranch || null,
      mode,
      turnCount: 0,
    };

    // SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: SSEEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Controller may be closed
          }
        };

        // Track sent commands to avoid duplicates
        const sentCommandIds = new Set<string>();

        try {
          const eventStream = graph.streamEvents(input, { ...config, version: 'v2' as const });

          for await (const event of eventStream) {
            const { event: eventType, name, data } = event;

            // LLM token streaming
            if (eventType === 'on_chat_model_stream') {
              const chunk = data?.chunk;
              if (chunk?.content) {
                send({ type: 'token', text: chunk.content });
              }
            }

            // Tool execution events
            if (eventType === 'on_tool_start') {
              send({ type: 'tool_start', tool: name, input: data?.input });
            }
            if (eventType === 'on_tool_end') {
              send({ type: 'tool_end', tool: name, result: data?.output?.content || data?.output });
            }

            // Node completion — look for commands in output
            if (eventType === 'on_chain_end' && data?.output) {
              const output = data.output;
              const cmds = output.commands;
              if (cmds && Array.isArray(cmds) && cmds.length > 0) {
                for (const cmd of cmds) {
                  const cmdKey = JSON.stringify(cmd);
                  if (!sentCommandIds.has(cmdKey)) {
                    sentCommandIds.add(cmdKey);
                    send({ type: 'command', command: cmd });
                  }
                }
              }
            }
          }

          send({ type: 'done' });
        } catch (err: any) {
          console.error('[agent] stream error:', err);
          send({ type: 'error', message: err.message || 'Agent execution failed' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('[agent] route error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
