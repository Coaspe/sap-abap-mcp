import { stdin, stderr } from "node:process"
import { emitKeypressEvents, type Key } from "node:readline"
import type { ReadStream } from "node:tty"
import type { Writable } from "node:stream"
import { AppError } from "./errors.js"

export async function promptSecret(
  prompt: string,
  input: ReadStream = stdin,
  output: Writable = stderr
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new AppError(
      "PASSWORD_INPUT_REQUIRED",
      "Interactive password input needs a TTY. Pipe the password and add --password-stdin."
    )
  }

  return new Promise((resolve, reject) => {
    const characters: string[] = []
    const previousRawMode = input.isRaw
    const cleanup = () => {
      input.off("keypress", onKeypress)
      input.off("end", onEnd)
      input.setRawMode(previousRawMode)
      input.pause()
      output.write("\n")
    }
    const onEnd = () => {
      cleanup()
      reject(new AppError("CANCELLED", "Secret input ended before Enter was pressed"))
    }
    const onKeypress = (character: string | undefined, key: Key) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) {
        cleanup()
        reject(new AppError("CANCELLED", "Secret input was cancelled"))
      } else if (key.name === "return" || key.name === "enter") {
        cleanup()
        resolve(characters.join(""))
      } else if (key.name === "backspace") {
        if (characters.length) {
          characters.pop()
          output.write("\b \b")
        }
      } else if (character && !key.ctrl && !key.meta && !character.includes("\u001b")) {
        for (const value of character) {
          if (value >= " " && value !== "\u007f") {
            characters.push(value)
            output.write("*")
          }
        }
      }
    }

    output.write("Input is masked with *. Press Enter to submit; Ctrl+C to cancel.\n")
    output.write(prompt)
    emitKeypressEvents(input)
    input.on("keypress", onKeypress)
    input.on("end", onEnd)
    input.setRawMode(true)
    input.resume()
  })
}
