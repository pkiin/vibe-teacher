import { describe, expect, it } from 'vitest';
import { parseEnvText, releaseEnvText, windowsLauncher, windowsReadme } from '../../../scripts/release-lib';
import { createZip, readZip } from '../../../scripts/zip';

const jwt = (payload: object) => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'synthetic-signature'].join('.');
const values = (extra: Record<string, string> = {}) => new Map(Object.entries({ SUPABASE_URL: 'https://synthetic.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic123', ...extra }));

describe('배포 묶음 공개 설정', () => {
  it('Supabase 주소와 publishable·anon 키만 받아 노트북 설치 설정을 만든다', () => {
    expect(parseEnvText('# 주석\nSUPABASE_URL="https://a.supabase.co"\r\n\nexport SUPABASE_PUBLISHABLE_KEY=k\n')).toEqual(new Map([['SUPABASE_URL', 'https://a.supabase.co'], ['SUPABASE_PUBLISHABLE_KEY', 'k']]));
    const text = releaseEnvText(values());
    expect(text).toContain('VIBE_TEACHER_DEPLOYMENT=local\n');
    expect(text).toContain('VIBE_TEACHER_HOST=127.0.0.1\n');
    expect(text).toContain('SUPABASE_URL=https://synthetic.supabase.co\n');
    expect(releaseEnvText(values({ SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon' }) }))).toContain('SUPABASE_PUBLISHABLE_KEY=');
  });
  it('비밀값이나 다른 이름이 섞이면 묶음을 만들지 않고, 오류에 값을 넣지 않는다', () => {
    const fail = (input: Map<string, string>) => { try { releaseEnvText(input); return ''; } catch (err) { return (err as Error).message; } };
    expect(fail(values({ OPENROUTER_API_KEY: 'sk-or-v1-synthetic-secret' }))).toMatch(/OPENROUTER_API_KEY/);
    expect(fail(values({ OPENROUTER_API_KEY: 'sk-or-v1-synthetic-secret' }))).not.toContain('sk-or-v1-synthetic-secret');
    expect(fail(values({ VIBE_TEACHER_SUPABASE_DATABASE_URL: 'postgresql://u:p@h/db' }))).toMatch(/VIBE_TEACHER_SUPABASE_DATABASE_URL/);
    expect(fail(values({ SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic123456' }))).toMatch(/secret/);
    expect(fail(values({ SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) }))).toMatch(/service_role/);
    expect(fail(values({ SUPABASE_URL: 'http://synthetic.supabase.co' }))).toMatch(/HTTPS/);
    expect(fail(values({ SUPABASE_URL: 'https://user:pw@synthetic.supabase.co' }))).toMatch(/HTTPS/);
    expect(fail(new Map([['SUPABASE_URL', 'https://synthetic.supabase.co']]))).toMatch(/모두/);
    expect(() => parseEnvText('SUPABASE_URL\n')).toThrow('KEY=VALUE');
  });
  it('Windows 실행 파일은 CRLF 이고 묶음 폴더 기준 경로로 Node 를 실행한다', () => {
    const bat = windowsLauncher();
    expect(bat.split('\r\n')[0]).toBe('@echo off');
    expect(bat.replace(/\r\n/g, '')).not.toContain('\n');
    expect(bat).toContain('"%~dp0runtime\\node.exe" "%~dp0app\\server.mjs"');
    // 한글 안내는 코드 페이지를 UTF-8 로 바꾼 뒤에만 쓴다.
    const firstKorean = bat.search(/[가-힣]/);
    expect(bat.indexOf('chcp 65001')).toBeLessThan(firstKorean);
    const readme = windowsReadme('9.9.9');
    expect(readme.startsWith('﻿')).toBe(true);
    expect(readme).toContain('Vibe Teacher 9.9.9');
  });
});

describe('배포 묶음 zip', () => {
  it('만든 zip 을 다시 읽으면 내용이 같고, 손상은 CRC 로 알아낸다', () => {
    const big = Buffer.from('합성 내용 '.repeat(5000));
    const zip = createZip([{ name: 'vibe-teacher/README.txt', data: big }, { name: 'vibe-teacher/app/empty.txt', data: Buffer.alloc(0) }], new Date(2026, 10, 8, 12, 0, 0));
    const entries = readZip(zip);
    expect([...entries.keys()]).toEqual(['vibe-teacher/README.txt', 'vibe-teacher/app/empty.txt']);
    expect(entries.get('vibe-teacher/README.txt')!().equals(big)).toBe(true);
    expect(entries.get('vibe-teacher/app/empty.txt')!().length).toBe(0);
    expect(zip.length).toBeLessThan(big.length);
    const broken = Buffer.from(zip);
    broken[60] = broken[60]! ^ 0xff;
    expect(() => readZip(broken).get('vibe-teacher/README.txt')!()).toThrow();
  });
  it('묶음 밖을 가리키거나 겹치는 이름은 넣지 않는다', () => {
    for (const name of ['/abs.txt', '../up.txt', 'a/../b.txt', 'a\\b.txt', 'a//b.txt', '']) {
      expect(() => createZip([{ name, data: Buffer.from('x') }])).toThrow();
    }
    expect(() => createZip([{ name: 'a.txt', data: Buffer.from('x') }, { name: 'a.txt', data: Buffer.from('y') }])).toThrow('겹칩니다');
    expect(() => readZip(Buffer.from('not a zip file at all, synthetic'))).toThrow('zip 파일이 아닙니다');
  });
});
