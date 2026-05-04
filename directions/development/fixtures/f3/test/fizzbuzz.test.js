const assert = require('assert');

// F3 fixture: tests for fizzbuzz completion
// fizzbuzz.js exists but is incomplete: missing %5 and %15 branches.

const fizzbuzz = require('../fizzbuzz.js');

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

test('fizzbuzz(1) returns "1"', () => {
  assert.strictEqual(fizzbuzz(1), '1');
});

test('fizzbuzz(3) returns "Fizz"', () => {
  assert.strictEqual(fizzbuzz(3), 'Fizz');
});

test('fizzbuzz(5) returns "Buzz"', () => {
  assert.strictEqual(fizzbuzz(5), 'Buzz');
});

test('fizzbuzz(15) returns "FizzBuzz"', () => {
  assert.strictEqual(fizzbuzz(15), 'FizzBuzz');
});

test('fizzbuzz(30) returns "FizzBuzz"', () => {
  assert.strictEqual(fizzbuzz(30), 'FizzBuzz');
});

if (!process.exitCode) {
  console.log('\nAll tests passed!');
}
