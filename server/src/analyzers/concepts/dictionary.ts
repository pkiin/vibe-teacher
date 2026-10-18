import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const RegexList = z.array(z.string()).default([]);

export const ConceptEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  category: z.string(),
  level: z.enum(['beginner', 'intermediate']).default('beginner'),
  /** 위키 규칙에서만 연결하는 개념. 자동 감지 트리거가 없어 개념 탭에는 나오지 않는다 */
  wikiOnly: z.boolean().default(false),
  triggers: z.object({
    files: RegexList,
    commands: RegexList,
    packages: RegexList,
    text: RegexList,
    stack: RegexList,
  }),
  /** 위키 설명 깊이 D0 (한 줄). 없으면 explanation 첫 문장 */
  summary: z.string().optional(),
  explanation: z.string(),
  /** D2: 적용 예시 */
  example: z.string().optional(),
  /** D2: 흔한 혼동 */
  confusions: z.array(z.string()).default([]),
  /** D3: 구현 원리 */
  deep: z.string().optional(),
  whyHereTemplate: z.string().optional(),
  links: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
});

export type ConceptEntry = z.infer<typeof ConceptEntrySchema>;

export interface CompiledConcept extends ConceptEntry {
  re: { files: RegExp[]; commands: RegExp[]; packages: RegExp[]; text: RegExp[]; stack: RegExp[] };
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DICTIONARY_PATH = path.resolve(here, '../../../data/concepts.ko.json');

let cached: CompiledConcept[] | null = null;

export function compileConcepts(entries: unknown): CompiledConcept[] {
  const list = z.array(ConceptEntrySchema).parse(entries);
  const ids = new Set<string>();
  return list.map((e) => {
    if (ids.has(e.id)) throw new Error(`중복된 개념 id: ${e.id}`);
    ids.add(e.id);
    const compile = (arr: string[]) => arr.map((s) => new RegExp(s, 'i'));
    return {
      ...e,
      re: {
        files: compile(e.triggers.files),
        commands: compile(e.triggers.commands),
        packages: compile(e.triggers.packages),
        text: compile(e.triggers.text),
        stack: compile(e.triggers.stack),
      },
    };
  });
}

export function loadConceptDictionary(filePath = DEFAULT_DICTIONARY_PATH): CompiledConcept[] {
  if (cached && filePath === DEFAULT_DICTIONARY_PATH) return cached;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const compiled = compileConcepts(raw);
  if (filePath === DEFAULT_DICTIONARY_PATH) cached = compiled;
  return compiled;
}
