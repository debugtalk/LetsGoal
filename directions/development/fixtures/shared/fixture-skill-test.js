/**
 * Skill fixture 共享测试脚本
 *
 * 导出函数，由各 fixture 的 test/fixture.test.js 调用。
 */

module.exports = function runSkillFixtureTests(projectRoot) {
  const assert = require('assert');
  const fs = require('fs');
  const path = require('path');

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
};
