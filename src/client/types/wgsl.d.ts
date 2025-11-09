// src/client/types/wgsl.d.ts
declare module "*.wgsl?raw" {
  const value: string;
  export default value;
}

declare module "*.wgsl?url" {
  const value: string;
  export default value;
}

declare module "*.wgsl" {
  const value: string;
  export default value;
}
