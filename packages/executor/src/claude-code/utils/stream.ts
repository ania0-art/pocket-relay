import type { Readable, Writable } from 'node:stream'

/**
 * Node.js Readable → Web ReadableStream<Uint8Array>
 */
export function nodeToWebReadable(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer | string) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        controller.enqueue(new Uint8Array(bytes))
      })
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', err => controller.error(err))
    },
    cancel() {
      nodeStream.destroy()
    }
  })
}

/**
 * Node.js Writable → Web WritableStream<Uint8Array>
 */
export function nodeToWebWritable(nodeStream: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        nodeStream.write(chunk, err => (err ? reject(err) : resolve()))
      })
    },
    close() {
      return new Promise<void>(resolve => nodeStream.end(resolve))
    },
    abort(reason) {
      nodeStream.destroy(reason instanceof Error ? reason : new Error(String(reason)))
    }
  })
}
