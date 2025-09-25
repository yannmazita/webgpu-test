// src/core/ecs/component.ts

/**
 * A marker interface for components. All components must implement this.
 * Components should be treated as plain data objects.
 * @see https://www.typescriptlang.org/docs/handbook/2/objects.html#interfaces-vs-intersections
 */
export interface IComponent {}

/**
 * A type representing the constructor of a component class.
 * This is used as a key to identify and look up component types in the World.
 *
 * @template T - The type of the component, which must extend IComponent.
 */
export type ComponentConstructor<T extends IComponent = IComponent> = new (
  ...args: unknown[]
) => T;
