#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content.trimEnd()}\n`, 'utf8');
}

function sanitizeFileSegment(value) {
  return value.replace(/[<>:"/\\|?*]+/g, '-').trim();
}

function normalizeHeadingFragment(value) {
  return value.replace(/\r\n/g, '\n').trim();
}

function extractSection(markdown, heading, nextHeadings) {
  const normalized = normalizeHeadingFragment(markdown);
  const headingToken = `${heading}\n`;
  const startIndex = normalized.indexOf(headingToken);
  if (startIndex === -1) {
    return '';
  }

  const contentStart = startIndex + headingToken.length;
  let contentEnd = normalized.length;

  for (const nextHeading of nextHeadings) {
    const nextIndex = normalized.indexOf(`\n${nextHeading}`, contentStart - 1);
    if (nextIndex !== -1 && nextIndex + 1 < contentEnd) {
      contentEnd = nextIndex + 1;
    }
  }

  return normalized
    .slice(contentStart, contentEnd)
    .replace(/\n---\s*$/u, '')
    .trim();
}

function extractFirstMatch(markdown, expression) {
  const match = normalizeHeadingFragment(markdown).match(expression);
  return match ? match[1].trim() : '';
}

function listDirectories(directoryPath) {
  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directoryPath, entry.name));
}

function findLatestProject(projectsDir) {
  const candidates = listDirectories(projectsDir);
  if (candidates.length === 0) {
    throw new Error(`No projects found in ${projectsDir}`);
  }

  const scored = candidates.map((projectDir) => ({
    projectDir,
    mtimeMs: collectLatestModifiedTime(projectDir),
  }));

  scored.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return scored[0].projectDir;
}

function collectLatestModifiedTime(directoryPath) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  let latest = fs.statSync(directoryPath).mtimeMs;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    const current = entry.isDirectory()
      ? collectLatestModifiedTime(entryPath)
      : fs.statSync(entryPath).mtimeMs;
    if (current > latest) {
      latest = current;
    }
  }

  return latest;
}

