import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoDbTable } from '@vibe-teacher/shared';
import { applyRepoAi, buildRepoAiPrompt, incompleteRepoDbTables, mergeRepoDbRepair, type RepoAiOutput } from '../../src/repo/ai';
import { buildDatabase, extractDbDefs, extractDbRoutines, findDbUsages, isSchemaFile, mergeDbDefs, routinesByTable, type DbTableDef } from '../../src/repo/database';
import { scanRepo, type RepoScan } from '../../src/repo/scan';
import { buildRepoWiki } from '../../src/repo/wiki';

const SECRET = 'sk-live-THIS-MUST-NEVER-BE-READ-1234567890';
const cols = (defs: DbTableDef[], name: string) => defs.find((d) => d.name === name)?.columns ?? [];
const col = (defs: DbTableDef[], table: string, name: string) => cols(defs, table).find((c) => c.name === name);

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

describe('데이터베이스 표 정의 읽기', () => {
  it('SQL: 컬럼·타입·제약을 원문 그대로 읽고, 주석과 함수 본문($$) 안의 문장은 표로 보지 않는다', () => {
    const sql = [
      '-- 회원 목록',
      'create table if not exists public.members (',
      '  user_id uuid primary key references auth.users(id) on delete cascade,',
      "  email text not null default '', -- 로그인 이메일",
      "  status text not null check (status in ('ok', 'error')),",
      '  cost numeric(16, 8),',
      '  created_at timestamp with time zone not null default now()',
      ');',
      '/* create table ghost (id int); */',
      'create function f() returns void language plpgsql as $$ begin create table inner_ghost (id int); end; $$;',
      'CREATE TABLE "Orders" (',
      '  id bigint generated always as identity,',
      '  member_id uuid,',
      '  "key" text,',
      '  CONSTRAINT orders_pk PRIMARY KEY (id),',
      '  FOREIGN KEY (member_id) REFERENCES public.members (user_id)',
      ');',
      'alter table public.members add column if not exists nickname varchar(40), drop column cost;',
      'alter table public.members enable row level security;',
      "comment on column public.members.status is '처리 상태';",
    ].join('\n');
    const defs = mergeDbDefs(extractDbDefs('db/schema.sql', sql));
    expect(defs.map((d) => d.name)).toEqual(['members', 'Orders']);
    const members = defs[0]!;
    expect(members).toMatchObject({ schema: 'public', kind: 'table', via: 'SQL', line: 2, endLine: 8, note: '회원 목록' });
    expect(members.columns.map((c) => c.name)).toEqual(['user_id', 'email', 'status', 'created_at', 'nickname']);
    expect(col(defs, 'members', 'user_id')).toMatchObject({ type: 'uuid', primaryKey: true, references: 'auth.users(id)', line: 3 });
    expect(col(defs, 'members', 'email')).toMatchObject({ type: 'text', notNull: true, default: "''", note: '로그인 이메일', line: 4 });
    expect(col(defs, 'members', 'status')).toMatchObject({ check: "status in ('ok', 'error')", note: '처리 상태' });
    expect(col(defs, 'members', 'created_at')).toMatchObject({ type: 'timestamp with time zone', default: 'now()' });
    expect(col(defs, 'members', 'nickname')).toMatchObject({ type: 'varchar(40)', line: 18 });
    expect(col(defs, 'Orders', 'id')).toMatchObject({ primaryKey: true, default: 'generated always as identity' });
    expect(col(defs, 'Orders', 'member_id')).toMatchObject({ references: 'public.members(user_id)' });
    expect(col(defs, 'Orders', 'key')).toMatchObject({ type: 'text' });
  });

  it('SQL: pg_dump 처럼 ALTER TABLE 로 붙인 기본 키·외래 키와 다른 마이그레이션의 컬럼 추가를 합친다', () => {
    const defs = mergeDbDefs([
      ...extractDbDefs('migrations/001.sql', 'CREATE TABLE public.posts (id integer NOT NULL, author integer, title text);'),
      ...extractDbDefs('migrations/002.sql', 'ALTER TABLE ONLY public.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);\nALTER TABLE public.posts ADD CONSTRAINT fk FOREIGN KEY (author) REFERENCES public.users(id);\nALTER TABLE posts ADD COLUMN body text NOT NULL;\nALTER TABLE posts RENAME COLUMN title TO headline;\nALTER TABLE posts ALTER COLUMN headline SET NOT NULL;'),
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.columns.map((c) => [c.name, !!c.primaryKey, !!c.notNull, c.references ?? '', c.file ?? ''])).toEqual([
      ['id', true, true, '', ''], ['author', false, false, 'public.users(id)', ''], ['headline', false, true, '', ''], ['body', false, true, '', 'migrations/002.sql'],
    ]);
    expect(isSchemaFile('migrations/0001_init/down.sql')).toBe(false);
    expect(isSchemaFile('tests/fixture.sql')).toBe(false);
    expect(isSchemaFile('prisma/schema.prisma')).toBe(true);
  });

  it('Prisma: 모델·enum·관계 필드와 @@map·@map 을 읽는다', () => {
    const prisma = [
      'enum Role {', '  USER', '  ADMIN', '}',
      'model User {',
      '  id    Int     @id @default(autoincrement())',
      '  /// 로그인 이메일',
      '  email String  @unique @map("email_address") @db.VarChar(255)',
      '  role  Role    @default(USER)',
      '  posts Post[]',
      '  @@map("users")',
      '}',
      'model Post {',
      '  id       Int    @id',
      '  title    String?',
      '  author   User   @relation(fields: [authorId], references: [id])',
      '  authorId Int',
      '}',
    ].join('\n');
    const defs = extractDbDefs('prisma/schema.prisma', prisma);
    expect(defs.map((d) => [d.name, d.aliases, d.accessor])).toEqual([['users', ['User'], 'user'], ['Post', ['Post'], 'post']]);
    expect(col(defs, 'users', 'id')).toMatchObject({ type: 'Int', primaryKey: true, notNull: true, default: 'autoincrement()' });
    expect(col(defs, 'users', 'email_address')).toMatchObject({ type: 'String (VarChar(255))', unique: true, note: '로그인 이메일' });
    expect(col(defs, 'users', 'role')).toMatchObject({ check: 'USER | ADMIN', default: 'USER' });
    expect(col(defs, 'users', 'posts')).toMatchObject({ type: 'Post[]', relation: true });
    expect(col(defs, 'Post', 'title')?.notNull).toBeUndefined();
    expect(col(defs, 'Post', 'authorId')).toMatchObject({ references: 'User(id)', notNull: true });
  });

  it('Drizzle·TypeORM·Mongoose·Sequelize·Knex 정의를 구문 분석으로 읽는다', () => {
    const drizzle = extractDbDefs('src/db/schema.ts', [
      "import { pgTable, pgEnum, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';",
      "export const roleEnum = pgEnum('role', ['user', 'admin']);",
      "export const users = pgTable('users', {",
      '  id: serial().primaryKey(),',
      "  email: text('email').notNull().unique(),",
      "  role: roleEnum('role').default('user'),",
      '  createdAt: timestamp().defaultNow(),',
      '});',
      "export const posts = pgTable('posts', (t) => ({ id: t.integer().primaryKey(), authorId: t.integer('author_id').references(() => users.id) }));",
    ].join('\n'));
    expect(drizzle.map((d) => [d.name, d.aliases])).toEqual([['users', ['users']], ['posts', ['posts']]]);
    expect(col(drizzle, 'users', 'email')).toMatchObject({ type: 'text', notNull: true, unique: true, line: 5 });
    expect(col(drizzle, 'users', 'role')).toMatchObject({ check: "['user', 'admin']", default: "'user'" });
    expect(col(drizzle, 'users', 'createdAt')).toMatchObject({ default: 'defaultNow()' });
    expect(col(drizzle, 'posts', 'author_id')).toMatchObject({ references: 'users.id' });

    const typeorm = extractDbDefs('src/entity/User.ts', [
      "import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn } from 'typeorm';",
      "@Entity('users')",
      'export class User {',
      '  @PrimaryGeneratedColumn() id: number;',
      "  @Column({ type: 'varchar', length: 120, unique: true }) email: string;",
      '  @Column({ nullable: true }) nickname: string;',
      '  @CreateDateColumn() createdAt: Date;',
      '  @ManyToOne(() => Team) team: Team;',
      '}',
      '@Entity()',
      'export class Team { @Column() name: string; }',
    ].join('\n'));
    expect(typeorm.map((d) => [d.name, d.kind])).toEqual([['users', 'table'], ['Team', 'model']]);
    expect(col(typeorm, 'users', 'id')).toMatchObject({ primaryKey: true, default: '@PrimaryGeneratedColumn' });
    expect(col(typeorm, 'users', 'email')).toMatchObject({ type: 'varchar', unique: true, notNull: true });
    expect(col(typeorm, 'users', 'nickname')?.notNull).toBeUndefined();
    expect(col(typeorm, 'users', 'team')).toMatchObject({ relation: true, references: 'Team' });

    const mongoose = extractDbDefs('models/User.js', [
      "const mongoose = require('mongoose');",
      'const userSchema = new mongoose.Schema({',
      '  name: String,',
      "  email: { type: String, required: true, unique: true },",
      "  role: { type: String, enum: ['user', 'admin'], default: 'user' },",
      "  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },",
      '  tags: [String],',
      '}, { timestamps: true });',
      "module.exports = mongoose.model('User', userSchema);",
    ].join('\n'));
    expect(mongoose[0]).toMatchObject({ name: 'User', kind: 'model', via: 'Mongoose', aliases: ['User'] });
    expect(mongoose[0]!.columns.map((c) => c.name)).toEqual(['name', 'email', 'role', 'team', 'tags', 'createdAt', 'updatedAt']);
    expect(col(mongoose, 'User', 'email')).toMatchObject({ type: 'String', notNull: true, unique: true });
    expect(col(mongoose, 'User', 'team')).toMatchObject({ references: 'Team' });
    expect(col(mongoose, 'User', 'tags')).toMatchObject({ type: 'String[]' });

    const sequelize = extractDbDefs('models/order.js', [
      "const { DataTypes } = require('sequelize');",
      "const Order = sequelize.define('Order', { total: { type: DataTypes.DECIMAL(10, 2), allowNull: false }, memo: DataTypes.TEXT }, { tableName: 'orders' });",
    ].join('\n'));
    expect(sequelize[0]).toMatchObject({ name: 'orders', kind: 'table', via: 'Sequelize', aliases: ['Order', 'Order'] });
    expect(col(sequelize, 'orders', 'total')).toMatchObject({ type: 'DataTypes.DECIMAL(10, 2)', notNull: true });

    const knex = mergeDbDefs(extractDbDefs('migrations/20240101_init.js', [
      'exports.up = (knex) => knex.schema.createTable(\'accounts\', (table) => {',
      "  table.increments('id');",
      "  table.string('email', 255).notNullable().unique();",
      "  table.integer('team_id').unsigned().references('id').inTable('teams');",
      '  table.timestamps(true, true);',
      '}).alterTable(\'accounts\', (t) => { t.dropColumn(\'email\'); });',
    ].join('\n')));
    expect(knex[0]!.columns.map((c) => c.name)).toEqual(['id', 'team_id', 'created_at', 'updated_at']);
    expect(knex[0]!.columns.find((c) => c.name === 'team_id')).toMatchObject({ type: 'integer unsigned', references: 'teams.id' });
  });

  it('SQLAlchemy·SQLModel·Django 모델을 줄 단위로 읽는다', () => {
    const sqlalchemy = extractDbDefs('app/models.py', [
      'from sqlalchemy import Column, Integer, String, ForeignKey',
      'from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship',
      'class Base(DeclarativeBase):',
      '    pass',
      'class User(Base):',
      '    """회원"""',
      "    __tablename__ = 'users'",
      '    id = Column(Integer, primary_key=True)',
      "    email: Mapped[str] = mapped_column(String(255), unique=True)  # 로그인 이메일",
      '    nickname: Mapped[Optional[str]]',
      "    team_id = Column(Integer, ForeignKey('teams.id'),",
      '                     nullable=False)',
      "    posts = relationship('Post', back_populates='author')",
      '    def __repr__(self):',
      '        return self.email',
    ].join('\n'));
    expect(sqlalchemy.map((d) => d.name)).toEqual(['users']);
    expect(cols(sqlalchemy, 'users').map((c) => c.name)).toEqual(['id', 'email', 'nickname', 'team_id', 'posts']);
    expect(col(sqlalchemy, 'users', 'email')).toMatchObject({ type: 'String(255)', unique: true, notNull: true, note: '로그인 이메일' });
    expect(col(sqlalchemy, 'users', 'nickname')?.notNull).toBeUndefined();
    expect(col(sqlalchemy, 'users', 'team_id')).toMatchObject({ references: 'teams.id', notNull: true, line: 11 });
    expect(col(sqlalchemy, 'users', 'posts')).toMatchObject({ relation: true });

    const sqlmodel = extractDbDefs('app/hero.py', [
      'from sqlmodel import Field, SQLModel',
      'class Hero(SQLModel, table=True):',
      '    id: int | None = Field(default=None, primary_key=True)',
      '    name: str = Field(index=True)',
      '    team_id: int | None = Field(default=None, foreign_key="team.id")',
      'class HeroRead(SQLModel):',
      '    name: str',
    ].join('\n'));
    expect(sqlmodel.map((d) => [d.name, d.kind, d.via])).toEqual([['Hero', 'model', 'SQLModel']]);
    expect(col(sqlmodel, 'Hero', 'name')).toMatchObject({ type: 'str', notNull: true });
    expect(col(sqlmodel, 'Hero', 'team_id')).toMatchObject({ references: 'team.id' });

    const django = extractDbDefs('blog/models.py', [
      'from django.db import models',
      'class Post(models.Model):',
      '    title = models.CharField(max_length=200, help_text="글 제목")',
      '    author = models.ForeignKey("auth.User", on_delete=models.CASCADE)',
      '    status = models.CharField(max_length=10, choices=STATUS, default="draft")',
      '    published = models.DateTimeField(null=True)',
      '    tags = models.ManyToManyField(Tag)',
      '    objects = models.Manager()',
      '    class Meta:',
      '        db_table = "blog_posts"',
    ].join('\n'));
    expect(django[0]).toMatchObject({ name: 'blog_posts', kind: 'table', via: 'Django' });
    expect(cols(django, 'blog_posts').map((c) => c.name)).toEqual(['title', 'author', 'status', 'published', 'tags']);
    expect(col(django, 'blog_posts', 'title')).toMatchObject({ type: 'CharField(200)', notNull: true, note: '글 제목' });
    expect(col(django, 'blog_posts', 'author')).toMatchObject({ references: '"auth.User"' });
    expect(col(django, 'blog_posts', 'published')?.notNull).toBeUndefined();
    expect(col(django, 'blog_posts', 'tags')).toMatchObject({ relation: true });
  });

  it('표를 쓰는 줄을 이름 문자열·REST 경로·SQL 문·불러온 모델 이름·Prisma 접근자로 찾는다', () => {
    const defs = mergeDbDefs([
      ...extractDbDefs('db/001.sql', 'create table members (id uuid primary key);'),
      ...extractDbDefs('src/models.ts', "import { pgTable, text } from 'drizzle-orm/pg-core';\nexport const notes = pgTable('note_rows', { body: text() });"),
      ...extractDbDefs('prisma/schema.prisma', 'model Account {\n  id Int @id\n}'),
    ]);
    const files = [
      { path: 'src/api.ts', hash: 'h1', text: "import x from './members';\nconst a = supabase.from('members').select();\nfetch(`/rest/v1/members?id=eq.${id}`);\nconst members = [];\nconst rows = db.query('SELECT * FROM members');" },
      { path: 'src/notes.ts', hash: 'h2', text: "import { notes } from './models';\nexport const list = () => db.select().from(notes);" },
      { path: 'src/other.ts', hash: 'h3', text: 'const notes = [];\nnotes.push(1);' },
      { path: 'src/account.ts', hash: 'h4', text: 'await prisma.account.findMany();\nconst account = {};' },
      { path: 'src/old.ts', hash: 'h5', text: "// supabase.from('members') 예전 코드\n  * update members 는 나중에" },
    ];
    const imports = new Map([['src/notes.ts', ['src/models.ts']], ['src/other.ts', []]]);
    const found = findDbUsages(defs, files, imports);
    const lines = (name: string) => found.get(defs.find((d) => d.name === name)!)!.map((u) => `${u.path}:${u.line}`);
    expect(lines('members')).toEqual(['src/api.ts:2', 'src/api.ts:3', 'src/api.ts:5']);
    expect(lines('note_rows')).toEqual(['src/notes.ts:2']);
    expect(lines('Account')).toEqual(['src/account.ts:1']);
  });

  it('SQL 함수가 읽고 쓰는 표를 모으고, 코드에서 그 함수를 부르는 줄을 그 표의 쓰는 곳으로 본다', () => {
    const sql = [
      'create table public.members (id uuid primary key, approved boolean);',
      'create table public.locks (key text primary key);',
      "create function public.list_members() returns setof public.members language sql as $$ select * from public.members $$;",
      'create function public.approve(target uuid) returns void language plpgsql security definer as $fn$',
      'begin',
      '  -- update public.locks 는 주석이라 세지 않는다',
      '  perform public.check_admin();',
      '  update public.members set approved = true where id = target;',
      'end $fn$;',
      "create function public.check_admin() returns boolean language sql as 'select exists (select 1 from public.locks)';",
      'create or replace function public.list_members() returns setof public.members language sql as $$ select 1 $$;',
    ].join('\n');
    const defs = mergeDbDefs(extractDbDefs('db/001.sql', sql));
    const routines = extractDbRoutines('db/001.sql', sql);
    expect(routines.map((r) => [r.name, r.line, r.tables])).toEqual([['list_members', 3, ['members']], ['approve', 4, ['members']], ['check_admin', 10, ['locks']], ['list_members', 11, []]]);
    expect(extractDbRoutines('src/a.ts', sql)).toEqual([]);
    const by = routinesByTable(defs, routines);
    const names = (t: string) => by.get(defs.find((d) => d.name === t)!)!.map((r) => r.name);
    // 나중 정의(create or replace)가 앞의 것을 대신하고, 다른 함수를 거쳐 쓰는 표도 센다
    expect(names('members')).toEqual(['approve']);
    expect(names('locks')).toEqual(['approve', 'check_admin']);
    const files = [
      { path: 'src/admin.ts', hash: 'h1', text: "export const approve = (id: string) => client.rpc('approve', { target: id });\nfetch('/rest/v1/rpc/check_admin');" },
      { path: 'scripts/setup.ts', hash: 'h2', text: "const TABLES = ['members', 'locks', 'other'];\nconst other = 1;" },
      { path: 'src/other.ts', hash: 'h3', text: "db.from('other').select();" },
    ];
    const withOther = [...defs, ...mergeDbDefs(extractDbDefs('db/002.sql', 'create table other (id int);'))];
    const found = findDbUsages(withOther, [...files, { path: 'src/z.ts', hash: 'h4', text: "db.from('members').select();" }], new Map(), routines);
    const lines = (t: string) => found.get(withOther.find((d) => d.name === t)!)!.map((u) => `${u.path}:${u.line}${u.via ? ` via ${u.via}` : ''}`);
    // 표 이름을 셋 늘어놓은 줄(설치 스크립트의 표 목록)은 실제로 쓰는 줄 뒤로 간다
    expect(lines('members')).toEqual(['src/admin.ts:1 via approve', 'src/z.ts:1', 'scripts/setup.ts:1']);
    expect(lines('locks')).toEqual(['src/admin.ts:1 via approve', 'src/admin.ts:2 via check_admin', 'scripts/setup.ts:1']);
    const db = buildDatabase({ defs: extractDbDefs('db/001.sql', sql), routines, files, hashes: new Map([['db/001.sql', 'hs']]), imports: new Map(), limited: false })!;
    const members = db.tables.find((t) => t.name === 'members')!;
    expect(members.routines).toEqual([{ name: 'approve', source: { kind: 'file', path: 'db/001.sql', startLine: 4, endLine: 4, hash: 'hs' } }]);
    expect(db.hints[members.id]!.usages[0]).toContain('(SQL 함수 approve 안에서 이 표를 씀)');
  });

  it('표를 화면 자료로 만들 때 줄 근거와 파일 지문을 붙이고, 비밀값을 가린다', () => {
    const defs = extractDbDefs('db/schema.sql', `create table keys (\n  id int primary key,\n  token text default '${SECRET}'\n);`);
    const files = [{ path: 'src/a.ts', hash: 'hash-a', text: `db.from('keys').insert({ token: '${SECRET}' });` }];
    const db = buildDatabase({ defs, files, hashes: new Map([['db/schema.sql', 'hash-s'], ['src/a.ts', 'hash-a']]), imports: new Map(), limited: false })!;
    const table = db.tables[0]!;
    expect(table).toMatchObject({ id: 'keys', name: 'keys', source: { kind: 'file', path: 'db/schema.sql', startLine: 1, endLine: 4, hash: 'hash-s' }, usages: [{ path: 'src/a.ts', startLine: 1, endLine: 1, hash: 'hash-a' }] });
    expect(table.columns[1]).toMatchObject({ name: 'token', source: { startLine: 3, endLine: 3 } });
    expect(JSON.stringify(db)).not.toContain(SECRET);
  });
});

describe('레포 위키에 데이터베이스 표 싣기', () => {
  it('스캔이 SQL·ORM 정의와 쓰는 곳을 모아 동작 페이지 원문 블록과 AI 입력을 만든다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-repo-db-')); temps.push(root);
    const write = async (rel: string, text: string) => { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); };
    await write('package.json', JSON.stringify({ scripts: { start: 'node src/main.ts' } }));
    await write('supabase/migrations/001_init.sql', `-- 할 일\ncreate table public.todos (\n  id uuid primary key,\n  title text not null, -- 할 일 제목\n  secret text default '${SECRET}'\n);`);
    await write('supabase/tests/rls.sql', 'create table test_only (id int);');
    await write('src/main.ts', "import { list } from './todos';\nexport const main = () => list();\n");
    await write('src/todos.ts', "export const list = () => supabase.from('todos').select('id, title');\n");
    await write('.env', `DATABASE_URL=postgres://user:${SECRET}@db/x\n`);
    await write('README.md', '# 할 일 앱\n할 일을 적고 확인합니다.\n');
    const scan = await scanRepo(root);
    expect(scan.database?.tables.map((t) => t.name)).toEqual(['todos']);
    const draft = buildRepoWiki({ project: { id: 'p', name: 'todo', rootPath: root }, scan, sessions: [] });
    const section = draft.system.find((s) => s.id === 'database');
    const block = section?.blocks[0];
    expect(block?.kind).toBe('database');
    const table = (block as { db: { tables: RepoDbTable[] } }).db.tables[0]!;
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'title', 'secret']);
    expect(table.usages.map((u) => `${u.path}:${u.startLine}`)).toEqual(['src/todos.ts:1']);
    // 표를 쓰는 파일을 불러오는 파일 (기능 연결 질문에 단서로 준다)
    expect(scan.database?.importers).toEqual({ 'src/todos.ts': ['src/main.ts'] });
    expect(draft.facts.tables).toEqual(['public.todos(id,title,secret)']);
    const prompt = buildRepoAiPrompt({ draft, scan, sessions: [] });
    expect(prompt.user).toContain('[todos] public.todos · SQL 테이블 · 정의 F:supabase/migrations/001_init.sql#L2-L6');
    expect(prompt.user).toContain('title text [필수] — 주석: 할 일 제목');
    expect(prompt.user).toContain("F:src/todos.ts#L1-L1 export const list = () => supabase.from('todos')");
    expect(prompt.dbUser).toContain('[todos]');
    // 주요 기능은 표와의 연결을 먼저 보므로 표 자료와 '표를 쓰는 파일'이 README 보다 앞에 온다
    expect(prompt.dbUser).toContain('=== 표를 쓰는 파일 (파일 → 표 id) ===\nF:src/todos.ts → todos');
    expect(prompt.user.indexOf('=== 데이터베이스 표')).toBeGreaterThan(0);
    expect(prompt.user.indexOf('=== 데이터베이스 표')).toBeLessThan(prompt.user.indexOf('=== README'));
    expect(prompt.user).not.toContain('이전 판은 데이터베이스 표');
    // 표를 모으기 전의 판과 비교할 때는 표 목록 차이를 저장소 변경으로 쓰지 않게 알린다
    const { tables: _omit, ...oldFacts } = draft.facts;
    const next = buildRepoWiki({ project: { id: 'p', name: 'todo', rootPath: root }, scan, sessions: [], previous: { ...draft, facts: oldFacts } });
    expect(buildRepoAiPrompt({ draft: next, scan, sessions: [] }).user).toContain('이전 판은 데이터베이스 표(tables)를 모으지 않았습니다');
    expect(JSON.stringify({ scan, draft, prompt })).not.toContain(SECRET);
  });
});

