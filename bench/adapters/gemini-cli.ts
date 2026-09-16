import type { Adapter } from "./types";

const REASON =
  "gemini-cli adapter not implemented: install Gemini CLI (https://geminicli.com), then write the stream-json parser in bench/adapters/gemini-cli.ts";

export const geminiCli: Adapter = {
  name: "gemini-cli",
  defaultModel: undefined,
  envPassthrough: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  async isolate() {
    return null;
  },
  async detect() {
    return { available: false, reason: REASON };
  },
  async run() {
    throw new Error(REASON);
  },
};
