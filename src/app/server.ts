// src/app/server.ts
import { GameServer } from "@/server/game/gameServer";

console.log("=================================");
console.log("   FPS Engine Server Starting    ");
console.log("=================================");

const server = new GameServer();

// Handle graceful shutdown
const shutdown = async () => {
  console.log("\n[Server] Shutting down...");
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start the game loop
await server.start();

console.log("[Server] Ready.");
