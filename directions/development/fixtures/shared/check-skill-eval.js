/**
 * Skill fixture 共享脚本：检查 SKILL.md 是否满足 eval case 要求
 */

const fs = require('fs');
const path = require('path');

const projectRoot = process.argv[2] || process.cwd();
const skillPath = path.join(projectRoot, 'SKILL.md');
const evalCasesDir = path.join(projectRoot, 'eval-cases');

if (!fs.existsSync(skillPath)) {
  console.error('FAIL: SKILL.md 不存在');
  process.exit(1);
}

const skillContent = fs.readFileSync(skillPath, 'utf-8');

if (!fs.existsSync(evalCasesDir)) {
  console.error('FAIL: eval-cases 目录不存在');
  process.exit(1);
}

const caseFiles = fs.readdirSync(evalCasesDir)
  .filter(f => f.endsWith('.json'))
  .sort();

let passed = 0;
let failed = 0;

for (const file of caseFiles) {
  const raw = fs.readFileSync(path.join(evalCasesDir, file), 'utf-8');
  const evalCase = JSON.parse(raw);

  const missing = evalCase.expected_sections.filter(
    section => !skillContent.includes(section)
  );

  if (missing.length === 0) {
    passed++;
    console.log(`  PASS: ${evalCase.name || file}`);
  } else {
    failed++;
    console.log(`  FAIL: ${evalCase.name || file} — 缺少章节: ${missing.join(', ')}`);
  }
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
