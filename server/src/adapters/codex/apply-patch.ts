export interface PatchFileOp {
  kind: 'create' | 'update' | 'delete';
  path: string;
  moveTo?: string;
}

/** Codex `apply_patch` 입력(`*** Begin Patch` … `*** End Patch`)에서 파일 작업을 뽑는다 */
export function parseApplyPatch(input: string): PatchFileOp[] {
  const ops: PatchFileOp[] = [];
  const lines = input.split('\n');
  let current: PatchFileOp | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    let m: RegExpExecArray | null;
    if ((m = /^\*\*\* Add File: (.+)$/.exec(line))) {
      current = { kind: 'create', path: (m[1] ?? '').trim() };
      ops.push(current);
    } else if ((m = /^\*\*\* Update File: (.+)$/.exec(line))) {
      current = { kind: 'update', path: (m[1] ?? '').trim() };
      ops.push(current);
    } else if ((m = /^\*\*\* Delete File: (.+)$/.exec(line))) {
      current = { kind: 'delete', path: (m[1] ?? '').trim() };
      ops.push(current);
    } else if ((m = /^\*\*\* Move to: (.+)$/.exec(line))) {
      if (current) current.moveTo = (m[1] ?? '').trim();
    }
  }
  return ops;
}
