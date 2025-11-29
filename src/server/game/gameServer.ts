// src/server/game/gameServer.ts
import { GameInstance } from "@/server/game/gameInstance";
import { performance } from "perf_hooks";

/**
 * Manages the lifecycle of instances and the main loop.
 */
export class GameServer {
  private instances = new Map<string, GameInstance>();
  private isRunning = false;
  
  private readonly TICK_RATE = 60;
  private readonly MS_PER_TICK = 1000 / 60;

  constructor() {
    this.createInstance("lobby_default");
  }

  public createInstance(id: string): GameInstance {
    if (this.instances.has(id)) {
      console.warn(`[GameServer] Instance ${id} already exists.`);
      return this.instances.get(id)!;
    }
    const instance = new GameInstance(id);
    this.instances.set(id, instance);
    console.log(`[GameServer] Instance ${id} created.`);
    return instance;
  }

  public async removeInstance(id: string) {
    const instance = this.instances.get(id);
    if (instance) {
      await instance.shutdown();
      this.instances.delete(id);
      console.log(`[GameServer] Instance ${id} removed.`);
    }
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[GameServer] Starting loop at ${this.TICK_RATE}Hz...`);
    
    await this.runLoop();
  }

  public async stop() {
    this.isRunning = false;
    for (const instance of this.instances.values()) {
        await instance.shutdown();
    }
    this.instances.clear();
  }

  private async runLoop() {
    let previous = performance.now();
    let lag = 0.0;

    while (this.isRunning) {
      const current = performance.now();
      const elapsed = current - previous;
      previous = current;
      lag += elapsed;

      // "Spiral of death" protection: clamp max catch-up ticks
      let updates = 0;
      while (lag >= this.MS_PER_TICK && updates < 5) {
        // Fixed Tick Update
        for (const instance of this.instances.values()) {
          instance.tick(this.MS_PER_TICK / 1000);
        }
        
        lag -= this.MS_PER_TICK;
        updates++;
      }

      // If we are still behind after max updates, discard accumulated time
      if (lag >= this.MS_PER_TICK) {
         lag = 0; 
      }

      // Sleep until next tick
      // Calculate time remaining until the next expected tick
      const timeToNextTick = this.MS_PER_TICK - lag;
      
      if (timeToNextTick > 1) {
        // Use setImmediate to yield to I/O loop, allowing network packets to process
        await new Promise(resolve => setTimeout(resolve, timeToNextTick));
      } else {
        // If less than 1ms, spin-wait or yield immediately to keep precision
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }
}