// src/core/types/vendor.d.ts
declare module "../../vendor/basis_transcoder.js" {
  // This file doesn’t actually export anything meaningful for TS,
  // but this silences the “could not find a declaration” error.
  import type { BasisModule } from "basis-universal";
  const BASIS: (config: Partial<BasisModule>) => Promise<BasisModule>;
  export default BASIS;
}