describe('AI 표 설명 검사', () => {
  const defs = [
    ...extractDbDefs('db/schema.sql', 'create table members (\n  id uuid primary key,\n  email text not null\n);\ncreate table logs (id int);'),
  ];
  const files = [
    { path: 'src/members.ts', hash: 'hm', text: "export const list = () => db.from('members').select();" },
    { path: 'src/logs.ts', hash: 'hl', text: "export const write = () => db.from('logs').insert({});" },
  ];
  const database = buildDatabase({ defs, files, hashes: new Map([['db/schema.sql', 'hs'], ['src/members.ts', 'hm'], ['src/logs.ts', 'hl']]), imports: new Map(), limited: false })!;
  const scan: RepoScan = { root: '/r', readable: 'ok', scannedAt: '', signature: 's', files: ['db/schema.sql', 'src/members.ts', 'src/logs.ts', 'README.md'].map((p) => ({ path: p, size: 1 })), truncated: false, packages: [], docker: false, routes: [], database };
  const draft = buildRepoWiki({ project: { id: 'p', name: 'demo', rootPath: '/r' }, scan, sessions: [] });
  const fileSet = new Set(scan.files.map((f) => f.path));
  const features = [
    { id: 'members', name: '회원 목록', summary: '회원을 봅니다.', files: ['F:src/members.ts'], sessions: [], sources: ['F:src/members.ts'] },
    { id: 'audit', name: '기록', summary: '기록을 남깁니다.', files: ['F:src/logs.ts'], sessions: [], sources: ['F:src/logs.ts'] },
  ];
  const apply = (databaseTables: NonNullable<Parameters<typeof applyRepoAi>[0]['output']['databaseTables']>, sourceBlocks: string[] = ['database'], page: 'user' | 'system' = 'system') => applyRepoAi({ draft, handles: new Map(), fileSet, result: { provider: 'openrouter', durationMs: 1 },
    output: { changes: [], routeDescriptions: [], flowGroups: [], flowNodes: [], features, databaseTables,
      sections: [{ id: 'data', page, title: '데이터 저장', paragraphs: ['회원과 기록을 저장합니다.'], items: [], sources: ['F:db/schema.sql'], sourceBlocks }] } });
  const tablesOf = (wiki: ReturnType<typeof apply>) => wiki.system.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'database' ? b.db.tables : []));

  it('표 id·컬럼 이름·주요 기능·근거를 확인한 설명만 원문 표에 붙이고 원문 값은 바꾸지 않는다', () => {
    const wiki = apply([
      { table: 'members', description: `회원 한 명의 로그인 정보를 저장합니다. ${SECRET}`, sources: ['F:db/schema.sql#L1-L4'],
        columns: [{ name: 'email', description: '로그인 이메일 주소' }, { name: 'password', description: '없는 컬럼' }],
        features: [
          { id: 'members', usage: '회원 목록을 조회합니다.', sources: ['F:src/members.ts#L1-L1'] },
          { id: 'ghost', usage: '없는 기능', sources: ['F:src/members.ts'] },
          { id: 'audit', usage: '근거가 이 표와 무관합니다.', sources: ['F:README.md'] },
        ] },
      { table: 'invented', description: '없는 표', sources: ['F:db/schema.sql'], columns: [], features: [] },
      { table: 'logs', description: '근거 없는 설명', sources: ['F:README.md'], columns: [], features: [] },
    ]);
    const [members, logs] = tablesOf(wiki);
    expect(wiki.system.map((s) => s.id)).toEqual(['data']);
    expect(members).toMatchObject({ description: '회원 한 명의 로그인 정보를 저장합니다. ***', features: [{ featureId: 'members', usage: '회원 목록을 조회합니다.' }] });
    expect(members!.columns.map((c) => [c.name, c.type, c.description])).toEqual([['id', 'uuid', undefined], ['email', 'text', '로그인 이메일 주소']]);
    // 근거를 확인하지 못한 표 설명은 버리되, 기능 파일에 표를 쓰는 줄이 있으면 코드에서 확인한 연결은 남긴다
    expect(logs!.description).toBeUndefined();
    expect(logs!.features).toEqual([{ featureId: 'audit', sources: [expect.objectContaining({ path: 'src/logs.ts', startLine: 1 })] }]);
    expect(wiki.features?.map((f) => [f.id, f.tables?.map((t) => [t.id, t.usage ?? null])])).toEqual([['members', [['members', '회원 목록을 조회합니다.']]], ['audit', [['logs', null]]]]);
    expect(wiki.warnings[0]).toContain('5개');
    expect(JSON.stringify(wiki)).not.toContain(SECRET);
    expect(incompleteRepoDbTables(draft, wiki)).toEqual({ undescribed: ['logs'], unlinked: [], unlinkedUsed: [] });
  });

  it('공통 기반이라는 답은 근거를 확인한 표에만, 주요 기능과 이어지지 않을 때만 싣고, 그 표는 잇지 못한 표로 세지 않는다', () => {
    const wiki = apply([
      { table: 'members', description: '회원을 저장합니다.', sources: ['F:db/schema.sql#L1-L4'], columns: [], features: [{ id: 'members', usage: '회원을 봅니다.', sources: ['F:src/members.ts#L1-L1'] }], base: '기능과 이어졌으니 보이지 않습니다.' },
      { table: 'logs', description: '작업 기록을 남깁니다.', sources: ['F:db/schema.sql#L5-L5'], columns: [], features: [], base: `작업 기록을 남기는 공통 기반입니다. ${SECRET}` },
    ]);
    // logs 는 기능 파일(src/logs.ts)에서 쓰는 줄이 있어 코드로 이어지므로 공통 기반 답은 싣지 않는다
    const [members, logs] = tablesOf(wiki);
    expect(members!.base).toBeUndefined();
    expect(logs!.base).toBeUndefined();
    const noAudit = applyRepoAi({ draft, handles: new Map(), fileSet, result: { provider: 'openrouter', durationMs: 1 },
      output: { changes: [], routeDescriptions: [], flowGroups: [], flowNodes: [], features: [features[0]!],
        databaseTables: [{ table: 'logs', description: '작업 기록을 남깁니다.', sources: ['F:db/schema.sql#L5-L5'], columns: [], features: [], base: `작업 기록을 남기는 공통 기반입니다. ${SECRET}` }],
        sections: [{ id: 'data', page: 'system', title: '데이터 저장', paragraphs: ['저장합니다.'], items: [], sources: ['F:db/schema.sql'], sourceBlocks: ['database'] }] } });
    const kept = tablesOf(noAudit).find((t) => t.id === 'logs')!;
    expect(kept.base).toEqual({ text: '작업 기록을 남기는 공통 기반입니다. ***', sources: [expect.objectContaining({ path: 'db/schema.sql', startLine: 5 })] });
    expect(incompleteRepoDbTables(draft, noAudit).unlinked).not.toContain('logs');
  });

  it('어떤 주요 기능과도 이어지지 않은 표를 찾고, 보완 결과로 기능 연결과 새 기능을 더한다', () => {
    // logs 를 쓰는 기능을 고르지 않은 출력: logs 는 쓰는 곳이 있는데 기능과 이어지지 않는다
    const only = [features[0]!];
    const output: RepoAiOutput = { changes: [], routeDescriptions: [], flowGroups: [], flowNodes: [], features: only,
      databaseTables: [{ table: 'logs', description: '작업 기록을 남깁니다.', sources: ['F:db/schema.sql#L5-L5'], columns: [], features: [] }],
      sections: [{ id: 'data', page: 'system', title: '데이터 저장', paragraphs: ['저장합니다.'], items: [], sources: ['F:db/schema.sql'], sourceBlocks: ['database'] }] };
    const run = (o: RepoAiOutput) => applyRepoAi({ draft, handles: new Map(), fileSet, result: { provider: 'openrouter', durationMs: 1 }, output: o });
    const first = incompleteRepoDbTables(draft, run(output));
    expect(first).toEqual({ undescribed: ['members'], unlinked: ['logs'], unlinkedUsed: ['logs'] });
    const merged = mergeRepoDbRepair(output, {
      databaseTables: [
        { table: 'members', description: '회원을 저장합니다.', sources: ['F:db/schema.sql#L1-L4'], columns: [{ name: 'email', description: '이메일' }], features: [] },
        // 이미 통과한 설명은 바꾸지 않고 기능 연결만 더한다
        { table: 'logs', description: '바꾸면 안 되는 설명', sources: ['F:db/schema.sql'], columns: [], features: [{ id: 'audit-log', usage: '작업 기록을 남깁니다.', sources: ['F:src/logs.ts#L1-L1'] }] },
        { table: 'invented', description: '요청하지 않은 표', sources: [], columns: [], features: [] },
      ],
      newFeatures: [
        { id: 'audit-log', name: '작업 기록', summary: '작업 기록을 남깁니다.', files: ['F:src/logs.ts'], sessions: [], sources: ['F:src/logs.ts'] },
        { id: 'members', name: '중복', summary: '이미 있는 id', files: ['F:src/logs.ts'], sessions: [], sources: [] },
      ],
    }, first);
    expect(merged.features.map((f) => f.id)).toEqual(['members', 'audit-log']);
    expect(merged.databaseTables.map((t) => t.table)).toEqual(['logs', 'members']);
    const wiki = run(merged);
    const tables = tablesOf(wiki);
    expect(tables.find((t) => t.id === 'logs')).toMatchObject({ description: '작업 기록을 남깁니다.', features: [{ featureId: 'audit-log', usage: '작업 기록을 남깁니다.' }] });
    expect(tables.find((t) => t.id === 'members')?.description).toBe('회원을 저장합니다.');
    expect(incompleteRepoDbTables(draft, wiki)).toEqual({ undescribed: [], unlinked: [], unlinkedUsed: [] });
    expect(wiki.features?.find((f) => f.id === 'audit-log')?.tables?.map((t) => t.id)).toEqual(['logs']);
  });

  it('AI 가 동작 페이지 절에 표를 넣지 않았으면 동작 페이지 끝에 싣고, 사용자 페이지에는 싣지 않는다', () => {
    const fallback = apply([], []);
    expect(fallback.system.map((s) => [s.id, s.origin])).toEqual([['data', 'llm'], ['database', 'source']]);
    expect(tablesOf(fallback).map((t) => t.name)).toEqual(['members', 'logs']);
    const userPage = apply([], ['database'], 'user');
    expect(userPage.user.flatMap((s) => s.blocks.map((b) => b.kind))).not.toContain('database');
    expect(userPage.system.map((s) => s.id)).toEqual(['database']);
  });
});
