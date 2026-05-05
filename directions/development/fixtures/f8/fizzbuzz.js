// F8 fixture: fizzbuzz with bug — missing %15 branch
function fizzbuzz(n) {
  if (n % 3 === 0) {
    return "Fizz";
  }
  if (n % 5 === 0) {
    return "Buzz";
  }
  return String(n);
}

module.exports = fizzbuzz;
