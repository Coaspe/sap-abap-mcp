import type { AbapToolService } from "../../tool-service.js"

export type V1ReadService = Pick<AbapToolService,
  | "getConnectedSystems"
  | "getSapSystemInfo"
  | "getSapCapabilities"
  | "searchObjects"
  | "getObjectLines"
  | "getObjectByUri"
>
