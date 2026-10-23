import { describe, expect, it } from 'vitest';
import { AnalysisService } from '../../src/analyzers/index';
import { caseA } from '../wiki/helpers';

describe('raw session analysis', () => {
  it('collects observed files without selecting concepts by keywords', async () => {
    const analysis = await new AnalysisService().analyze(caseA());
    expect(analysis.built.filesCreated).not.toHaveLength(0);
    expect(analysis.concepts).toEqual([]);
  });
});
