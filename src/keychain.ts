import { spawn } from "node:child_process"
import { AppError } from "./errors.js"

// A fixed JXA program calls the native Security framework. Values travel as JSON
// on stdin, never as shell text or process arguments. CF constants need an ObjC cast.
const KEYCHAIN_PROGRAM = `ObjC.import('Foundation'); ObjC.import('Security');
function run() {
  const raw = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const p = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(raw, $.NSUTF8StringEncoding)));
  const k = name => ObjC.castRefToObject($[name]);
  const q = $.NSMutableDictionary.alloc.init;
  q.setObjectForKey(k('kSecClassGenericPassword'), k('kSecClass'));
  q.setObjectForKey($('sap-abap-mcp'), k('kSecAttrService'));
  q.setObjectForKey($(p.id), k('kSecAttrAccount'));
  let status = 0, value;
  if (p.operation === 'set') {
    const attrs = $.NSMutableDictionary.alloc.init;
    attrs.setObjectForKey($(p.value).dataUsingEncoding($.NSUTF8StringEncoding), k('kSecValueData'));
    status = $.SecItemUpdate(q, attrs);
    if (status === -25300) { q.addEntriesFromDictionary(attrs); status = $.SecItemAdd(q, null); }
  } else if (p.operation === 'delete') {
    status = $.SecItemDelete(q);
  } else {
    q.setObjectForKey($(true), k('kSecReturnData'));
    q.setObjectForKey(k('kSecMatchLimitOne'), k('kSecMatchLimit'));
    const output = Ref();
    status = $.SecItemCopyMatching(q, output);
    if (status === 0) value = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(ObjC.castRefToObject(output[0]), $.NSUTF8StringEncoding));
  }
  return JSON.stringify({status: status, value: value});
}`

export async function keychain(operation: "get" | "set" | "delete", profileId: string, value?: string): Promise<string | undefined> {
  const code = operation === "set" ? "KEYCHAIN_WRITE_FAILED" : operation === "get" ? "KEYCHAIN_READ_FAILED" : "KEYCHAIN_DELETE_FAILED"
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", KEYCHAIN_PROGRAM],
        { stdio: ["pipe", "pipe", "ignore"], timeout: 15_000 })
      let output = ""
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 1024 * 1024) child.kill() })
      child.once("error", reject)
      child.stdin.once("error", reject)
      child.once("close", status => status === 0 ? resolve(output) : reject(new Error("Native Keychain operation failed")))
      child.stdin.end(JSON.stringify({ operation, id: profileId.toUpperCase(), ...(value !== undefined ? { value } : {}) }))
    })
    const response = JSON.parse(result) as { status: number; value?: string }
    if (response.status === -25300 && operation !== "set") return undefined
    if (response.status !== 0) throw new AppError(code, "macOS Keychain refused the operation", { osStatus: response.status })
    return response.value
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(code, "Could not access macOS Keychain; check the login keychain and local permission prompt")
  }
}
