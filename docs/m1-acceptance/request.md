# 开发调试任务

## 目标

优化腾讯视频电视剧热播榜采集 Skill（SKILL.md），使其通过所有评测用例和结构校验测试。

当前 SKILL.md 是一个半成品：只有适用场景和前 3 步操作，缺少输入输出契约、后续执行步骤、以及关键约束。结构校验测试会检查 SKILL.md 的格式规范性（章节顺序、步骤标题格式、ADB 命令反引号、字段表格等）。

需要补全缺失内容，使 skill_eval 和 test 门禁全部通过。不要删除已有内容，只补充。

## 项目根目录

/tmp/letsgoal-m1-optimize

## 约束

- 只修改 SKILL.md，不改动其他文件
- 保持现有内容不变，只补充缺失部分
- 不引入新的运行时依赖

## 禁止改动

- eval-cases/
- test/
- package.json

## 配置

```yaml
task_type: skill_optimize
language: javascript
success_criteria:
  hard_gates:
    - skill_syntax
    - skill_eval
    - test
loop_config:
  max_iterations: 3
  min_score: 1.0
  autonomy_mode: standard
eval_suite:
  version: v1
  files:
    - "eval-cases/*.json"
```
