export interface CliIo {
  readStdin: () => Promise<string>;
  writeStdout: (value: string) => void;
  writeStderr: (value: string) => void;
}

export const defaultIo: CliIo = {
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  writeStdout: (value) => {
    process.stdout.write(value);
  },
  writeStderr: (value) => {
    process.stderr.write(value);
  },
};
