#!/usr/bin/env bun
// wake-listen.ts — Supabase Realtime subscriber for agent wake signals
// Connects to the "agent-wakes" broadcast channel and writes a local wake
// signal file whenever this agent's name appears in a wake event. The
// supervisor's idle_wait() polls that file every 1s and wakes immediately.
//
// Usage (launched automatically by run-agent.sh if SUPABASE_URL + SUPABASE_KEY are set):
//   bun wake-listen.ts <agent-name> <control-dir> <supabase-url> <supabase-key>
//
// Reconnects automatically on any WebSocket error or close.
// Sends Phoenix protocol heartbeats every 30s to keep the connection alive.
// No npm dependencies — uses Bun's native WebSocket and file APIs.

const [agentName, controlDir, supabaseUrl, supabaseKey] = process.argv.slice(2);

if (!agentName || !controlDir || !supabaseUrl || !supabaseKey) {
  console.error("Usage: bun wake-listen.ts <agent-name> <control-dir> <supabase-url> <supabase-key>");
  process.exit(1);
}

const wakeFile = `${controlDir}/mailboxes/wake/${agentName}`;
const wsUrl = `${supabaseUrl.replace("https://", "wss://")}/realtime/v1/websocket?apikey=${supabaseKey}&vsn=1.0.0`;

let ref = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;

function nextRef(): string {
  return String(++ref);
}

function connect() {
  console.log(`[wake-listen:${agentName}] connecting to ${supabaseUrl}/realtime`);
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    console.log(`[wake-listen:${agentName}] connected`);

    // Join the shared agent-wakes broadcast channel
    ws.send(JSON.stringify({
      topic: "realtime:agent-wakes",
      event: "phx_join",
      payload: { config: { broadcast: { self: false } } },
      ref: nextRef(),
    }));

    // Phoenix heartbeat to prevent server-side timeout (every 30s)
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: nextRef() }));
      }
    }, 30_000);
  });

  ws.addEventListener("message", (event) => {
    let msg: { topic?: string; event?: string; payload?: { event?: string; payload?: { agent?: string } } };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    // Supabase Realtime broadcast arrives as:
    // { topic: "realtime:agent-wakes", event: "broadcast",
    //   payload: { type: "broadcast", event: "wake", payload: { agent: "<name>" } } }
    if (
      msg.topic === "realtime:agent-wakes" &&
      msg.event === "broadcast" &&
      msg.payload?.event === "wake" &&
      msg.payload?.payload?.agent === agentName
    ) {
      Bun.write(wakeFile, "").then(() => {
        console.log(`[wake-listen:${agentName}] wake signal received → wrote ${wakeFile}`);
      }).catch(() => {});
    }
  });

  ws.addEventListener("close", (event) => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    console.log(`[wake-listen:${agentName}] disconnected (code ${event.code}), reconnecting in 5s...`);
    setTimeout(connect, 5_000);
  });

  ws.addEventListener("error", () => {
    // close event fires after error — reconnect is handled there
    console.error(`[wake-listen:${agentName}] WebSocket error`);
  });
}

connect();
