#!/usr/bin/env node
import { readdir } from 'fs/promises';
import { statSync } from 'fs';
import { resolve, join } from 'path';
import { pathToFileURL } from 'url';

const rootDir = process.cwd();
const testFiles = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        return;
      }
      await walk(fullPath);
    } else if (entry.isFile() && /\.test\.js$/u.test(entry.name)) {
      testFiles.push(fullPath);
    }
  }));
}

async function collectTests() {
  const args = process.argv.slice(2);
  const explicit = args.filter((arg) => !arg.startsWith('-'));
  if (explicit.length > 0) {
    explicit.forEach((file) => {
      const fullPath = resolve(rootDir, file);
      if (statSync(fullPath).isFile()) {
        testFiles.push(fullPath);
      }
    });
  } else {
    await walk(rootDir);
    testFiles.sort();
  }
}

function formatValue(value) {
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

function deepEqual(a, b) {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (typeof a !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => deepEqual(a[key], b[key]));
}

function createExpect(received) {
  return {
    toBe(expected) {
      if (!Object.is(received, expected)) {
        throw new Error(`Kutilgan qiymat ${formatValue(expected)}, ammo ${formatValue(received)} olindi.`);
      }
    },
    toBeNull() {
      if (received !== null) {
        throw new Error(`Qiymat null bo'lishi kerak edi, ammo ${formatValue(received)} olindi.`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(received, expected)) {
        throw new Error(`Qiymatlar teng emas. Kutilgan: ${formatValue(expected)}, olingan: ${formatValue(received)}`);
      }
    },
    toContain(expected) {
      if (typeof received === 'string') {
        if (!received.includes(expected)) {
          throw new Error(`Matn ${formatValue(expected)} qiymatini o'z ichiga olmaydi.`);
        }
      } else if (Array.isArray(received)) {
        if (!received.some((item) => Object.is(item, expected))) {
          throw new Error(`Massiv ${formatValue(expected)} qiymatini o'z ichiga olmaydi.`);
        }
      } else {
        throw new Error('toContain faqat string yoki massivlar uchun ishlatiladi.');
      }
    },
    toThrow(expectedMessage) {
      if (typeof received !== 'function') {
        throw new Error('toThrow faqat funksiyalar bilan ishlaydi.');
      }
      let threw = false;
      try {
        received();
      } catch (error) {
        threw = true;
        if (expectedMessage && !String(error.message).includes(expectedMessage)) {
          throw new Error(`Xatolik matni kutilgan qiymatni o'z ichiga olmaydi: ${expectedMessage}`);
        }
      }
      if (!threw) {
        throw new Error('Funksiya xatolik chiqarishi kerak edi.');
      }
    },
  };
}

const tests = [];
let currentSuite = '';

globalThis.describe = (name, fn) => {
  const previous = currentSuite;
  currentSuite = previous ? `${previous} ${name}` : name;
  fn();
  currentSuite = previous;
};

globalThis.test = (name, fn) => {
  const fullName = currentSuite ? `${currentSuite} ${name}` : name;
  tests.push({ name: fullName, fn });
};

globalThis.expect = (received) => createExpect(received);

async function run() {
  await collectTests();
  if (testFiles.length === 0) {
    console.log('Hech qanday test topilmadi.');
    process.exit(1);
  }
  for (const file of testFiles) {
    await import(pathToFileURL(file));
  }

  let passed = 0;
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`\x1b[32m✓\x1b[0m ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`\x1b[31m✗\x1b[0m ${name}`);
      console.log(`  ${error.message}`);
      failures.push(name);
    }
  }

  console.log(`\nNatija: ${passed} / ${tests.length} testlar muvaffaqiyatli.`);
  if (failures.length > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
