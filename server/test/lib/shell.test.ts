import { describe, expect, it } from 'vitest';
import { effectiveArgv, splitCommands, stripHeredocs, tokenize } from '../../src/lib/shell';

describe('shell parser', () => {
  it('strips heredoc bodies and records the redirect target', () => {
    const cmd = "cat > /tmp/a.txt <<'EOF'\nline1\nline2\nEOF\necho done";
    const cmds = splitCommands(cmd);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]?.argv).toEqual(['cat']);
    expect(cmds[0]?.redirects).toEqual([{ op: '>', target: '/tmp/a.txt' }]);
    expect(cmds[0]?.heredocs[0]?.body).toBe('line1\nline2');
    expect(cmds[1]?.argv).toEqual(['echo', 'done']);
  });

  it('splits on && ; | and tracks cd', () => {
    const cmds = splitCommands('cd /proj && npm install react; ls -la | head -n 3', '/home/x');
    expect(cmds.map((c) => c.argv[0])).toEqual(['cd', 'npm', 'ls', 'head']);
    expect(cmds[1]?.cwd).toBe('/proj');
    expect(cmds[3]?.argv).toEqual(['head', '-n', '3']);
  });

  it('handles quotes, escapes, $() and leading assignments', () => {
    const cmds = splitCommands('FOO=1 git commit -m "hello \\"world\\"" && echo \'it\'"s" $(date)');
    expect(cmds[0]?.assignments).toEqual(['FOO=1']);
    expect(cmds[0]?.argv).toEqual(['git', 'commit', '-m', 'hello "world"']);
    expect(cmds[1]?.argv).toEqual(['echo', 'its', '$(date)']);
  });

  it('keeps a git commit heredoc inside $( ) as the heredoc body', () => {
    const cmd = 'git commit -m "$(cat <<\'EOF\'\nfeat: 첫 커밋\n\n본문\nEOF\n)" && git push';
    const cmds = splitCommands(cmd);
    expect(cmds[0]?.argv.slice(0, 2)).toEqual(['git', 'commit']);
    expect(cmds[0]?.heredocs[0]?.body).toBe('feat: 첫 커밋\n\n본문');
    expect(cmds[1]?.argv).toEqual(['git', 'push']);
  });

  it('parses 2>&1 and >> without breaking words', () => {
    const cmds = splitCommands('npm test 2>&1 | tail -5; echo x >> log.txt');
    expect(cmds[0]?.argv).toEqual(['npm', 'test']);
    expect(cmds[0]?.redirects).toEqual([{ op: '2>&1' }]);
    expect(cmds[2]?.redirects).toEqual([{ op: '>>', target: 'log.txt' }]);
  });

  it('strips wrappers like timeout/sudo/env', () => {
    expect(effectiveArgv(['timeout', '30', 'npm', 'run', 'build'])).toEqual(['npm', 'run', 'build']);
    expect(effectiveArgv(['sudo', '-E', 'apt', 'install', 'jq'])).toEqual(['apt', 'install', 'jq']);
    expect(effectiveArgv(['env', 'A=1', 'node', 'x.js'])).toEqual(['node', 'x.js']);
  });

  it('tokenize ignores comments', () => {
    expect(tokenize('ls # comment').map((t) => t.value)).toEqual(['ls']);
    expect(stripHeredocs('a\n').heredocs).toEqual([]);
  });
});
