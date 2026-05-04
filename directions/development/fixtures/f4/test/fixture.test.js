/**
 * F4 fixture: 测试 SKILL.md 是否满足 eval case 要求
 *
 * 从零创建 SKILL.md 的场景：初始状态下 SKILL.md 不存在，
 * 所有 eval case 应该失败，直到 Skill 被正确创建。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const skillPath = path.join(projectRoot, 'SKILL.md');
const evalCasesDir = path.join(projectRoot, 'eval-cases');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

// 读取所有 eval case
const caseFiles = fs.existsSync(evalCasesDir)
  ? fs.readdirSync(evalCasesDir).filter(f => f.endsWith('.json')).sort()
  : [];

const skillContent = fs.existsSync(skillPath)
  ? fs.readFileSync(skillPath, 'utf-8')
  : '';

for (const file of caseFiles) {
  const raw = fs.readFileSync(path.join(evalCasesDir, file), 'utf-8');
  const evalCase = JSON.parse(raw);

  test(evalCase.name || file, () => {
    assert.ok(fs.existsSync(skillPath), 'SKILL.md 不存在');
    for (const section of evalCase.expected_sections) {
      assert.ok(
        skillContent.includes(section),
        `SKILL.md 中缺少: ${section}`
      );
    }
  });
}

if (!process.exitCode) {
  console.log('\nAll tests passed!');
}
