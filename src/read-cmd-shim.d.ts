declare module "read-cmd-shim" {
  export default function readCmdShim(path: string): Promise<string>
}
