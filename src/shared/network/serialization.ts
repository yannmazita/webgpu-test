// src/shared/network/serialization.ts

/**
 * Placeholder for the network serialization logic.
 * Implementation will use MessagePack to encode/decode NetworkMessage 
 * objects to/from Uint8Arrays.
 */
export class NetworkSerializer {
  public serialize(message: unknown): Uint8Array {
    // Placeholder for testing, this will be replaced by MessagePack.
    const jsonString = JSON.stringify(message);
    return new TextEncoder().encode(jsonString);
  }

  public deserialize<T>(data: Uint8Array): T {
    // Placeholder for testing, this will be replaced by MessagePack.
    const jsonString = new TextDecoder().decode(data);
    return JSON.parse(jsonString) as T;
  }
}
