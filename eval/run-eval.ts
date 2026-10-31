import { evaluateFixtures, formatReport } from "./evaluate";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const mock = process.argv.includes("--mock");
  if (mock) {
    const report = await evaluateFixtures({ mode: "mock" });
    console.log(formatReport(report));
    if (report.contractMismatch) process.exitCode = 1;
    return;
  }

  const provider = flag("--provider");
  const model = flag("--model");
  if (provider !== "openai" && provider !== "anthropic") {
    console.error("Pass --provider openai|anthropic and --model <name>, or pass --mock.");
    process.exitCode = 1;
    return;
  }
  if (!model) {
    console.error("Pass --model <name>. The key is read from the environment, not from argv.");
    process.exitCode = 1;
    return;
  }
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(provider === "openai" ? "Set OPENAI_API_KEY." : "Set ANTHROPIC_API_KEY.");
    process.exitCode = 1;
    return;
  }

  const report = await evaluateFixtures({ mode: "live", provider, model, apiKey });
  console.log(formatReport(report));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