function listChapterFiles(chaptersDir) {
  if (!fs.existsSync(chaptersDir)) {
    return [];
  }

  return fs
    .readdirSync(chaptersDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^ch\d+\.md$/iu.test(entry.name))
    .map((entry) => path.join(chaptersDir, entry.name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function parseState(projectDir) {
  const statePath = path.join(projectDir, '.thriller-state.json');
  if (!fs.existsSync(statePath)) {
    return {};
  }

  return JSON.parse(readText(statePath));
}

function findCharacterByRole(state, token) {
  const cast = Array.isArray(state.characters && state.characters.cast)
    ? state.characters.cast
    : [];
  const tokenizeRole = (role) =>
    String(role)
      .split(/[\/、，,·]/u)
      .map((entry) => entry.trim())
      .filter(Boolean);

  return (
    cast.find((character) => tokenizeRole(character.role).includes(token)) ||
    cast.find((character) => tokenizeRole(character.role).some((entry) => entry.startsWith(token))) ||
    cast.find((character) => typeof character.role === 'string' && character.role.includes(token))
  );
}

function buildChapterManuscript(filePath) {
  const markdown = readText(filePath);
  const title = extractFirstMatch(markdown, /^#\s+(.+)$/mu);
  const body = extractSection(markdown, '## 正文', ['## 章末钩子']);
  const hook = extractSection(markdown, '## 章末钩子', ['### 创作备注', '### 交互设计']);

  if (!title || !body) {
    throw new Error(`Unable to extract manuscript content from ${filePath}`);
  }

  const parts = [`## ${title}`, body];
  if (hook) {
    parts.push(hook);
  }

  return parts.join('\n\n').trim();
}

function buildCompleteManuscript(projectTitle, chapterFiles) {
  const chapters = chapterFiles.map(buildChapterManuscript);
  if (chapters.length === 0) {
    throw new Error('No chapter files were found to export.');
  }

  return [`# 《${projectTitle}》`, ...chapters].join('\n\n');
}

function extractSupportSection(markdownPath, heading, nextHeadings) {
  if (!fs.existsSync(markdownPath)) {
    return '';
  }

  const markdown = readText(markdownPath);
  return extractSection(markdown, heading, nextHeadings);
}

function extractMermaidBlock(markdownPath) {
  if (!fs.existsSync(markdownPath)) {
    return '';
  }

  const markdown = readText(markdownPath);
  const match = markdown.match(/```mermaid\n([\s\S]*?)```/u);
  return match ? `\`\`\`mermaid\n${match[1].trim()}\n\`\`\`` : '';
}

function chapterTitlesFromFiles(chapterFiles) {
  return chapterFiles.map((filePath) => {
    const title = extractFirstMatch(readText(filePath), /^#\s+(.+)$/mu);
    return title || path.basename(filePath, '.md');
  });
}

function buildSummary(projectTitle, state, chapterTitles) {
  const protagonist = findCharacterByRole(state, '主角');
  const killer = findCharacterByRole(state, '凶手');
  const victimOne = findCharacterByRole(state, '受害者1');
  const victimTwo = findCharacterByRole(state, '受害者2');
  const redHerring = findCharacterByRole(state, '红鲱鱼');
  const ally = findCharacterByRole(state, '盟友');
  const absent = state.characters && state.characters.absent ? state.characters.absent : null;
  const subElements = Array.isArray(state.subElements) && state.subElements.length > 0
    ? state.subElements.join(' / ')
    : '悬疑';
  const themePremise = state.theme && state.theme.premise ? state.theme.premise : '';
  const premise = state.premise || '';
  const trickType = state.trickType || '封闭空间诡计';
  const castCount = Array.isArray(state.characters && state.characters.cast)
    ? state.characters.cast.length
    : 0;
  const chapterList = chapterTitles.map((title, index) => `${index + 1}. ${title}`).join('\n');

  const synopsisParagraphs = [
    protagonist
      ? `暴雨把${castCount || '几'}名学生困在偏僻山中的旧旅舍里。${protagonist.name}原本只是受邀同行的旁观者，却在停电、脚步声和伪造的“闹鬼”痕迹中，被迫卷入一场不断升级的封闭空间杀局。`
      : premise || '一场与世隔绝的危机，把所有人推入不断升级的杀局之中。',
    victimOne && redHerring
      ? `${victimOne.name}死于反锁房间后，幸存者的恐惧迅速把怀疑推向${redHerring.name}。${protagonist ? protagonist.name : '主角'}开始把自己记录下来的空间细节、行为异常和时间断点重新拼接，试图在群体崩坏之前找出真正的凶手。`
      : '',
    victimTwo && ally
      ? `${victimTwo.name}的遇害让案件从单一密室升级为连环杀局。随着${protagonist ? protagonist.name : '主角'}选择信任${ally.name}，隐藏在“超自然现象”背后的人工操控、诡计路径和前史创伤被一步步拉回光下。`
      : '',
    killer && absent
      ? `真相最终指向${killer.name}与${absent.name}相关的旧伤，也把故事从“谁杀了人”推进到“谁曾经看见却没有出声”。机制层面，本作以${trickType}构成公平推理链；情感层面，则围绕“${themePremise || '恐惧与怀疑会怎样摧毁群体'}”展开。`
      : '',
  ].filter(Boolean);

  const blurb = [
    `暴雨封山，一群学生被困在偏僻山中的旧旅舍里。停电、脚步声、伪造的“闹鬼”痕迹先把他们推向互相怀疑，紧接着，一具尸体出现在从内反锁的房间里。`,
    protagonist
      ? `内向的${protagonist.name}只能依靠自己的观察、记录与迟迟不肯消失的不对劲感，在下一次死亡到来前把真相从恐惧里拉出来。`
      : '主角只能依靠观察、记录与不断回溯的细节，在下一次死亡到来前把真相从恐惧里拉出来。',
  ].join('');

  const sellingPoints = [
    `类型融合：${state.type || '悬疑'}主轴，叠加${subElements}气质，兼具公平推理与惊悚压迫感。`,
    `空间卖点：暴雨山庄、老式窗锁、石檐路径与封闭群体，共同构成高辨识度的密室舞台。`,
    `人物卖点：由“最可靠的人”承担真凶位，反转建立在关系与信任之上，不只靠信息遮蔽。`,
    `情感卖点：把复仇、旁观者愧疚与“是否还记得受害者”缠在同一条揭示线上，结尾余味偏苦涩。`,
    `阅读卖点：章节推进快，章末钩子明确，适合改编为互动叙事或视觉小说结构。`,
  ];

  return [
    `# 《${projectTitle}》作品概要`,
    '## 一句话简介',
    premise || '封闭空间中的连环杀局，迫使旁观者成为行动者。',
    '## 梗概',
    synopsisParagraphs.join('\n\n'),
    '## 简介',
    blurb,
    '## 卖点分析',
    sellingPoints.map((item) => `- ${item}`).join('\n'),
    '## 章节目录',
    chapterList,
  ].join('\n\n');
}

function buildClueMap(projectTitle, projectDir) {
  const trickDesignPath = path.join(projectDir, 'trick-design.md');
  const coreClues = extractSupportSection(trickDesignPath, '### 关键线索清单', [
    '### 辅助线索',
  ]);
  const supportClues = extractSupportSection(trickDesignPath, '### 辅助线索', [
    '### 红鲱鱼清单',
  ]);
  const herrings = extractSupportSection(trickDesignPath, '### 红鲱鱼清单', [
    '### 线索-章节时间表（短篇 8 章版）',
    '### 线索-章节时间表',
  ]);
  const chapterMap =
    extractSupportSection(trickDesignPath, '### 线索-章节时间表（短篇 8 章版）', ['## 四、诡计可行性分析']) ||
    extractSupportSection(trickDesignPath, '### 线索-章节时间表', ['## 四、诡计可行性分析']);

  return [
    `# 《${projectTitle}》线索-章节对照表`,
    '## 关键线索',
    coreClues || '未找到关键线索表。',
    '## 辅助线索',
    supportClues || '未找到辅助线索表。',
    '## 红鲱鱼',
    herrings || '未找到红鲱鱼表。',
    '## 线索-章节时间表',
    chapterMap || '未找到线索-章节时间表。',
  ].join('\n\n');
}

function buildRelationshipFile(projectTitle, projectDir) {
  const charactersPath = path.join(projectDir, 'characters.md');
  const mermaid = extractMermaidBlock(charactersPath);
  const pairwise = extractSupportSection(charactersPath, '### 两两关系定义', ['### 秘密链']);
  const secretChain = extractSupportSection(charactersPath, '### 秘密链', ['## 七、角色与主题映射']);

  return [
    `# 《${projectTitle}》角色关系图`,
    '## 关系图',
    mermaid || '未找到 Mermaid 关系图。',
    '## 两两关系定义',
    pairwise || '未找到关系定义表。',
    '## 秘密链',
    secretChain || '未找到秘密链。',
  ].join('\n\n');
}

function buildTimelineFile(projectTitle, projectDir) {
  const structurePath = path.join(projectDir, 'structure.md');
  const storyTimeline = extractSupportSection(structurePath, '### 故事时间线（案件实际发生顺序）', [
    '### 叙事时间线（读者接收信息的顺序）',
  ]);
  const narrativeTimeline = extractSupportSection(structurePath, '### 叙事时间线（读者接收信息的顺序）', [
    '### 时间线错位设计',
  ]);
  const offsets = extractSupportSection(structurePath, '### 时间线错位设计', ['## 六、悬念管理表']);

  return [
    `# 《${projectTitle}》时间线图表`,
    '## 故事时间线',
    storyTimeline || '未找到故事时间线。',
    '## 叙事时间线',
    narrativeTimeline || '未找到叙事时间线。',
    '## 时间线错位设计',
    offsets || '未找到时间线错位说明。',
  ].join('\n\n');
}

function exportProject(projectDir) {
  const absoluteProjectDir = path.resolve(projectDir);
  const state = parseState(absoluteProjectDir);
  const projectTitle = sanitizeFileSegment(state.project || path.basename(absoluteProjectDir));
  const chapterFiles = listChapterFiles(path.join(absoluteProjectDir, 'chapters'));
  const exportDir = path.join(absoluteProjectDir, 'export');
  const chapterTitles = chapterTitlesFromFiles(chapterFiles);

  const outputs = [
    {
      path: path.join(exportDir, `${projectTitle}-complete.md`),
      content: buildCompleteManuscript(projectTitle, chapterFiles),
    },
    {
      path: path.join(exportDir, `${projectTitle}-summary.md`),
      content: buildSummary(projectTitle, state, chapterTitles),
    },
    {
      path: path.join(exportDir, `${projectTitle}-clue-map.md`),
      content: buildClueMap(projectTitle, absoluteProjectDir),
    },
    {
      path: path.join(exportDir, `${projectTitle}-relationships.md`),
      content: buildRelationshipFile(projectTitle, absoluteProjectDir),
    },
    {
      path: path.join(exportDir, `${projectTitle}-timeline.md`),
      content: buildTimelineFile(projectTitle, absoluteProjectDir),
    },
  ];

  for (const output of outputs) {
    writeText(output.path, output.content);
  }

  return outputs.map((output) => output.path);
}

function resolveProjectDir(argumentValue) {
  if (argumentValue) {
    return path.resolve(process.cwd(), argumentValue);
  }

  return findLatestProject(path.resolve(process.cwd(), 'projects'));
}

function main() {
  const projectDir = resolveProjectDir(process.argv[2]);
  const writtenFiles = exportProject(projectDir);

  for (const filePath of writtenFiles) {
    const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    console.log(`OK: wrote ${relativePath}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCompleteManuscript,
  buildSummary,
  buildClueMap,
  buildRelationshipFile,
  buildTimelineFile,
  exportProject,
  resolveProjectDir,
};
