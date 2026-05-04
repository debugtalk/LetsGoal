#!/usr/bin/env node
const path = require('path');
const runTests = require('../../shared/fixture-skill-test.js');
runTests(path.resolve(__dirname, '..'));
