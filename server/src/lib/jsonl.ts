import fs from 'node:fs';
import readline from 'node:readline';

export interface JsonlRecord {
  line: number;
  value: unknown;
}

export interface JsonlOptions {
  /** 파싱 직후 객체를 다듬어 메모리를 줄이는 훅 (예: thinking.signature 삭제) */
  strip?: (value: unknown) => unknown;
  /** 경고 수집기 (throw 하지 않음) */
  warnings?: string[];
}

/**
 * 관대한 JSONL 스트림 리더.
 * - 줄 단위로 JSON.parse, 실패해도 throw 하지 않음
 * - 마지막 줄 실패는 실시간 append 중인 파일로 보고 "partial trailing line" 경고만 남김
 */
export async function* readJsonl(filePath: string, opts: JsonlOptions = {}): AsyncGenerator<JsonlRecord> {
  const warnings = opts.warnings ?? [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let pending: { line: number; text: string } | null = null;
  let lineNo = 0;

  const parse = (item: { line: number; text: string }, isLast: boolean): JsonlRecord | null => {
    const text = item.text.trim();
    if (!text) return null;
    try {
      let value: unknown = JSON.parse(text);
      if (opts.strip) value = opts.strip(value);
      return { line: item.line, value };
    } catch {
      warnings.push(isLast ? `partial trailing line ${item.line} skipped (file may be live)` : `line ${item.line} is not valid JSON`);
      return null;
    }
  };

  try {
    for await (const text of rl) {
      lineNo += 1;
      if (pending) {
        const rec = parse(pending, false);
        if (rec) yield rec;
      }
      pending = { line: lineNo, text };
    }
    if (pending) {
      const rec = parse(pending, true);
      if (rec) yield rec;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}
