import net from "node:net";

const defaultTimeoutMs = 15_000;

function transact(writeRequest, { host, port, timeoutMs = defaultTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks = [];
    const fail = (code) => {
      socket.destroy();
      reject(new Error(code));
    };
    socket.setTimeout(timeoutMs, () => fail("scanner_timeout"));
    socket.once("error", () => fail("scanner_unavailable"));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("end", () =>
      resolve(
        Buffer.concat(chunks).toString("utf8").replace(/\0+$/u, "").trim(),
      ),
    );
    socket.once("connect", () => writeRequest(socket));
  });
}

export async function assertScannerHealthy(options) {
  const response = await transact((socket) => socket.end("zPING\0"), options);
  if (response !== "PONG") throw new Error("scanner_unhealthy");
}

export async function scanBuffer(buffer, options) {
  const response = await transact((socket) => {
    socket.write("zINSTREAM\0");
    for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
      const chunk = buffer.subarray(offset, offset + 64 * 1024);
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length);
      socket.write(length);
      socket.write(chunk);
    }
    socket.end(Buffer.alloc(4));
  }, options);
  if (response.endsWith(" OK")) return { clean: true };
  if (response.includes(" FOUND")) return { clean: false };
  throw new Error("scanner_invalid_response");
}
