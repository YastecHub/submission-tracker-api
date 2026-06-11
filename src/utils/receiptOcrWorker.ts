interface WorkerResult {
  ok: boolean;
  text?: string;
  error?: string;
}

let finished = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finish(result: WorkerResult, exitCode: number): void {
  if (finished) return;
  finished = true;
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(exitCode));
}

function fail(error: unknown): void {
  finish({ ok: false, error: errorMessage(error) }, 1);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function downloadReceipt(receiptUrl: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(receiptUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Receipt download failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error('Receipt is not a supported image.');
    }

    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    const maxSize = 10 * 1024 * 1024;
    if (declaredSize > maxSize) {
      throw new Error('Receipt image exceeds the OCR size limit.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > maxSize) {
      throw new Error('Receipt image is empty or exceeds the OCR size limit.');
    }

    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const receiptUrl = process.argv[2];
  if (!receiptUrl) throw new Error('Receipt URL is required.');

  const image = await downloadReceipt(receiptUrl);
  const { createWorker } = (await import('tesseract.js')) as typeof import('tesseract.js');
  const worker = await createWorker('eng');
  let text = '';

  try {
    const result = await worker.recognize(image);
    text = result.data.text;
  } finally {
    await worker.terminate().catch(() => undefined);
  }

  finish({ ok: true, text }, 0);
}

void main().catch(fail);
